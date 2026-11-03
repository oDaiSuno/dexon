import type { ChildProcess } from "node:child_process";
import { RemoteOperationError, RemoteTransportError, type RemoteOperationErrorCode } from "../errors.ts";
import { encodeCancel, encodeRequest, FrameDecoder, interpretHelperFrame, type HelperMessage } from "./framing.ts";
import { pythonBootstrapInput } from "./python-bootstrap.ts";

const STDERR_TAIL_BYTES = 16 * 1024;
const KNOWN_CODES = new Set<string>([
  "ENOENT",
  "EACCES",
  "EEXIST",
  "ENOTDIR",
  "EISDIR",
  "OUTSIDE_ROOT",
  "TOO_LARGE",
  "SEARCH_UNAVAILABLE",
  "TIMEOUT",
  "CANCELLED",
  "BAD_REQUEST",
]);

export interface HelperHello {
  readonly version: number;
  readonly python: string;
  readonly pid: number;
}

export interface HelperData {
  readonly stream: string;
  readonly meta: Record<string, unknown>;
  readonly bytes: Buffer;
}

export interface HelperRequestOptions {
  readonly signal?: AbortSignal;
  readonly onData?: (data: HelperData) => void;
  readonly keepData?: boolean;
}

export interface HelperClose {
  readonly reason: "eof" | "error" | "closed";
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
}

export interface HelperLink {
  readonly hello: HelperHello;
  readonly epoch: number;
  request(op: string, input: object, options?: HelperRequestOptions): Promise<Record<string, unknown>>;
  dropData(requestId: number): void;
  onWatchData(listener: (data: HelperData) => void): () => void;
  readonly closed: Promise<HelperClose>;
  close(): void;
}

export class HelperStartError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(message: string, stderr: string, exitCode: number | null) {
    super(message);
    this.name = "HelperStartError";
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export interface AttachOptions {
  readonly epoch: number;
  readonly helloTimeoutMs?: number;
}

interface Pending {
  readonly resolve: (body: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly onData?: (data: HelperData) => void;
  readonly keepData: boolean;
  readonly detach: () => void;
}

function operationError(code: string, message: string): RemoteOperationError {
  return new RemoteOperationError((KNOWN_CODES.has(code) ? code : "INTERNAL") as RemoteOperationErrorCode, message);
}

export function attachHelperLink(child: ChildProcess, script: string, options: AttachOptions): Promise<HelperLink> {
  const stdin = child.stdin;
  const stdout = child.stdout;
  if (!stdin || !stdout) return Promise.reject(new HelperStartError("Helper process has no pipes", "", null));

  const decoder = new FrameDecoder();
  const pending = new Map<number, Pending>();
  const dataSubscribers = new Map<number, (data: HelperData) => void>();
  const watchSubscribers = new Set<(data: HelperData) => void>();
  let stderrTail = "";
  let nextId = 1;
  let closedInfo: HelperClose | null = null;
  let hello: HelperHello | null = null;
  let resolveClosed!: (close: HelperClose) => void;
  const closed = new Promise<HelperClose>((resolve) => {
    resolveClosed = resolve;
  });
  let resolveHello!: (value: HelperHello) => void;
  let rejectHello!: (error: Error) => void;
  const helloPromise = new Promise<HelperHello>((resolve, reject) => {
    resolveHello = resolve;
    rejectHello = reject;
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
  });

  const finish = (reason: HelperClose["reason"], exitCode: number | null, signal: string | null): void => {
    if (closedInfo) return;
    closedInfo = { reason, exitCode, signal, stderr: stderrTail };
    const failure = new RemoteTransportError(
      reason === "closed" ? "Helper link was closed" : "Helper connection was lost",
    );
    for (const entry of [...pending.values()]) entry.reject(failure);
    pending.clear();
    dataSubscribers.clear();
    watchSubscribers.clear();
    if (!hello) rejectHello(new HelperStartError("Helper exited before it was ready", stderrTail, exitCode));
    resolveClosed(closedInfo);
  };

  const handle = (message: HelperMessage): void => {
    if (message.kind === "hello") {
      hello = { version: message.version, python: message.python, pid: message.pid };
      resolveHello(hello);
      return;
    }
    if (message.kind === "heartbeat") return;
    if (message.kind === "data") {
      if (message.stream === "watch") {
        for (const listener of watchSubscribers) {
          listener({ stream: message.stream, meta: message.meta, bytes: message.bytes });
        }
        return;
      }
      const subscriber = dataSubscribers.get(message.id);
      subscriber?.({ stream: message.stream, meta: message.meta, bytes: message.bytes });
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (!entry.keepData) dataSubscribers.delete(message.id);
    entry.detach();
    if (message.kind === "result") entry.resolve(message.body);
    else entry.reject(operationError(message.code, message.message));
  };

  stdout.on("data", (chunk: Buffer) => {
    try {
      for (const frame of decoder.push(chunk)) handle(interpretHelperFrame(frame));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderrTail = `${stderrTail}\n[protocol] ${message}`.slice(-STDERR_TAIL_BYTES);
      child.kill();
      finish("error", null, null);
    }
  });
  stdout.on("end", () => finish("eof", child.exitCode, child.signalCode));
  child.on("error", (error) => {
    stderrTail = `${stderrTail}\n${error.message}`.slice(-STDERR_TAIL_BYTES);
    finish("error", null, null);
  });
  child.on("close", (code, signal) => finish(closedInfo ? closedInfo.reason : "eof", code, signal));
  stdin.on("error", () => undefined);

  stdin.write(pythonBootstrapInput(script));

  const link: HelperLink = {
    get hello() {
      return hello as HelperHello;
    },
    epoch: options.epoch,
    request(op, input, requestOptions = {}) {
      if (closedInfo) return Promise.reject(new RemoteTransportError("Helper link is closed"));
      const { signal, onData, keepData = false } = requestOptions;
      if (signal?.aborted) return Promise.reject(operationError("CANCELLED", "Operation was cancelled"));
      const id = nextId++;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const onAbort = (): void => {
          if (!pending.delete(id)) return;
          if (!keepData) dataSubscribers.delete(id);
          stdin.write(encodeCancel(id));
          reject(operationError("CANCELLED", "Operation was cancelled"));
        };
        const detach = (): void => signal?.removeEventListener("abort", onAbort);
        pending.set(id, { resolve, reject, onData, keepData, detach });
        if (onData) dataSubscribers.set(id, onData);
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          stdin.write(encodeRequest(id, options.epoch, op, input));
        } catch (error) {
          pending.delete(id);
          dataSubscribers.delete(id);
          detach();
          reject(error instanceof Error ? error : new RemoteTransportError(String(error)));
        }
      });
    },
    dropData(requestId) {
      dataSubscribers.delete(requestId);
    },
    onWatchData(listener) {
      watchSubscribers.add(listener);
      return () => {
        watchSubscribers.delete(listener);
      };
    },
    closed,
    close() {
      if (closedInfo) return;
      finish("closed", child.exitCode, child.signalCode);
      stdin.end();
      child.kill();
    },
  };

  const timeoutMs = options.helloTimeoutMs ?? 15_000;
  const timer = setTimeout(() => {
    rejectHello(new HelperStartError("Helper did not become ready in time", stderrTail, null));
    child.kill();
  }, timeoutMs);
  return helloPromise.then(
    () => {
      clearTimeout(timer);
      return link;
    },
    (error: unknown) => {
      clearTimeout(timer);
      throw error;
    },
  );
}
