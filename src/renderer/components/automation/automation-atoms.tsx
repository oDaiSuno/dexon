import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { Button } from "@/components/form-controls";
import { useAutomationWorkspace } from "./automation-context";
import { AutomationIcon } from "./automation-icons";
import { formatJson } from "./automation-format";

export function HostChip({ environmentId }: { environmentId: string }) {
  const { t } = useI18n();
  const host = useAutomationWorkspace().hosts.find((entry) => entry.environment.id === environmentId);
  const isLocal = environmentId === "primary";
  const status = host?.status ?? "offline";
  return (
    <span
      className="auto-page-host type-mono-meta"
      data-status={status}
      data-local={isLocal ? "true" : undefined}
      title={host?.error ?? environmentId}
    >
      {isLocal ? <AutomationIcon name="laptop" size={12} /> : <span className="auto-page-dot" aria-hidden="true" />}
      {isLocal ? t("autoPageLocal", "Local") : (host?.environment.label ?? environmentId)}
    </span>
  );
}
export function StatusPill({ phase, waitKind }: { phase: string; waitKind?: string | null }) {
  const { t } = useI18n();
  const statuses: Record<string, [string, string]> = {
    running: [t("autoPagePhaseRunning", "Running"), "accent"],
    waiting: [
      waitKind === "approval"
        ? t("autoPagePhaseApproval", "Awaiting approval")
        : waitKind === "signal"
          ? t("autoPagePhaseSignal", "Waiting for signal")
          : waitKind === "duration"
            ? t("autoPagePhaseDelay", "Waiting for delay")
            : t("autoPagePhaseWaiting", "Waiting"),
      "warning",
    ],
    attention: [t("autoPagePhaseAttention", "Result needs review"), "danger"],
    succeeded: [t("autoPagePhaseSucceeded", "Succeeded"), "success"],
    failed: [t("autoPagePhaseFailed", "Failed"), "danger"],
    rejected: [t("autoPagePhaseRejected", "Rejected"), "danger"],
    cancelled: [t("autoPagePhaseCancelled", "Cancelled"), "muted"],
    cancelling: [t("autoPagePhaseCancelling", "Cancelling"), "warning"],
    expired: [t("autoPagePhaseExpired", "Expired"), "muted"],
    superseded: [t("autoPagePhaseSuperseded", "Superseded"), "muted"],
    pending: [t("autoPagePhaseQueued", "Queued"), "muted"],
    ready: [t("autoPagePhaseQueued", "Queued"), "muted"],
    backoff: [t("autoPagePhaseBackoff", "Retry backoff"), "warning"],
    paused: [t("autoPagePhasePaused", "Paused"), "muted"],
    draft: [t("autoPagePhaseDraft", "Draft"), "muted"],
    offline: [t("autoPagePhaseOffline", "Offline"), "muted"],
    enabled: [t("autoPageTaskEnabled", "Enabled"), "success"],
    done: [t("autoPageStepDone", "Completed"), "success"],
    skipped: [t("autoPageStepSkipped", "Skipped"), "muted"],
    unknown: [t("autoPagePhaseAttention", "Result needs review"), "danger"],
  };
  const [label, tone] = statuses[phase] ?? [phase, "muted"];
  return (
    <span className="auto-page-status type-label-medium" data-tone={tone}>
      <span className="auto-page-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
export function NativeConsentBanner() {
  const { t } = useI18n();
  const { nativeConsentPending } = useAutomationWorkspace();
  if (!nativeConsentPending) return null;
  return createPortal(
    <div className="auto-page-native-banner type-body-medium" role="status">
      <AutomationIcon name="key" />
      <span>{t("autoPageNativeConsent", "Waiting for your approval in the system confirmation window")}</span>
      <span className="type-label-default">{nativeConsentPending.label}</span>
    </div>,
    document.body,
  );
}
export function OfflineHostNotice({ environmentId }: { environmentId: string }) {
  const { t } = useI18n();
  const workspace = useAutomationWorkspace();
  const host = workspace.hosts.find((entry) => entry.environment.id === environmentId);
  if (host?.status === "online" && !host.error) return null;
  return (
    <div className="auto-page-notice type-body-default" role="status">
      <div className="auto-page-stack-tight">
        <HostChip environmentId={environmentId} />
        <span>
          {t(
            "autoPageOfflineNotice",
            "This host is unavailable. Already-enabled remote schedules continue running on the remote server.",
          )}
        </span>
        {host?.error && <span className="auto-page-error">{host.error}</span>}
      </div>
      <Button
        busy={host?.status === "connecting"}
        disabled={host?.status === "connecting"}
        onClick={() => {
          void workspace
            .reconnectEnvironment(environmentId)
            .catch((error: unknown) => workspace.notify(error instanceof Error ? error.message : String(error)));
        }}
      >
        {t("autoPageReconnect", "Reconnect now")}
      </Button>
    </div>
  );
}
export function JsonBlock({ value }: { value: unknown }) {
  return <pre className="auto-page-json type-mono-code">{formatJson(value)}</pre>;
}
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="auto-page-empty type-body-default">{children}</div>;
}
export function PhaseFilters({
  value,
  onChange,
  completed = false,
  pendingCount = 0,
  trailing,
}: {
  value: string;
  onChange: (value: string) => void;
  completed?: boolean;
  pendingCount?: number;
  trailing?: ReactNode;
}) {
  const { t } = useI18n();
  const options = [
    { value: "all", label: t("autoPageFilterAll", "All") },
    { value: "pending", label: t("autoPageFilterPending", "Needs action"), count: pendingCount },
    { value: "running", label: t("autoPageFilterRunning", "In progress") },
    ...(completed ? [{ value: "completed", label: t("autoPageFilterCompleted", "Completed") }] : []),
    { value: "incomplete", label: t("autoPageFilterIncomplete", "Incomplete") },
  ];
  return (
    <div className="auto-page-filter-row">
      <div
        className="auto-page-filter-pills"
        role="group"
        aria-label={t("autoPagePhaseFilter", "Filter by run status")}
      >
        {options.map((option) => (
          <Button
            key={option.value}
            variant="ghost"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {"count" in option && option.count ? (
              <span className="auto-page-warning type-mono-meta">{option.count}</span>
            ) : null}
          </Button>
        ))}
      </div>
      {trailing}
    </div>
  );
}
