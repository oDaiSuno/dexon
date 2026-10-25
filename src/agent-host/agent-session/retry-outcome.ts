import { RETRY_OUTCOME_TYPE } from "../session-entry-compat";
import type { AgentEvent } from "./types";

interface CustomEntryWriter {
  appendCustomEntry(customType: string, data?: unknown): string;
}

export class RetryOutcomeRecorder {
  private maxAttempts = 0;

  observe(event: AgentEvent, sessionManager: CustomEntryWriter): void {
    if (event.type === "auto_retry_start") {
      if (isPositiveInteger(event.maxAttempts)) this.maxAttempts = event.maxAttempts;
      return;
    }
    if (event.type !== "auto_retry_end") return;
    const maxAttempts = this.maxAttempts;
    this.maxAttempts = 0;
    if (event.success !== false) return;
    if (!isPositiveInteger(event.attempt) || maxAttempts <= 0) return;
    sessionManager.appendCustomEntry(RETRY_OUTCOME_TYPE, { attempt: event.attempt, maxAttempts });
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
