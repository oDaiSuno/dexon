import type { ReactNode } from "react";
import type { SessionActivityStatus } from "@shared/session-orchestration";
import { isRecord } from "./shared";

type Translate = (key: string, fallback: string) => string;

export type SessionToolOutcome =
  "running" | "failed" | "done" | "busy" | "attention" | "error" | "stopped" | "closed" | "timeout";

export function sessionToolVerb(toolName: string, t: Translate): string {
  switch (toolName) {
    case "session_new":
      return t("sessionToolNew", "New session");
    case "session_prompt":
      return t("sessionToolPrompt", "Send task");
    case "session_wait":
      return t("sessionToolWait", "Wait for session");
    case "session_list":
      return t("sessionToolList", "List sessions");
    case "session_read":
      return t("sessionToolRead", "Read session");
    case "session_stop":
      return t("sessionToolStop", "Stop session");
    case "session_close":
      return t("sessionToolClose", "Close session");
    case "session_models":
      return t("sessionToolModels", "List models");
    case "session_set_model":
      return t("sessionToolSetModel", "Switch model");
    default:
      return toolName;
  }
}

export function sessionOutcomeLabel(outcome: SessionToolOutcome, t: Translate): string {
  switch (outcome) {
    case "running":
      return t("toolRunning", "running");
    case "failed":
      return t("toolFailed", "failed");
    case "busy":
      return t("sessionOutcomeBusy", "Running");
    case "attention":
      return t("sessionStatusAwaitingInput", "Waiting for your answer");
    case "error":
      return t("sessionStatusError", "Failed");
    case "stopped":
      return t("sessionOutcomeStopped", "Stopped");
    case "closed":
      return t("sessionOutcomeClosed", "Closed");
    case "timeout":
      return t("sessionOutcomeTimeout", "Timed out");
    default:
      return t("sessionOutcomeDone", "Done");
  }
}

export function reportedSessionStatus(resultText: string | null): string | null {
  if (!resultText) return null;
  try {
    const parsed: unknown = JSON.parse(resultText);
    return isRecord(parsed) && typeof parsed.status === "string" ? parsed.status : null;
  } catch {
    return null;
  }
}

const LIVE_OUTCOMES: Partial<Record<SessionActivityStatus, SessionToolOutcome>> = {
  running: "busy",
  awaiting_input: "attention",
  error: "error",
};

const SETTLED_OUTCOMES: Record<string, SessionToolOutcome> = {
  stopped: "stopped",
  closed: "closed",
  timeout: "timeout",
};

export function resolveSessionOutcome({
  toolName,
  isRunning,
  isError,
  activity,
  reported,
  failed,
}: {
  toolName: string;
  isRunning: boolean;
  isError: boolean;
  activity: SessionActivityStatus | null;
  reported: string | null;
  failed?: boolean;
}): SessionToolOutcome {
  if (isRunning) return "running";
  if (isError || failed) return "failed";
  const live = activity ? LIVE_OUTCOMES[activity] : undefined;
  if (live) return live;
  if (toolName === "session_stop") return "stopped";
  return (reported && SETTLED_OUTCOMES[reported]) || "done";
}

export function sessionOutcomeTone(outcome: SessionToolOutcome): string {
  switch (outcome) {
    case "running":
      return "running";
    case "busy":
      return "busy";
    case "attention":
      return "warning";
    case "failed":
    case "error":
      return "danger";
    case "done":
      return "success";
    default:
      return "neutral";
  }
}

function Glyph({ size, strokeWidth, children }: { size: number; strokeWidth: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

const MESSAGE_SQUARE =
  "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z";

export function SessionBotGlyph() {
  return (
    <Glyph size={12} strokeWidth={2}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </Glyph>
  );
}

export function SessionToolGlyph({ toolName }: { toolName: string }) {
  switch (toolName) {
    case "session_prompt":
      return (
        <Glyph size={14} strokeWidth={1.75}>
          <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
          <path d="m21.854 2.147-10.94 10.939" />
        </Glyph>
      );
    case "session_wait":
      return (
        <Glyph size={14} strokeWidth={1.75}>
          <path d="M5 22h14" />
          <path d="M5 2h14" />
          <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
          <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
        </Glyph>
      );
    case "session_list":
      return (
        <Glyph size={14} strokeWidth={1.75}>
          <path d="M3 5h.01" />
          <path d="M3 12h.01" />
          <path d="M3 19h.01" />
          <path d="M8 5h13" />
          <path d="M8 12h13" />
          <path d="M8 19h13" />
        </Glyph>
      );
    case "session_read":
      return (
        <Glyph size={14} strokeWidth={1.75}>
          <path d="M15 12h-5" />
          <path d="M15 8h-5" />
          <path d="M19 17V5a2 2 0 0 0-2-2H4" />
          <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
        </Glyph>
      );
    case "session_stop":
      return (
        <Glyph size={14} strokeWidth={1.75}>
          <circle cx="12" cy="12" r="10" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </Glyph>
      );
    case "session_close":
      return (
        <Glyph size={14} strokeWidth={1.75}>
          <path d={MESSAGE_SQUARE} />
          <path d="m14.5 8.5-5 5" />
          <path d="m9.5 8.5 5 5" />
        </Glyph>
      );
    default:
      return (
        <Glyph size={14} strokeWidth={1.75}>
          <path d={MESSAGE_SQUARE} />
          <path d="M12 8v6" />
          <path d="M9 11h6" />
        </Glyph>
      );
  }
}
