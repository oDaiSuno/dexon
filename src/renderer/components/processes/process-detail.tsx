import type { ReactNode } from "react";
import type { ManagedProcessPublicInfo } from "@contract/processes";
import { isManagedProcessActiveState } from "@contract/processes";
import { useI18n } from "@/i18n";
import { resolveSessionTitle, useSessionCatalog } from "@/lib/session-catalog";
import { Badge, Button, type BadgeTone } from "../form-controls";
import { formatDuration, processExitLabel, processStateLabel } from "./process-format";
import {
  DownloadGlyph,
  GlobeGlyph,
  OctagonXGlyph,
  RotateCcwGlyph,
  StopGlyph,
  WifiGlyph,
  XGlyph,
} from "./process-icons";

const LAN_WARNING = "Process may be reachable from the local network";
const LAN_ADDRESS = /\b0\.0\.0\.0\b/;

export type ProcessDetailActions = {
  openEndpoint: (url: string) => void;
  stop: (mode: "graceful" | "force") => void;
  restart: () => void;
  dismiss: () => void;
  exportDiagnostics: () => void;
};

function badgeTone(process: ManagedProcessPublicInfo): BadgeTone {
  if (process.state === "failed" || process.state === "lost") return "danger";
  if (process.state === "killed") return "warning";
  if (process.state === "ready") return "success";
  if (isManagedProcessActiveState(process.state)) return "running";
  return "muted";
}

function ownerName(process: ManagedProcessPublicInfo, catalog: ReturnType<typeof useSessionCatalog>): string {
  const title = resolveSessionTitle(process.ownerSessionId, process.ownerLabel, catalog);
  return title === process.ownerSessionId ? process.ownerSessionId.slice(-12) : title;
}

function ActionButton({
  variant,
  icon,
  label,
  busy,
  onClick,
  title,
}: {
  variant: "secondary" | "ghost";
  icon: ReactNode;
  label: string;
  busy: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <Button variant={variant} disabled={busy} title={title} onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
}

function DetailActions({
  process,
  busy,
  actions,
}: {
  process: ManagedProcessPublicInfo;
  busy: boolean;
  actions: ProcessDetailActions;
}) {
  const { t } = useI18n();
  if (process.state === "lost") return null;
  if (isManagedProcessActiveState(process.state)) {
    return (
      <div className="flex w-full flex-wrap items-center gap-[6px] pt-[2px]">
        {process.endpoints.map((endpoint) => (
          <ActionButton
            key={endpoint.id}
            variant="secondary"
            icon={<GlobeGlyph />}
            label={t("managedProcessOpenInBrowser", "Open in browser")}
            title={endpoint.url}
            busy={busy}
            onClick={() => actions.openEndpoint(endpoint.url)}
          />
        ))}
        <ActionButton
          variant="ghost"
          icon={<RotateCcwGlyph />}
          label={t("managedProcessRestart", "Restart")}
          busy={busy}
          onClick={actions.restart}
        />
        <ActionButton
          variant="ghost"
          icon={<StopGlyph />}
          label={t("stop", "Stop")}
          busy={busy}
          onClick={() => actions.stop("graceful")}
        />
        <Button
          variant="ghost"
          disabled={busy}
          aria-label={t("forceStop", "Force Stop")}
          title={t("forceStop", "Force Stop")}
          style={{ width: 32, padding: 0 }}
          onClick={() => actions.stop("force")}
        >
          <OctagonXGlyph />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-[6px] pt-[2px]">
      <ActionButton
        variant="secondary"
        icon={<RotateCcwGlyph />}
        label={t("managedProcessRerun", "Run again")}
        busy={busy}
        onClick={actions.restart}
      />
      <ActionButton
        variant="ghost"
        icon={<DownloadGlyph />}
        label={t("managedProcessExportDiagnostics", "Export diagnostics")}
        busy={busy}
        onClick={actions.exportDiagnostics}
      />
      <ActionButton
        variant="ghost"
        icon={<XGlyph />}
        label={t("dismiss", "Dismiss")}
        busy={busy}
        onClick={actions.dismiss}
      />
    </div>
  );
}

export function ProcessDetailHeader({
  process,
  now,
  busy,
  actions,
}: {
  process: ManagedProcessPublicInfo;
  now: number;
  busy: boolean;
  actions: ProcessDetailActions;
}) {
  const { t } = useI18n();
  const catalog = useSessionCatalog();
  const exitLabel = processExitLabel(process, t);
  const stateLabel = processStateLabel(process, t);
  const generation = t("managedProcessRunGeneration", "Run {count}").replace("{count}", String(process.generation));
  const finished = !isManagedProcessActiveState(process.state) && process.startedAt;

  return (
    <div
      className="flex shrink-0 flex-col gap-[8px] pt-[12px] pr-[12px] pb-[10px] pl-[16px]"
      style={{ borderBottom: "1px solid var(--fx-line-subtle)" }}
    >
      <div className="flex w-full min-w-0 items-center gap-[8px]">
        <h3 className="type-heading m-0 min-w-0 truncate" style={{ color: "var(--fx-text-primary)" }}>
          {process.label}
        </h3>
        <Badge tone={badgeTone(process)}>{exitLabel ? `${stateLabel} · ${exitLabel}` : stateLabel}</Badge>
        <span className="flex-1" />
        <span className="type-meta-default shrink-0 whitespace-nowrap" style={{ color: "var(--fx-text-tertiary)" }}>
          {finished ? `${generation} · ${formatDuration(process.startedAt, process.stoppedAt, now)}` : generation}
        </span>
      </div>
      <div className="flex w-full min-w-0 items-center gap-[6px]" style={{ color: "var(--fx-text-tertiary)" }}>
        <span className="type-mono-meta min-w-0 shrink truncate" title={process.cwdDisplay}>
          {process.cwdDisplay}
        </span>
        <span className="type-meta-default shrink-0">·</span>
        <span className="type-meta-default min-w-0 flex-1 truncate" title={process.ownerSessionId}>
          {t("ownerTask", "Owner task")} {ownerName(process, catalog)}
        </span>
      </div>
      <DetailActions process={process} busy={busy} actions={actions} />
    </div>
  );
}

function lanWarningText(process: ManagedProcessPublicInfo, t: (key: string, fallback: string) => string): string {
  const sources = [process.commandDisplay, process.lastOutput?.text ?? ""];
  return sources.some((source) => LAN_ADDRESS.test(source))
    ? t("managedProcessLanWarningAddress", "Listening on 0.0.0.0; devices on your local network can reach it")
    : t("managedProcessLanWarning", "Listening on all network addresses; devices on your local network can reach it");
}

export function ProcessNetworkWarnings({ process }: { process: ManagedProcessPublicInfo }) {
  const { t } = useI18n();
  return process.networkWarnings.map((warning) => (
    <div
      key={warning}
      className="flex shrink-0 items-center gap-[8px] px-[16px] py-[8px]"
      style={{
        background: "var(--fx-status-warning-soft)",
        borderBottom: "1px solid var(--fx-status-warning-border)",
        color: "var(--fx-status-warning-text)",
      }}
    >
      <span className="flex shrink-0">
        <WifiGlyph />
      </span>
      <p className="type-label-default m-0 min-w-0 flex-1">
        {warning === LAN_WARNING ? lanWarningText(process, t) : warning}
      </p>
    </div>
  ));
}
