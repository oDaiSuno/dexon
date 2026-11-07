import type { EnvironmentView } from "@contract/environment";
import {
  provisioningStepOf,
  type BlockedDiagnosis,
  type EnvironmentStatus,
  type ProvisioningStep,
} from "@contract/environment-status";

export type ConnectionTone = "online" | "pending" | "offline" | "blocked";

export interface ConnectionPresentation {
  tone: ConnectionTone;
  status: { kind: EnvironmentStatus["phase"]; label: string };
  step: ProvisioningStep | null;
  progress: number | null;
  countdown: number | null;
  canSend: boolean;
  primaryAction: "reconnect-now" | "connect" | "open-settings" | null;
  diagnosis: BlockedDiagnosis | null;
}

const phasePresentation = {
  available: { tone: "offline", label: "Available", primaryAction: "connect" },
  connected: { tone: "online", label: "Online", primaryAction: null },
  connecting: { tone: "pending", label: "Connecting", primaryAction: null },
  backoff: { tone: "pending", label: "Reconnecting", primaryAction: "reconnect-now" },
  offline: { tone: "offline", label: "Offline", primaryAction: "connect" },
  blocked: { tone: "blocked", label: "Needs attention", primaryAction: "open-settings" },
} satisfies Record<
  EnvironmentStatus["phase"],
  Pick<ConnectionPresentation, "tone" | "primaryAction"> & { label: string }
>;

export function presentConnection(view: EnvironmentView, now: number): ConnectionPresentation {
  const status = view.status;
  const phase = phasePresentation[status.phase];
  const isPrimaryAvailable = view.target.kind === "primary" && status.phase === "available";
  const progress = status.phase === "connecting" ? status.progress : null;
  const seconds = status.phase === "backoff" ? Math.ceil((status.retryAt - now) / 1_000) : null;
  return {
    tone: isPrimaryAvailable ? "online" : phase.tone,
    status: { kind: status.phase, label: phase.label },
    step: status.phase === "connecting" ? provisioningStepOf(status.stage) : null,
    progress: progress !== null && Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : null,
    countdown: seconds === null ? null : Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
    canSend: view.enabled && (isPrimaryAvailable || status.phase === "connected"),
    primaryAction: isPrimaryAvailable ? null : phase.primaryAction,
    diagnosis: status.phase === "blocked" ? status.diagnosis : null,
  };
}
