import { spawn, type ChildProcess } from "node:child_process";
import { terminateProcessTree } from "./process-tree.ts";

const OUTPUT_TAIL_LIMIT = 2 * 1024 * 1024;

export interface IsolatedNodeJobOptions {
  readonly entryPath: string;
  readonly input: unknown;
  readonly marker: string;
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly ipcLifeline?: boolean;
  readonly signal?: AbortSignal;
  readonly terminationGraceMs?: number;
  readonly execPath?: string;
  readonly spawnProcess?: typeof spawn;
  readonly label?: string;
  readonly parseResult?: (output: string) => unknown;
  readonly sanitizeStderr?: (message: string) => string;
}

export type IsolatedJobErrorKind = "spawn" | "timeout" | "aborted" | "crashed" | "no-result";

export class IsolatedJobError extends Error {
  readonly kind: IsolatedJobErrorKind;

  constructor(kind: IsolatedJobErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IsolatedJobError";
    this.kind = kind;
  }
}

function appendTail(current: Buffer, chunk: Buffer): Buffer {
  const combined = Buffer.concat([current, chunk]);
  return combined.length <= OUTPUT_TAIL_LIMIT ? combined : combined.subarray(combined.length - OUTPUT_TAIL_LIMIT);
}

export function extractIsolatedNodeJobResult(output: string, marker: string): unknown {
  const markerIndex = output.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const encoded = output
    .slice(markerIndex + marker.length)
    .split(/\r?\n/, 1)[0]
    ?.trim();
  if (!encoded) return undefined;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

export async function runIsolatedNodeJob(options: IsolatedNodeJobOptions): Promise<unknown> {
  const label = options.label ?? "Node job";
  if (options.signal?.aborted) throw new IsolatedJobError("aborted", `${label} aborted`);
  const input = JSON.stringify(options.input);
  if (Buffer.byteLength(input) > options.maxInputBytes) {
    throw new IsolatedJobError("spawn", `${label} request is too large`);
  }

  return new Promise<unknown>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = (options.spawnProcess ?? spawn)(options.execPath ?? process.execPath, [options.entryPath], {
        env: options.env,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: options.ipcLifeline ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"],
      });
    } catch (cause) {
      reject(new IsolatedJobError("spawn", `Could not start the isolated ${label}`, { cause }));
      return;
    }

    let stdoutTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let settled = false;
    let terminating = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      operation();
    };
    const terminateWithError = (error: IsolatedJobError): void => {
      if (settled || terminating) return;
      terminating = true;
      void terminateProcessTree(child, options.terminationGraceMs ?? 1_000).then(
        () => finish(() => reject(error)),
        (cause) => finish(() => reject(new IsolatedJobError("crashed", `${label} cleanup failed`, { cause }))),
      );
    };
    const onAbort = (): void => terminateWithError(new IsolatedJobError("aborted", `${label} aborted`));
    child.stdin?.on("error", (cause) => {
      terminateWithError(new IsolatedJobError("no-result", `${label} closed its input without a result`, { cause }));
    });
    child.stdout?.on("data", (value: Buffer | string) => {
      stdoutTail = appendTail(stdoutTail, Buffer.isBuffer(value) ? value : Buffer.from(value));
    });
    child.stderr?.on("data", (value: Buffer | string) => {
      stderrTail = appendTail(stderrTail, Buffer.isBuffer(value) ? value : Buffer.from(value));
    });
    child.once("error", (cause) => {
      if (terminating) return;
      finish(() => reject(new IsolatedJobError("spawn", `The isolated ${label} failed to start`, { cause })));
    });
    child.once("close", (exitCode) => {
      if (terminating) return;
      finish(() => {
        const output = stdoutTail.toString("utf8");
        const result = options.parseResult
          ? options.parseResult(output)
          : extractIsolatedNodeJobResult(output, options.marker);
        if (result !== undefined) {
          resolve(result);
          return;
        }
        const stderr = stderrTail.toString("utf8").trim();
        const detail = options.sanitizeStderr ? options.sanitizeStderr(stderr) : stderr;
        reject(
          new IsolatedJobError(
            exitCode === 0 ? "no-result" : "crashed",
            detail
              ? `${label} exited without a result (${exitCode ?? "signal"}): ${detail}`
              : `${label} exited without a result (${exitCode ?? "signal"})`,
          ),
        );
      });
    });
    const timer = setTimeout(() => {
      terminateWithError(new IsolatedJobError("timeout", `${label} timed out`));
    }, options.timeoutMs);
    timer.unref();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    else child.stdin?.end(input);
  });
}
