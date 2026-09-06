import { randomUUID } from "node:crypto";
import type {
  InteractiveReceipt,
  InteractiveRequest,
  InteractiveSnapshot,
  InteractiveStatus,
} from "../../shared/interactive-tools";
import type { ExtensionUiResponse } from "../../shared/types";
import type { AgentEvent } from "./types";

type RequestBody = InteractiveRequest extends infer R
  ? R extends InteractiveRequest
    ? Omit<R, "id" | "type">
    : never
  : never;
interface Pending {
  request: InteractiveRequest;
  respond(response: ExtensionUiResponse): InteractiveReceipt;
  cancel(status: InteractiveStatus, reason?: InteractiveReceipt["reason"]): InteractiveReceipt;
}

/** Owns the wait, not its renderer. Closing a view never calls this service. */
export class PendingUiRequests {
  readonly runtimeId = randomUUID();
  private revision = 0;
  private alive = true;
  private pending = new Map<string, Pending>();
  private completed = new Map<string, InteractiveReceipt>();

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  snapshot(): InteractiveSnapshot {
    return {
      runtimeId: this.runtimeId,
      revision: this.revision,
      requests: [...this.pending.values()].map(({ request }) => request),
      completed: [...this.completed.values()],
    };
  }

  private publish(): void {
    this.revision++;
    this.emit({ type: "extension_ui_snapshot", snapshot: this.snapshot() });
  }

  open<T>(
    body: RequestBody,
    defaultValue: T,
    parse: (response: ExtensionUiResponse) => T,
    options: { timeout?: number; signal?: AbortSignal; onFinish?: () => void } = {},
  ): { id: string; promise: Promise<T>; finish(value: T, status: InteractiveStatus): void } {
    const id = randomUUID();
    if (!this.alive || options.signal?.aborted) {
      return { id, promise: Promise.resolve(defaultValue), finish() {} };
    }
    const timeout = options.timeout;
    const hasTimeout = timeout !== undefined && Number.isFinite(timeout) && timeout >= 0;
    const request = {
      ...body,
      type: "extension_ui_request",
      id,
      ...(hasTimeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    } as InteractiveRequest;
    let finish!: (value: T, status: InteractiveStatus, reason?: InteractiveReceipt["reason"]) => InteractiveReceipt;
    const promise = new Promise<T>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const onAbort = () => finish(defaultValue, "expired", "aborted");
      finish = (value, status, reason) => {
        if (settled) return this.completed.get(id) ?? { id, status: "expired" };
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        const receipt: InteractiveReceipt = { id, status, ...(reason ? { reason } : {}) };
        this.completed.set(id, receipt);
        // A late retry of an evicted receipt is expired, never a new execution.
        while (this.completed.size > 256) this.completed.delete(this.completed.keys().next().value!);
        try {
          options.onFinish?.();
        } catch {
          /* Extension cleanup cannot retain a wait. */
        }
        resolve(value);
        this.emit({ type: "extension_ui_closed", ...receipt });
        this.publish();
        return receipt;
      };
      this.pending.set(id, {
        request,
        respond: (response) =>
          "cancelled" in response && response.cancelled
            ? finish(defaultValue, "cancelled")
            : finish(parse(response), "submitted"),
        cancel: (status, reason) => finish(defaultValue, status, reason),
      });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (hasTimeout) timer = setTimeout(() => finish(defaultValue, "expired", "timeout"), timeout);
    });
    this.emit(request as unknown as AgentEvent);
    this.publish();
    return { id, promise, finish };
  }

  contains(id: string): boolean {
    return this.pending.has(id);
  }

  update(id: string, changes: Partial<InteractiveRequest>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    pending.request = { ...pending.request, ...changes, id, method: pending.request.method } as InteractiveRequest;
    this.emit(pending.request as unknown as AgentEvent);
    this.publish();
  }

  respond(response: ExtensionUiResponse): InteractiveReceipt {
    const pending = this.pending.get(response.id);
    return pending?.respond(response) ?? this.completed.get(response.id) ?? { id: response.id, status: "expired" };
  }

  cancelAll(reason: InteractiveReceipt["reason"] = "stopped"): void {
    for (const pending of [...this.pending.values()]) pending.cancel("expired", reason);
  }

  destroy(): void {
    this.alive = false;
    this.cancelAll("closed");
  }
}
