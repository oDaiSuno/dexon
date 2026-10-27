import type { SessionLiveStatus } from "../../shared/session-orchestration";

type OutcomeEvent = { type: string; message?: unknown };

export type AssistantTurnOutcome = { kind: "error"; error: string } | { kind: "stopped" };

interface AssistantLike {
  role?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
}

function assistantMessageOf(message: unknown): AssistantLike | null {
  if (!message || typeof message !== "object") return null;
  const typed = message as AssistantLike;
  return typed.role === "assistant" ? typed : null;
}

function outcomeOf(message: AssistantLike): AssistantTurnOutcome | null {
  if (message.stopReason === "aborted") return { kind: "stopped" };
  const reported = typeof message.errorMessage === "string" ? message.errorMessage.trim() : "";
  if (!reported && message.stopReason !== "error") return null;
  return { kind: "error", error: reported || "The last turn failed" };
}

export function lastAssistantOutcome(messages: unknown): AssistantTurnOutcome | null {
  if (!Array.isArray(messages)) return null;
  const last = [...messages].reverse().find((message) => (message as { role?: unknown })?.role === "assistant");
  const typed = assistantMessageOf(last);
  return typed ? outcomeOf(typed) : null;
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

  fail(message: string): void {
    this.lastError = message;
  }

  stop(): void {
    this.lastError = null;
  }

  observe(event: OutcomeEvent): void {
    if (event.type !== "message_end") return;
    const message = assistantMessageOf(event.message);
    if (!message) return;
    const outcome = outcomeOf(message);
    this.lastError = outcome?.kind === "error" ? outcome.error : null;
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
