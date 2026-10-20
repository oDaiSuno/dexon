import type { SessionLiveStatus } from "../../shared/session-orchestration";

type OutcomeEvent = { type: string; message?: unknown };

function isFailedAssistantMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const typed = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
  if (typed.role !== "assistant") return null;
  const reported = typeof typed.errorMessage === "string" ? typed.errorMessage.trim() : "";
  if (!reported && typed.stopReason !== "error") return null;
  return reported || "The last turn failed";
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
    const failure = isFailedAssistantMessage(event.message);
    if (failure) this.lastError = failure;
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
