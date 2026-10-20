import type { SessionLiveStatus } from "../../shared/session-orchestration";

type OutcomeEvent = { type: string; message?: unknown };

export type AssistantTurnOutcome = { kind: "error"; error: string } | { kind: "stopped" };

function assistantOutcome(message: unknown): AssistantTurnOutcome | null {
  if (!message || typeof message !== "object") return null;
  const typed = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
  if (typed.role !== "assistant") return null;
  if (typed.stopReason === "aborted") return { kind: "stopped" };
  const reported = typeof typed.errorMessage === "string" ? typed.errorMessage.trim() : "";
  if (!reported && typed.stopReason !== "error") return null;
  return { kind: "error", error: reported || "The last turn failed" };
}

export function lastAssistantOutcome(messages: unknown): AssistantTurnOutcome | null {
  if (!Array.isArray(messages)) return null;
  const last = [...messages].reverse().find((message) => (message as { role?: unknown })?.role === "assistant");
  return assistantOutcome(last);
}

export interface TurnStatusInput {
  alive: boolean;
  awaitingInput: boolean;
  running: boolean;
}

export class SessionTurnStatus {
  private lastError: string | null = null;

  beginTurn(): void {
    this.lastError = null;
  }

  observe(event: OutcomeEvent): void {
    if (event.type !== "message_end") return;
    const outcome = assistantOutcome(event.message);
    if (outcome?.kind === "error") this.lastError = outcome.error;
    if (outcome?.kind === "stopped") this.lastError = null;
  }

  error(): string | null {
    return this.lastError;
  }

  status(input: TurnStatusInput): SessionLiveStatus | "idle" {
    if (!input.alive) return "idle";
    if (input.awaitingInput) return "awaiting_input";
    if (input.running) return "running";
    if (this.lastError) return "error";
    return "idle";
  }
}
