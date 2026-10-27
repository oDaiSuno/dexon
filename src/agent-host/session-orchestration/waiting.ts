import type { SessionLiveStatus } from "../../shared/session-orchestration";
import { getRpcSession, subscribeSessionStatuses, type OrchestratedTurnOutcome } from "../rpc-manager";
import { CYCLE_REFUSAL, SessionOrchestrationError, throwIfAborted } from "./errors";
import { isSessionRunning, lastSessionReply, liveStatusOf } from "./inspection";

export type SessionWaitStatus = "idle" | "error" | "awaiting_input" | "stopped" | "timeout";

export interface SessionWaitResult {
  status: SessionWaitStatus;
  stillRunning: boolean;
  lastReply?: string;
  error?: string;
  unavailableModel?: { provider: string; modelId: string };
}

export interface SessionWaitRequest {
  sessionId: string;
  timeoutMs: number;
  turn?: Promise<OrchestratedTurnOutcome>;
  signal?: AbortSignal;
}

const activeWaits = new Map<string, Set<string>>();

function reachesWaiter(from: string, waiterId: string, seen: Set<string>): boolean {
  if (from === waiterId) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const next of activeWaits.get(from) ?? []) {
    if (reachesWaiter(next, waiterId, seen)) return true;
  }
  return false;
}

export function openSessionWait(waiterId: string, targetId: string): () => void {
  if (reachesWaiter(targetId, waiterId, new Set())) throw new SessionOrchestrationError(CYCLE_REFUSAL);
  const targets = activeWaits.get(waiterId) ?? new Set<string>();
  targets.add(targetId);
  activeWaits.set(waiterId, targets);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = activeWaits.get(waiterId);
    if (!current) return;
    current.delete(targetId);
    if (current.size === 0) activeWaits.delete(waiterId);
  };
}

function createSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function waitForSessionOutcome(request: SessionWaitRequest): Promise<SessionWaitResult> {
  const { sessionId, turn, signal } = request;
  const deadline = Date.now() + request.timeoutMs;
  let outcome: OrchestratedTurnOutcome | undefined;
  let failure: string | undefined;
  const settled = createSignal();

  if (turn) {
    void turn.then(
      (value) => {
        outcome = value;
        settled.resolve();
      },
      (error: unknown) => {
        failure = describeFailure(error);
        settled.resolve();
      },
    );
  }

  for (;;) {
    throwIfAborted(signal);
    if (failure) return { status: "error", stillRunning: isSessionRunning(sessionId), error: failure };
    if (outcome) {
      if (outcome.error) {
        return {
          status: "error",
          stillRunning: isSessionRunning(sessionId),
          error: outcome.error,
          ...(outcome.unavailableModel ? { unavailableModel: outcome.unavailableModel } : {}),
        };
      }
      if (outcome.stopped) return { status: "stopped", stillRunning: isSessionRunning(sessionId) };
      return {
        status: "idle",
        stillRunning: isSessionRunning(sessionId),
        ...(outcome.reply ? { lastReply: outcome.reply } : {}),
      };
    }

    const status = liveStatusOf(sessionId);
    if (status === "awaiting_input") return { status: "awaiting_input", stillRunning: true };
    if (!turn && status === "error") {
      const error = getRpcSession(sessionId)?.lastTurnErrorMessage() ?? "The session's last turn failed";
      return { status: "error", stillRunning: false, error };
    }
    if (!turn && status === "idle") {
      const lastReply = await lastSessionReply(sessionId);
      return { status: "idle", stillRunning: false, ...(lastReply ? { lastReply } : {}) };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return { status: "timeout", stillRunning: isSessionRunning(sessionId) };
    await nextWake({
      sessionId,
      expected: status,
      remainingMs: remaining,
      signal,
      settled: turn ? settled.promise : undefined,
    });
  }
}

function nextWake(options: {
  sessionId: string;
  expected: SessionLiveStatus | "idle";
  remainingMs: number;
  signal?: AbortSignal;
  settled?: Promise<void>;
}): Promise<void> {
  if (options.signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let off: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      off();
      if (timer !== null) clearTimeout(timer);
      options.signal?.removeEventListener("abort", finish);
      resolve();
    };
    off = subscribeSessionStatuses(() => {
      if (liveStatusOf(options.sessionId) !== options.expected) finish();
    });
    timer = setTimeout(finish, options.remainingMs);
    timer.unref();
    options.signal?.addEventListener("abort", finish, { once: true });
    if (options.settled) void options.settled.then(finish);
  });
}
