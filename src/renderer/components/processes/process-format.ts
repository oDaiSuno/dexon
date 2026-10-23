import type { ManagedProcessPublicInfo } from "@contract/processes";
import { isManagedProcessActiveState } from "@contract/processes";

type Translate = (key: string, fallback: string) => string;

export type ProcessTone = "success" | "running" | "danger" | "idle";

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function formatDuration(startedAt: number | undefined, stoppedAt: number | undefined, now: number): string {
  if (!startedAt) return "—";
  const seconds = Math.max(0, Math.floor(((stoppedAt ?? now) - startedAt) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${twoDigits(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${twoDigits(minutes % 60)}m`;
}

export function isFailedProcess(process: ManagedProcessPublicInfo): boolean {
  return process.state === "failed" || process.state === "lost";
}

export function processTone(process: ManagedProcessPublicInfo): ProcessTone {
  if (isFailedProcess(process)) return "danger";
  if (process.state === "ready") return "success";
  if (isManagedProcessActiveState(process.state)) return "running";
  return "idle";
}

export function processStateLabel(process: ManagedProcessPublicInfo, t: Translate): string {
  switch (process.state) {
    case "ready":
      return t("managedProcessStateReady", "Ready");
    case "running":
      return t("managedProcessStateRunning", "Running");
    case "created":
    case "starting":
      return t("managedProcessStateStarting", "Starting");
    case "stopping":
      return t("managedProcessStateStopping", "Stopping");
    case "restarting":
      return t("managedProcessStateRestarting", "Restarting");
    case "exited":
      return t("managedProcessStateExited", "Exited");
    case "failed":
      return t("managedProcessStateFailed", "Failed");
    case "killed":
      return t("managedProcessStateKilled", "Killed");
    case "lost":
      return t("managedProcessStateLost", "Lost");
    case "reaped":
      return t("managedProcessStateReaped", "Cleaned up");
  }
}

function processKindLabel(process: ManagedProcessPublicInfo, t: Translate): string {
  switch (process.kind) {
    case "server":
      return t("managedProcessKindServer", "Server");
    case "watcher":
      return t("managedProcessKindWatcher", "Watcher");
    case "task":
      return t("managedProcessKindTask", "Task");
  }
}

export function processExitLabel(process: ManagedProcessPublicInfo, t: Translate): string | null {
  if (process.state !== "failed" || !process.exit) return null;
  if (process.exit.code !== null) {
    return t("managedProcessExitCode", "Exit code {code}").replace("{code}", String(process.exit.code));
  }
  if (process.exit.signal) {
    return t("managedProcessExitSignal", "Signal {signal}").replace("{signal}", process.exit.signal);
  }
  return null;
}

export function processStatusText(process: ManagedProcessPublicInfo, t: Translate): string {
  return `${processStateLabel(process, t)} · ${processExitLabel(process, t) ?? processKindLabel(process, t)}`;
}

export function endpointPort(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.port) return parsed.port;
    if (parsed.protocol === "https:") return "443";
    if (parsed.protocol === "http:") return "80";
    return null;
  } catch {
    return null;
  }
}

export function summarizeProcesses(processes: ManagedProcessPublicInfo[]) {
  const running = processes.filter((process) => isManagedProcessActiveState(process.state)).length;
  const failed = processes.filter(isFailedProcess).length;
  return {
    running,
    failed,
    exited: processes.length - running - failed,
    lost: processes.some((process) => process.state === "lost"),
  };
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}
