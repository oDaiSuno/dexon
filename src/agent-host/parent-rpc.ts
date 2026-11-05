import { randomUUID } from "node:crypto";
import type { BrowserErrorCode, BrowserRecovery } from "../contract/browser.ts";
import type { EnvironmentDescriptor } from "../contract/environment.ts";
import { buildEnvironmentDescriptor, ensureEnvironmentIdentity } from "./environment-identity.ts";
import { readPiRuntimeVersion } from "./runtime-version.ts";

type ParentRpcError<Code extends string = BrowserErrorCode> = {
  message: string;
  code?: Code;
  retryable?: boolean;
  recovery?: BrowserRecovery;
  details?: Record<string, unknown>;
};
type ParentRpcResult = { type: "host-rpc-result"; id: string; ok: boolean; result?: unknown; error?: ParentRpcError };
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();
let installed = false;
let standaloneHandler: ((method: string, params: unknown, timeoutMs: number) => Promise<unknown>) | null = null;
let activeDescriptor: EnvironmentDescriptor | null = null;

export function setStandaloneMainRequestHandler(
  handler: ((method: string, params: unknown, timeoutMs: number) => Promise<unknown>) | null,
): void {
  standaloneHandler = handler;
}

export function setActiveEnvironmentDescriptor(descriptor: EnvironmentDescriptor | null): void {
  activeDescriptor = descriptor ? structuredClone(descriptor) : null;
}

export function peekActiveEnvironmentDescriptor(): EnvironmentDescriptor | undefined {
  return activeDescriptor ? structuredClone(activeDescriptor) : undefined;
}

export function getActiveEnvironmentDescriptor(): EnvironmentDescriptor {
  activeDescriptor ??= buildEnvironmentDescriptor({
    ...ensureEnvironmentIdentity(),
    piVersion: readPiRuntimeVersion(),
    capabilities: {
      browser: Boolean(process.parentPort),
      nativeDialogs: Boolean(process.parentPort),
      revealInFileManager: Boolean(process.parentPort),
      managedProcesses: true,
      toolchainInstall: true,
    },
  });
  return structuredClone(activeDescriptor);
}

export class MainProcessRpcError<Code extends string = BrowserErrorCode> extends Error {
  readonly code?: Code;
  readonly retryable: boolean;
  readonly recovery?: BrowserRecovery;
  readonly details?: Record<string, unknown>;

  constructor(value: ParentRpcError<Code>) {
    const recovery = value.recovery
      ? ` Recovery: ${value.recovery.remediation}; reason=${value.recovery.reason}; retryable=${value.recovery.retryable}.`
      : "";
    super(value.code ? `${value.code}: ${value.message}.${recovery}` : value.message);
    this.name = "MainProcessRpcError";
    this.code = value.code;
    this.retryable = value.retryable === true;
    this.recovery = value.recovery ? structuredClone(value.recovery) : undefined;
    this.details = value.details ? structuredClone(value.details) : undefined;
  }
}

function installListener(): void {
  if (installed || !process.parentPort) return;
  installed = true;
  process.parentPort.on("message", (event) => {
    const message = event.data as ParentRpcResult;
    if (message?.type !== "host-rpc-result") return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result);
    else request.reject(new MainProcessRpcError(message.error ?? { message: "Main process request failed" }));
  });
}

export function callMain<T>(method: string, params?: unknown, timeoutMs = 10_000): Promise<T> {
  installListener();
  const port = process.parentPort;
  if (!port) {
    const handler = standaloneHandler;
    if (!handler) return Promise.reject(new Error("Main process channel is unavailable"));
    return Promise.resolve()
      .then(() => handler(method, params, timeoutMs))
      .catch((error: unknown) => {
        if (error instanceof MainProcessRpcError) throw error;
        if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
          const structured = error as ParentRpcError;
          if (structured.code || structured.recovery || structured.retryable !== undefined) {
            throw new MainProcessRpcError(structured);
          }
        }
        throw error;
      }) as Promise<T>;
  }
  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Main process request timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    port.postMessage({ type: "host-rpc", id, method, params });
  });
}
