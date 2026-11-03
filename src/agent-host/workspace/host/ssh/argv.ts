import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SshTarget } from "../../../../shared/workspace-ref.ts";
import { pythonBootstrapSource } from "./python-bootstrap.ts";

const MAX_SOCKET_PATH_BYTES = 100;
const SAFE_NAME = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
const SAFE_HOST = /^(?:[A-Za-z0-9._][A-Za-z0-9._-]*|[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*)$/;

export interface SshContext {
  readonly target: SshTarget;
  readonly controlPath: string | null;
  readonly dexonKnownHostsPath: string;
  readonly userKnownHostsPath: string;
  readonly connectTimeoutSeconds?: number;
  readonly options?: Readonly<Record<string, string>>;
}

export type SshInvocation =
  | { readonly kind: "master" }
  | { readonly kind: "exec"; readonly remoteCommand: string }
  | { readonly kind: "check" }
  | { readonly kind: "exit" }
  | { readonly kind: "forward"; readonly localPort: number; readonly remotePort: number }
  | { readonly kind: "cancel"; readonly localPort: number; readonly remotePort: number };

function assertTarget(target: SshTarget): void {
  const { user, host, port } = target;
  if (user !== undefined && !SAFE_NAME.test(user)) throw new Error("Invalid ssh target user");
  if (!SAFE_HOST.test(host)) throw new Error("Invalid ssh target host");
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("Invalid ssh target port");
  }
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be between 1 and 65535");
}

function quoteOptionPath(value: string): string {
  if (/["\r\n\0]/.test(value)) throw new Error("Invalid known_hosts path");
  return `"${value}"`;
}

export function sshDestination(target: SshTarget): string {
  assertTarget(target);
  return `${target.user ? `${target.user}@` : ""}${target.host}`;
}

function sharedOptions(context: SshContext): string[] {
  const argv: string[] = ["-T"];
  if (context.target.port !== undefined && context.target.port !== 22) argv.push("-p", String(context.target.port));
  const options: Array<[string, string]> = [
    ["BatchMode", "yes"],
    ["ConnectTimeout", String(context.connectTimeoutSeconds ?? 10)],
    ["ServerAliveInterval", "5"],
    ["ServerAliveCountMax", "3"],
    ["StrictHostKeyChecking", "yes"],
    [
      "UserKnownHostsFile",
      `${quoteOptionPath(context.dexonKnownHostsPath)} ${quoteOptionPath(context.userKnownHostsPath)}`,
    ],
  ];
  if (context.controlPath) {
    options.push(["ControlMaster", "auto"], ["ControlPath", context.controlPath], ["ControlPersist", "no"]);
  }
  for (const [name, value] of Object.entries(context.options ?? {})) options.push([name, value]);
  for (const [name, value] of options) argv.push("-o", `${name}=${value}`);
  return argv;
}

export function buildSshArgv(context: SshContext, invocation: SshInvocation): string[] {
  const destination = sshDestination(context.target);
  const argv = sharedOptions(context);
  switch (invocation.kind) {
    case "master":
      argv.push("-N", "--", destination);
      break;
    case "exec":
      argv.push("--", destination, invocation.remoteCommand);
      break;
    case "check":
    case "exit":
      argv.push("-O", invocation.kind, "--", destination);
      break;
    case "forward":
    case "cancel":
      assertPort(invocation.localPort);
      assertPort(invocation.remotePort);
      argv.push(
        "-O",
        invocation.kind,
        "-L",
        `127.0.0.1:${invocation.localPort}:127.0.0.1:${invocation.remotePort}`,
        "--",
        destination,
      );
      break;
  }
  return argv;
}

export function remotePythonCommand(script: string): string {
  return `exec python3 -u -c '${pythonBootstrapSource(script)}'`;
}

export interface ControlSocketLocation {
  readonly root?: string;
  readonly uid?: number;
}

function digest(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function currentUid(): number {
  return typeof process.getuid === "function" ? process.getuid() : 0;
}

function shortRoot(requested: string | undefined): string {
  const candidate = requested ?? tmpdir();
  return Buffer.byteLength(candidate) <= 60 ? candidate : "/tmp";
}

export function controlDirectoryFor(location: ControlSocketLocation = {}): string {
  return path.join(shortRoot(location.root), `dx-${digest(String(location.uid ?? currentUid()), 6)}`);
}

export function controlSocketPathFor(target: SshTarget, location: ControlSocketLocation = {}): string {
  const key = `${target.user ?? ""}@${target.host}:${target.port ?? 22}`;
  const socket = path.join(controlDirectoryFor(location), `${digest(key, 10)}.s`);
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH_BYTES) throw new Error("Control socket path is too long");
  return socket;
}

export function ensureControlDirectory(location: ControlSocketLocation = {}): string {
  const directory = controlDirectoryFor(location);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if ((statSync(directory).mode & 0o077) !== 0) chmodSync(directory, 0o700);
  return directory;
}
