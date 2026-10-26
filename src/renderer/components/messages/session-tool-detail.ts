import { SESSION_ORCHESTRATION_LIMITS, readSessionLaunch } from "@shared/session-orchestration";
import type { ToolCallContent } from "@/lib/types";
import { thinkingLevelLabel } from "@/lib/thinking-level-label";
import { isRecord } from "./shared";

type Translate = (key: string, fallback: string) => string;

export function sessionLaunchMeta(block: ToolCallContent, details: unknown, t: Translate): string {
  const launch = readSessionLaunch(details);
  if (!launch) return "";
  const input = isRecord(block.input) ? block.input : {};
  const choseDirectory = typeof input.cwd === "string" && input.cwd.trim() !== "";
  return joinParts([
    launch.model?.modelId ?? "",
    launch.thinkingLevel
      ? t("sessionLaunchThinking", "Thinking {level}").replace("{level}", thinkingLevelLabel(launch.thinkingLevel, t))
      : "",
    choseDirectory ? directoryName(launch.cwd) : t("sessionLaunchCurrentDirectory", "Current directory"),
  ]);
}

export function sessionToolDetail(block: ToolCallContent, resultText: string | null, t: Translate): string {
  const input = isRecord(block.input) ? block.input : {};
  switch (block.toolName) {
    case "session_new":
      return joinParts([scopeLabel(input.cwd, t), pacingLabel(input, t)]);
    case "session_prompt":
      return pacingLabel(input, t);
    case "session_wait":
      return waitLimitLabel(input.timeoutSeconds, t);
    case "session_list":
      return listSummary(parseResult(resultText), t);
    default:
      return "";
  }
}

function joinParts(parts: string[]): string {
  return parts.filter(Boolean).join(" · ");
}

function directoryName(cwd: string): string {
  const trimmed = cwd.trim();
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? trimmed;
}

function scopeLabel(cwd: unknown, t: Translate): string {
  if (typeof cwd !== "string" || !cwd.trim()) return t("sessionDetailThisProject", "This project");
  return directoryName(cwd);
}

function pacingLabel(input: Record<string, unknown>, t: Translate): string {
  if (input.wait === true) return waitLimitLabel(input.timeoutSeconds, t);
  return t("sessionDetailParallel", "Parallel");
}

function waitLimitLabel(timeoutSeconds: unknown, t: Translate): string {
  const seconds =
    typeof timeoutSeconds === "number" && Number.isFinite(timeoutSeconds) && timeoutSeconds >= 0
      ? Math.trunc(timeoutSeconds)
      : SESSION_ORCHESTRATION_LIMITS.waitDefaultSeconds;
  return t("sessionDetailWaitUpTo", "Waits up to {duration}").replace("{duration}", spanLabel(seconds, t));
}

function spanLabel(seconds: number, t: Translate): string {
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return t("sessionDetailHours", "{count} h").replace("{count}", String(seconds / 3600));
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return t("sessionDetailMinutes", "{count} min").replace("{count}", String(seconds / 60));
  }
  return t("sessionDetailSeconds", "{count} s").replace("{count}", String(seconds));
}

function parseResult(resultText: string | null): Record<string, unknown> | null {
  if (!resultText) return null;
  try {
    const parsed: unknown = JSON.parse(resultText);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function listSummary(result: Record<string, unknown> | null, t: Translate): string {
  const sessions = Array.isArray(result?.sessions) ? result.sessions : null;
  if (!sessions) return t("sessionDetailThisProject", "This project");
  const running = sessions.filter((session) => isRecord(session) && session.status === "running").length;
  const total = t("sessionDetailProjectCount", "{count} in this project").replace("{count}", String(sessions.length));
  if (running === 0) return total;
  return joinParts([total, t("sessionDetailRunningCount", "{count} running").replace("{count}", String(running))]);
}
