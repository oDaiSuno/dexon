import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { ManagedProcessPublicInfo } from "@contract/processes";
import { useI18n } from "@/i18n";
import {
  endpointPort,
  formatDuration,
  isFailedProcess,
  processStatusText,
  processTone,
  summarizeProcesses,
} from "./process-format";
import {
  CircleXGlyph,
  EllipsisGlyph,
  SquareArrowOutUpRightGlyph,
  SquareGlyph,
  SquareTerminalGlyph,
} from "./process-icons";

const SUMMARY_DOT = {
  running: "var(--fx-accent-blue)",
  exited: "var(--fx-text-faint)",
  failed: "var(--fx-status-danger)",
} as const;

const STATE_DOT = {
  success: "var(--fx-status-success)",
  running: "var(--fx-accent-blue)",
  idle: "var(--fx-text-faint)",
} as const;

function SummaryItem({ tone, label }: { tone: "running" | "exited" | "failed"; label: string }) {
  return (
    <span
      className="type-label-default inline-flex items-center gap-[6px] whitespace-nowrap"
      style={{ color: "var(--fx-text-tertiary)" }}
    >
      <span className="size-[6px] rounded-[3px]" style={{ background: SUMMARY_DOT[tone] }} />
      {label}
    </span>
  );
}

function MoreMenu({
  busy,
  onForceStopAll,
  onExportDiagnostics,
}: {
  busy: boolean;
  onForceStopAll: () => void;
  onExportDiagnostics: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="process-summary-button flex size-[26px] shrink-0 items-center justify-center rounded-[var(--radius-chip)] p-0"
        style={{ color: "var(--fx-text-tertiary)" }}
        aria-label={t("managedProcessMoreActions", "More actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <EllipsisGlyph />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("managedProcessMoreActions", "More actions")}
          className="session-menu-card session-menu-card--menu composer-pop-in"
        >
          <div className="session-menu-list">
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              className="session-menu-item type-body-large"
              onClick={() => choose(onExportDiagnostics)}
            >
              <span className="session-menu-item-label">{t("exportDiagnostics", "Export Diagnostics")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              className="session-menu-item session-menu-item--danger type-body-large"
              onClick={() => choose(onForceStopAll)}
            >
              <span className="session-menu-item-label">{t("managedProcessForceStopAll", "Force stop all")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProcessSummary({
  processes,
  busy,
  onStopAll,
  onExportDiagnostics,
}: {
  processes: ManagedProcessPublicInfo[];
  busy: boolean;
  onStopAll: (mode: "graceful" | "force") => void;
  onExportDiagnostics: () => void;
}) {
  const { t } = useI18n();
  const summary = summarizeProcesses(processes);

  return (
    <div
      className="flex h-[40px] shrink-0 items-center gap-[12px] pr-[12px] pl-[16px]"
      style={{ background: "var(--fx-surface-sidebar)", borderBottom: "1px solid var(--fx-line-default)" }}
    >
      {processes.length === 0 ? (
        <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("managedProcessSummaryIdle", "No processes running")}
        </span>
      ) : (
        <>
          {summary.running > 0 && (
            <SummaryItem
              tone="running"
              label={t("managedProcessSummaryRunning", "{count} running").replace("{count}", String(summary.running))}
            />
          )}
          {summary.failed > 0 && (
            <SummaryItem
              tone="failed"
              label={t("managedProcessSummaryFailed", "{count} failed").replace("{count}", String(summary.failed))}
            />
          )}
          {summary.exited > 0 && (
            <SummaryItem
              tone="exited"
              label={t("managedProcessSummaryExited", "{count} exited").replace("{count}", String(summary.exited))}
            />
          )}
        </>
      )}
      <span className="flex-1" />
      {processes.length > 0 && (
        <>
          <button
            type="button"
            className="process-summary-button type-label-medium flex h-[26px] shrink-0 items-center gap-[6px] rounded-[var(--radius-chip)] px-[8px]"
            style={{ color: "var(--fx-text-secondary)" }}
            disabled={busy || (summary.running === 0 && !summary.lost)}
            onClick={() => onStopAll(summary.lost ? "force" : "graceful")}
          >
            <SquareGlyph />
            {t("stopAll", "Stop All")}
          </button>
          <MoreMenu busy={busy} onForceStopAll={() => onStopAll("force")} onExportDiagnostics={onExportDiagnostics} />
        </>
      )}
    </div>
  );
}

function ProcessState({ process }: { process: ManagedProcessPublicInfo }) {
  const tone = processTone(process);
  return (
    <span
      className="flex size-[14px] shrink-0 items-center justify-center"
      style={{ color: "var(--fx-status-danger-text)" }}
    >
      {tone === "danger" ? (
        <CircleXGlyph />
      ) : (
        <span
          className={tone === "idle" ? "size-[8px] rounded-[4px]" : "process-card-pulse size-[8px] rounded-[4px]"}
          style={{ background: STATE_DOT[tone] }}
        />
      )}
    </span>
  );
}

function ProcessCard({
  process,
  selected,
  now,
  onSelect,
  onOpenPort,
}: {
  process: ManagedProcessPublicInfo;
  selected: boolean;
  now: number;
  onSelect: () => void;
  onOpenPort: (url: string) => void;
}) {
  const { t } = useI18n();
  const failed = isFailedProcess(process);
  const endpoint = process.endpoints[0];
  const port = endpoint ? endpointPort(endpoint.url) : null;
  const openPort = (event: MouseEvent) => {
    event.stopPropagation();
    if (endpoint) onOpenPort(endpoint.url);
  };

  return (
    <button
      type="button"
      className="process-card flex w-full flex-col gap-[4px] rounded-[var(--radius-control)] p-[10px] text-left"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="flex w-full min-w-0 items-center gap-[8px]">
        <ProcessState process={process} />
        <span className="type-body-medium min-w-0 flex-1 truncate" style={{ color: "var(--fx-text-primary)" }}>
          {process.label}
        </span>
        {endpoint && port && (
          <span
            className="process-card-port type-mono-meta inline-flex h-[20px] shrink-0 items-center gap-[4px] rounded-[var(--radius-kbd)] px-[6px]"
            style={{ background: "var(--fx-surface-inset)", color: "var(--fx-text-secondary)" }}
            title={`${t("openInBrowser", "Open in Browser")}: ${endpoint.url}`}
            onClick={openPort}
          >
            :{port}
            <span className="flex" style={{ color: "var(--fx-text-tertiary)" }}>
              <SquareArrowOutUpRightGlyph />
            </span>
          </span>
        )}
        <span className="type-mono-meta shrink-0 whitespace-nowrap" style={{ color: "var(--fx-text-tertiary)" }}>
          {formatDuration(process.startedAt, process.stoppedAt, now)}
        </span>
      </span>
      <span
        className="flex w-full min-w-0 items-center gap-[6px] pl-[22px]"
        style={{ color: "var(--fx-text-tertiary)" }}
      >
        <span
          className="type-meta-default shrink-0 whitespace-nowrap"
          style={failed ? { color: "var(--fx-status-danger-text)" } : undefined}
        >
          {processStatusText(process, t)}
        </span>
        <span className="type-meta-default shrink-0">·</span>
        <span className="type-mono-meta min-w-0 flex-1 truncate" title={process.commandDisplay}>
          {process.commandDisplay}
        </span>
      </span>
      {!failed && process.lastOutput && (
        <span className="type-mono-meta block w-full truncate pl-[22px]" style={{ color: "var(--fx-text-secondary)" }}>
          {process.lastOutput.text}
        </span>
      )}
    </button>
  );
}

export function ProcessList({
  processes,
  selectedId,
  now,
  onSelect,
  onOpenPort,
}: {
  processes: ManagedProcessPublicInfo[];
  selectedId: string | null;
  now: number;
  onSelect: (processId: string) => void;
  onOpenPort: (process: ManagedProcessPublicInfo, url: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-[2px] p-[8px]">
      {processes.map((process) => (
        <ProcessCard
          key={process.processId}
          process={process}
          selected={process.processId === selectedId}
          now={now}
          onSelect={() => onSelect(process.processId)}
          onOpenPort={(url) => onOpenPort(process, url)}
        />
      ))}
    </div>
  );
}

export function ProcessEmpty() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[10px] px-[48px] text-center">
      <span
        className="flex size-[44px] items-center justify-center rounded-[var(--radius-menu)]"
        style={{
          border: "1px solid var(--fx-line-subtle)",
          background: "var(--fx-surface-inset)",
          color: "var(--fx-text-tertiary)",
        }}
      >
        <SquareTerminalGlyph />
      </span>
      <span className="type-heading" style={{ color: "var(--fx-text-primary)" }}>
        {t("noManagedProcesses", "No background processes")}
      </span>
      <span className="type-label-default text-balance" style={{ color: "var(--fx-text-tertiary)" }}>
        {t(
          "managedProcessEmptyDescription",
          "Dev servers and watchers started by the Agent show up here. View their logs, restart, or stop them anytime.",
        )}
      </span>
    </div>
  );
}

export function ProcessListMessage({ text, tone }: { text: string; tone?: "danger" }) {
  return (
    <div
      className="type-label-default p-[16px]"
      style={{ color: tone === "danger" ? "var(--fx-status-danger-text)" : "var(--fx-text-tertiary)" }}
    >
      {text}
    </div>
  );
}
