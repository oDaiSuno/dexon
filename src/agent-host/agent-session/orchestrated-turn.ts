import type { UnavailableModelRef } from "../../contract/types";
import type { AgentSessionLike } from "../../shared/pi-types";
import type { SessionSourceRef } from "../../shared/session-orchestration";
import { browserAgentRuntime } from "../browser-agent-runtime";
import { SESSION_SOURCE_TYPE } from "../session-entry-compat";
import { unavailableModelOf } from "./model-gate";
import { type QueuedTurn, type QueuedTurns } from "./queued-turns";
import { lastAssistantOutcome } from "./turn-status";
import type { AgentEvent, OrchestratedTurnOutcome } from "./types";

export interface OrchestratedTurnHost {
  readonly inner: AgentSessionLike;
  readonly sessionId: string;
  readonly queuedTurns: QueuedTurns;
  enqueueTurn<T>(task: () => Promise<T>): Promise<T>;
  waitForExtensionsBound(): Promise<void>;
  assertModelUsable(): Promise<void>;
  recordTurnError(message: string): void;
  emit(event: AgentEvent): void;
  setMessageSource(source: SessionSourceRef | null): void;
}

function messageList(inner: AgentSessionLike): unknown[] {
  const messages = (inner.agent.state as { messages?: unknown } | undefined)?.messages;
  return Array.isArray(messages) ? messages : [];
}

function cancellableTurn(host: OrchestratedTurnHost, source: SessionSourceRef | undefined) {
  let cancelled = false;
  const turn: QueuedTurn = {
    ...(source ? { sourceSessionId: source.sessionId } : {}),
    cancel: () => {
      cancelled = true;
    },
  };
  return { cancelled: () => cancelled, release: host.queuedTurns.add(turn) };
}

export function runOrchestratedTurn(
  host: OrchestratedTurnHost,
  params: { message: string; source?: SessionSourceRef },
): Promise<OrchestratedTurnOutcome> {
  const turn = cancellableTurn(host, params.source);
  return runQueuedTurn(host, params, turn).finally(turn.release);
}

function refuseTurn(host: OrchestratedTurnHost, error: unknown): OrchestratedTurnOutcome {
  const message = error instanceof Error ? error.message : String(error);
  const unavailableModel: UnavailableModelRef | null = unavailableModelOf(error);
  host.recordTurnError(message);
  host.emit({ type: "prompt_error", errorMessage: message });
  host.emit({ type: "prompt_done" });
  return { error: message, ...(unavailableModel ? { unavailableModel } : {}) };
}

function runQueuedTurn(
  host: OrchestratedTurnHost,
  params: { message: string; source?: SessionSourceRef },
  turn: { cancelled: () => boolean },
): Promise<OrchestratedTurnOutcome> {
  return host.enqueueTurn(async () => {
    if (turn.cancelled()) return { stopped: true };
    await host.waitForExtensionsBound();
    try {
      await host.assertModelUsable();
    } catch (error) {
      return refuseTurn(host, error);
    }
    browserAgentRuntime.beginTurn(host.sessionId, "local");
    host.setMessageSource(params.source ?? null);
    try {
      if (params.source) {
        host.inner.sessionManager.appendCustomEntry(SESSION_SOURCE_TYPE, {
          sessionId: params.source.sessionId,
          ...(params.source.title ? { title: params.source.title } : {}),
        });
      }
      const before = messageList(host.inner).length;
      await host.inner.prompt(params.message, { source: "rpc" });
      const outcome = lastAssistantOutcome(messageList(host.inner).slice(before));
      if (outcome?.kind === "error") {
        host.emit({ type: "prompt_done" });
        return { error: outcome.error };
      }
      if (outcome?.kind === "stopped") {
        host.emit({ type: "prompt_done" });
        return { stopped: true };
      }
      const reply = host.inner.getLastAssistantText()?.trim() ?? "";
      host.emit({ type: "prompt_done" });
      return reply ? { reply } : {};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      host.emit({ type: "prompt_error", errorMessage: message });
      host.emit({ type: "prompt_done" });
      return { error: message };
    } finally {
      host.setMessageSource(null);
    }
  });
}
