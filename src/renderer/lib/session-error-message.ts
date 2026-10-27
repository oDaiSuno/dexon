import { readSessionModelRef } from "../../shared/session-orchestration.ts";
import type { SessionModelRef } from "../../shared/session-orchestration.ts";

type Translate = (key: string, fallback: string) => string;

interface EventStreamError extends Error {
  name: "EventStreamConnectionError";
  status: "timeout" | "closed";
}

function isEventStreamError(error: unknown): error is EventStreamError {
  if (!(error instanceof Error) || error.name !== "EventStreamConnectionError") return false;
  const status = (error as { status?: unknown }).status;
  return status === "timeout" || status === "closed";
}

export function unavailableModelOf(error: unknown): SessionModelRef | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; detail?: unknown };
  if (candidate.code !== "MODEL_UNAVAILABLE") return null;
  return readSessionModelRef(candidate.detail);
}

export function sessionClientErrorMessage(error: unknown, t: Translate, fallback: string): string {
  const unavailable = unavailableModelOf(error);
  if (unavailable) {
    return t("modelUnavailableSend", "Model {model} is unavailable. Switch to another model and send again.").replace(
      "{model}",
      unavailable.modelId,
    );
  }
  if (isEventStreamError(error)) {
    return error.status === "timeout"
      ? t("agentEventStreamTimeout", "Timed out connecting to the agent event stream. Please try again.")
      : t("agentEventStreamConnectFailed", "Failed to connect to the agent event stream. Please try again.");
  }
  if (error instanceof TypeError) return fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
