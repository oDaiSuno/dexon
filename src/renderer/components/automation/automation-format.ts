import { translate as t } from "@/i18n";
import type { StepSpec, TriggerSpec } from "@shared/automation/spec";
import type { TaskView } from "@shared/automation/views";

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}
export function formatDateTime(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return new Intl.DateTimeFormat(document.documentElement.lang || "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ms);
}
export function formatRelativeTime(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const seconds = Math.round((ms - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(document.documentElement.lang || "en-US", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}
export function formatDuration(start: number | null | undefined, end?: number | null): string {
  if (start == null) return "—";
  const seconds = Math.max(0, Math.floor(((end ?? Date.now()) - start) / 1000));
  if (seconds < 60) return `${seconds}${t("autoPageSeconds", "s")}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}${t("autoPageMinutes", "m")} ${seconds % 60}${t("autoPageSeconds", "s")}`;
  return `${Math.floor(minutes / 60)}${t("autoPageHours", "h")} ${minutes % 60}${t("autoPageMinutes", "m")}`;
}
export function formatTrigger(trigger: TriggerSpec): string {
  if (trigger.kind === "manual") return t("autoPageManualTrigger", "Manual trigger");
  if (trigger.kind === "watch")
    return `${t("autoPageWatchEvery", "Watch every")} ${trigger.every} · ${trigger.probe.action}`;
  if ("every" in trigger) return `${t("autoPageScheduleEvery", "Repeat every")} ${trigger.every}`;
  const fields = trigger.cron.trim().split(/\s+/);
  if (
    fields.length === 5 &&
    /^\d+$/.test(fields[0]) &&
    /^\d+$/.test(fields[1]) &&
    fields.slice(2).every((field) => field === "*")
  ) {
    return `${t("autoPageDailyAt", "Daily at")} ${fields[1].padStart(2, "0")}:${fields[0].padStart(2, "0")} · ${trigger.tz ?? "UTC"}`;
  }
  if (fields.length === 5 && /^\*\/\d+$/.test(fields[0]) && fields.slice(1).every((field) => field === "*")) {
    return `${t("autoPageScheduleEvery", "Repeat every")} ${fields[0].slice(2)}${t("autoPageMinutes", "m")}`;
  }
  return `${trigger.cron} · ${trigger.tz ?? "UTC"}`;
}
export function formatStepKind(step: StepSpec): string {
  if (step.kind === "agent") return t("autoPageAgentStep", "AI step");
  if (step.kind === "wait") {
    if (step.wait.kind === "approval") return t("autoPageApprovalStep", "Human approval");
    if (step.wait.kind === "signal") return t("autoPageSignalStep", "Wait for signal");
    return t("autoPageDelayStep", "Delay");
  }
  if (step.call.action === "http.request") return t("autoPageHttpStep", "HTTP request");
  if (step.call.action === "script.run") return t("autoPageScriptStep", "Local script");
  return t("autoPageChannelStep", "Channel notification");
}
export function taskStatus(task: TaskView): string {
  if (task.enabledRevision === task.currentRevision)
    return `${t("autoPageTaskEnabled", "Enabled")} · v${task.currentRevision}`;
  return `${t("autoPageTaskPausedDraft", "Paused · Draft")} v${task.currentRevision}`;
}
export function isActivePhase(phase: string): boolean {
  return ["pending", "ready", "running", "waiting", "attention", "backoff", "cancelling"].includes(phase);
}
export function matchesPhaseFilter(phase: string, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return ["attention", "waiting"].includes(phase);
  if (filter === "running") return ["running", "pending", "ready", "backoff", "cancelling"].includes(phase);
  if (filter === "completed") return phase === "succeeded";
  return ["failed", "rejected", "cancelled", "expired", "superseded"].includes(phase);
}
