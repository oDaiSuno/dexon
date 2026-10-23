import { useMemo, useState, type ReactNode } from "react";
import type { ManagedProcessLogStream, ManagedProcessPublicInfo } from "@contract/processes";
import { isManagedProcessActiveState } from "@contract/processes";
import { call } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/i18n";
import { ProcessEmpty, ProcessList, ProcessListMessage, ProcessSummary } from "./processes/process-list";
import { processStateLabel } from "./processes/process-format";
import { ProcessDetailHeader, ProcessNetworkWarnings, type ProcessDetailActions } from "./processes/process-detail";
import { LOG_STREAMS, LogToolbar, LogView, StdinBar } from "./processes/process-log";
import { TriangleAlertGlyph } from "./processes/process-icons";
import { useProcessPanelState } from "./processes/use-process-panel-state";

type Props = {
  onActiveCountChange?: (count: number) => void;
  onOpenBrowser?: () => void;
};

function DangerBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="type-label-default flex shrink-0 items-center gap-[8px] px-[16px] py-[8px]"
      style={{
        borderBottom: "1px solid var(--fx-status-danger-border)",
        background: "var(--fx-status-danger-soft)",
        color: "var(--fx-status-danger-text)",
      }}
    >
      {children}
    </div>
  );
}

export function ProcessPanel({ onActiveCountChange, onOpenBrowser }: Props) {
  const { t } = useI18n();
  const {
    processes,
    selected,
    selectedId,
    setSelectedId,
    records,
    cursor,
    hasMore,
    loading,
    busy,
    error,
    now,
    logRef,
    readMore,
    invoke,
    openEndpoint,
  } = useProcessPanelState({ onActiveCountChange, onOpenBrowser });
  const [search, setSearch] = useState("");
  const [streams, setStreams] = useState<Set<ManagedProcessLogStream>>(() => new Set(LOG_STREAMS));
  const lost = processes.some((process) => process.state === "lost");
  const exportDiagnostics = () => void invoke(() => window.piBridge.exportDiagnostics());
  const toggleStream = (stream: ManagedProcessLogStream) =>
    setStreams((current) => {
      const next = new Set(current);
      if (next.has(stream)) next.delete(stream);
      else next.add(stream);
      return next;
    });
  const detailActions = (process: ManagedProcessPublicInfo): ProcessDetailActions => ({
    openEndpoint: (url) => void openEndpoint(process, url),
    stop: (mode) =>
      void invoke(() => call("processes.stop", { processId: process.processId, runId: process.runId, mode })),
    restart: () => void invoke(() => call("processes.restart", { processId: process.processId, runId: process.runId })),
    dismiss: () => void invoke(() => call("processes.dismiss", { processId: process.processId })),
    exportDiagnostics,
  });

  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return records.filter(
      (record) => streams.has(record.stream) && (!needle || record.text.toLocaleLowerCase().includes(needle)),
    );
  }, [records, search, streams]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        aria-live="polite"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
      >
        {selected
          ? `${selected.label}: ${processStateLabel(selected, t)}`
          : t("noManagedProcesses", "No background processes")}
      </div>
      {!loading && (
        <ProcessSummary
          processes={processes}
          busy={busy}
          onStopAll={(mode) => void invoke(() => call("processes.stopAll", { mode }))}
          onExportDiagnostics={exportDiagnostics}
        />
      )}
      {error && (
        <DangerBanner>
          <p className="m-0 min-w-0 flex-1" style={{ overflowWrap: "anywhere" }}>
            {error}
          </p>
        </DangerBanner>
      )}
      {lost && (
        <DangerBanner>
          <TriangleAlertGlyph />
          <p className="m-0 min-w-0 flex-1">
            {t(
              "managedProcessContainmentFailure",
              "This process tree could not be safely confirmed as stopped. New starts are disabled; stop all processes and restart the app.",
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            className="process-summary-button type-label-medium h-[26px] shrink-0 rounded-[var(--radius-chip)] px-[8px]"
            style={{ color: "var(--fx-status-danger-text)" }}
            onClick={exportDiagnostics}
          >
            {t("exportDiagnostics", "Export Diagnostics")}
          </button>
        </DangerBanner>
      )}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>
        {loading ? (
          <ProcessListMessage text={t("loading", "Loading…")} />
        ) : processes.length === 0 ? (
          <ProcessEmpty />
        ) : (
          <ProcessList
            processes={processes}
            selectedId={selectedId}
            now={now}
            onSelect={setSelectedId}
            onOpenPort={(process, url) => void openEndpoint(process, url)}
          />
        )}

        {selected && (
          <div
            className="flex min-h-[320px] min-w-0 flex-[1_0_auto] flex-col overflow-hidden"
            style={{ borderTop: "1px solid var(--fx-line-default)", background: "var(--fx-surface-raised)" }}
          >
            <ProcessDetailHeader process={selected} now={now} busy={busy} actions={detailActions(selected)} />
            <ProcessNetworkWarnings process={selected} />
            <LogToolbar
              search={search}
              onSearchChange={setSearch}
              streams={streams}
              onToggleStream={toggleStream}
              busy={busy}
              onCopyVisible={() =>
                void copyText(filteredRecords.map((record) => `[${record.stream}] ${record.text}`).join("\n"))
              }
              onExport={() =>
                void invoke(() =>
                  call("processes.export", {
                    processId: selected.processId,
                    runId: selected.runId,
                    streams: [...streams],
                  }),
                )
              }
            />
            <LogView
              process={selected}
              records={filteredRecords}
              hasMore={hasMore}
              logRef={logRef}
              onLoadMore={() => void readMore(selected.processId, selected.runId, cursor)}
            />
            {selected.stdinOpen && isManagedProcessActiveState(selected.state) && (
              <StdinBar
                busy={busy}
                onSend={async (text) => {
                  let sent = false;
                  await invoke(async () => {
                    await call("processes.write", {
                      processId: selected.processId,
                      runId: selected.runId,
                      text,
                      appendNewline: true,
                    });
                    sent = true;
                  });
                  return sent;
                }}
                onClose={() =>
                  window.confirm(t("closeStdinConfirm", "Close stdin for this process?")) &&
                  void invoke(() =>
                    call("processes.write", {
                      processId: selected.processId,
                      runId: selected.runId,
                      text: "",
                      appendNewline: false,
                      close: true,
                    }),
                  )
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
