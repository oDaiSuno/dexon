import type { AgentSessionLike } from "../../shared/pi-types";
import type { SessionSourceRef } from "../../shared/session-orchestration";
import { browserAgentRuntime } from "../browser-agent-runtime";
import { SESSION_SOURCE_TYPE } from "../session-entry-compat";
import type { AgentEvent, OrchestratedTurnOutcome } from "./types";

export interface OrchestratedTurnHost {
  readonly inner: AgentSessionLike;
  readonly sessionId: string;
  enqueueTurn<T>(task: () => Promise<T>): Promise<T>;
  waitForExtensionsBound(): Promise<void>;
  emit(event: AgentEvent): void;
  setMessageSource(source: SessionSourceRef | null): void;
  turnError(): string | null;
}

export function runOrchestratedTurn(
  host: OrchestratedTurnHost,
  params: { message: string; source?: SessionSourceRef },
): Promise<OrchestratedTurnOutcome> {
  return host.enqueueTurn(async () => {
    await host.waitForExtensionsBound();
    browserAgentRuntime.beginTurn(host.sessionId, "local");
    host.setMessageSource(params.source ?? null);
    try {
      if (params.source) {
        host.inner.sessionManager.appendCustomEntry(SESSION_SOURCE_TYPE, {
          sessionId: params.source.sessionId,
          ...(params.source.title ? { title: params.source.title } : {}),
        });
      }
      await host.inner.prompt(params.message, { source: "rpc" });
      const failure = host.turnError();
      if (failure) {
        host.emit({ type: "prompt_done" });
        return { error: failure };
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
