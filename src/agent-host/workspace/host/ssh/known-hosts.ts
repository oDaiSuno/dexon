import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SshTarget } from "../../../../shared/workspace-ref.ts";
import { sanitizeToolEnvironment } from "../../../tool-environment.ts";

const KEY_TYPES: Readonly<Record<string, string>> = {
  "ssh-ed25519": "ED25519",
  "ssh-rsa": "RSA",
  "ecdsa-sha2-nistp256": "ECDSA",
  "ecdsa-sha2-nistp384": "ECDSA",
  "ecdsa-sha2-nistp521": "ECDSA",
  "sk-ssh-ed25519@openssh.com": "ED25519-SK",
};

const PREFERRED_ORDER = ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "ssh-rsa"];
const SCAN_TIMEOUT_SECONDS = 8;

export class KnownHostsError extends Error {
  readonly code: "SCAN_FAILED" | "FINGERPRINT_MISMATCH";

  constructor(code: KnownHostsError["code"], message: string) {
    super(message);
    this.name = "KnownHostsError";
    this.code = code;
  }
}

export interface ScannedHostKey {
  readonly pattern: string;
  readonly algorithm: string;
  readonly keyType: string;
  readonly fingerprint: string;
  readonly rawHostKeyLine: string;
}

export interface ScanOptions {
  readonly keyscanBinary?: string;
}

export interface AcceptOptions extends ScanOptions {
  readonly knownHostsPath: string;
}

export function hostPattern(target: SshTarget): string {
  return target.port !== undefined && target.port !== 22 ? `[${target.host}]:${target.port}` : target.host;
}

export function fingerprintOf(blob: string): string {
  const digest = createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}

function runKeyscan(binary: string, target: SshTarget): Promise<string> {
  const args = ["-T", String(SCAN_TIMEOUT_SECONDS)];
  if (target.port !== undefined && target.port !== 22) args.push("-p", String(target.port));
  args.push("--", target.host);
  const isNodeScript = /\.(mjs|cjs|js)$/i.test(binary);
  const cmd = isNodeScript ? process.execPath : binary;
  const cmdArgs = isNodeScript ? [binary, ...args] : args;
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      cmdArgs,
      { env: sanitizeToolEnvironment(process.env), timeout: (SCAN_TIMEOUT_SECONDS + 4) * 1000, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error && !stdout)
          reject(new KnownHostsError("SCAN_FAILED", `Could not read the server host key: ${error.message}`));
        else resolve(stdout);
      },
    );
  });
}

function parseScan(output: string, target: SshTarget): ScannedHostKey[] {
  const keys: ScannedHostKey[] = [];
  for (const line of output.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [, algorithm, blob] = line.trim().split(/\s+/);
    if (!algorithm || !blob || !(algorithm in KEY_TYPES)) continue;
    const pattern = hostPattern(target);
    keys.push({
      pattern,
      algorithm,
      keyType: KEY_TYPES[algorithm],
      fingerprint: fingerprintOf(blob),
      rawHostKeyLine: `${pattern} ${algorithm} ${blob}`,
    });
  }
  return keys.sort((left, right) => PREFERRED_ORDER.indexOf(left.algorithm) - PREFERRED_ORDER.indexOf(right.algorithm));
}

export async function scanHostKeys(target: SshTarget, options: ScanOptions = {}): Promise<ScannedHostKey[]> {
  const keys = parseScan(await runKeyscan(options.keyscanBinary ?? "ssh-keyscan", target), target);
  if (!keys.length) throw new KnownHostsError("SCAN_FAILED", "The server presented no usable host key");
  return keys;
}

export async function scanHostKey(target: SshTarget, options: ScanOptions = {}): Promise<ScannedHostKey> {
  return (await scanHostKeys(target, options))[0];
}

function writeOwnerOnly(filePath: string, text: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
  chmodSync(filePath, 0o600);
}

function readIfPresent(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function acceptHostKey(
  target: SshTarget,
  fingerprint: string,
  options: AcceptOptions,
): Promise<ScannedHostKey> {
  const presented = (await scanHostKeys(target, options)).find((key) => key.fingerprint === fingerprint);
  if (!presented) {
    throw new KnownHostsError("FINGERPRINT_MISMATCH", "The server no longer presents the fingerprint you confirmed");
  }
  const existing = readIfPresent(options.knownHostsPath);
  if (!existing.split("\n").includes(presented.rawHostKeyLine)) {
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    writeOwnerOnly(options.knownHostsPath, `${existing}${separator}${presented.rawHostKeyLine}\n`);
  }
  return presented;
}
