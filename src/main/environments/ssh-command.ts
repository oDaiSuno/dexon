import { execFile, spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SshEnvironmentTarget } from "../../contract/environment.ts";
import { diagnoseSshFailure } from "./ssh-diagnostics.ts";
import { shellQuote, validateSshTarget } from "./ssh-scripts.ts";
import { EnvironmentConnectionError } from "./supervisor-policy.ts";
export function sshArguments(target: SshEnvironmentTarget): string[] {
  validateSshTarget(target);
  return [
    "-T",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ControlMaster=no",
    "-o",
    "ControlPath=none",
    "-o",
    "ControlPersist=no",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
    ...(target.port === undefined ? [] : ["-p", String(target.port)]),
    ...(target.user === undefined ? [] : ["-l", target.user]),
    ...(target.hostname === undefined ? [] : ["-o", `HostName=${target.hostname}`]),
    ...(target.identityFile === undefined ? [] : ["-i", target.identityFile]),
    ...(target.proxyJump === undefined ? [] : ["-J", target.proxyJump]),
  ];
}
export function sshFailure(
  stderr: string,
  target: SshEnvironmentTarget,
  code?: string | number | null,
): EnvironmentConnectionError {
  const failure = diagnoseSshFailure(stderr, target, code);
  return failure.kind === "blocked"
    ? new EnvironmentConnectionError("blocked", failure.diagnosis.reason, failure.diagnosis.detail, failure.diagnosis)
    : new EnvironmentConnectionError("transient", failure.failure.reason, failure.failure.detail);
}
export async function runSsh(
  target: SshEnvironmentTarget,
  script: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    stdin?: Readable;
    bytesTotal?: number;
    onProgress?: (progress: number) => void;
    onStdout?: (chunk: string) => void;
  } = {},
): Promise<string> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 45_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  const child = spawn("ssh", [...sshArguments(target), target.sshAlias, `sh -c ${shellQuote(script)}`], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "",
    stderr = "",
    bytes = 0;
  let spawnError: NodeJS.ErrnoException | null = null;
  let overflow = false;
  const abort = () => child.kill("SIGKILL");
  signal.addEventListener("abort", abort, { once: true });
  child.on("error", (error) => {
    spawnError = error;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    options.onStdout?.(chunk.toString());
    if (Buffer.byteLength(stdout) > 262_144) {
      overflow = true;
      child.kill("SIGKILL");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-65_536);
  });
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      options.onProgress?.(Math.min(1, bytes / Math.max(1, options.bytesTotal ?? bytes)));
      callback(null, chunk);
    },
  });
  options.onProgress?.(0);
  const input = pipeline(options.stdin ?? Readable.from([]), progress, child.stdin).then(
    () => null,
    (error: unknown) => error,
  );
  try {
    const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
    const inputError = await input;
    if (signal.aborted) throw sshFailure("Remote SSH command timed out or aborted", target);
    if (overflow) throw new EnvironmentConnectionError("blocked", "configuration", "SSH response exceeded size limit");
    if (spawnError) throw sshFailure((spawnError as Error).message, target, (spawnError as NodeJS.ErrnoException).code);
    if (exitCode !== 0) throw sshFailure(stderr, target, exitCode);
    if (inputError) throw inputError;
    return stdout;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
export function runLocalSshTool(
  executable: "ssh" | "ssh-keygen",
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: 15_000, maxBuffer: 262_144, windowsHide: true, signal },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(stderr.trim() || (error.code === "ENOENT" ? "SSH executable is unavailable" : error.message)),
          );
        else resolve(stdout);
      },
    );
  });
}
