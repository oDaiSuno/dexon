import { useMemo, useState, type ReactNode } from "react";
import type { ManagedProcessLogStream, ManagedProcessPublicInfo } from "@contract/processes";
import { isManagedProcessActiveState } from "@contract/processes";
import { call } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/i18n";
import { ProcessEmpty, ProcessList, ProcessListMessage, ProcessSummary } from "./processes/process-list";
import { processStateLabel, processTone } from "./processes/process-format";
import { TriangleAlertGlyph } from "./processes/process-icons";
import { useProcessPanelState } from "./processes/use-process-panel-state";

type Props = {
  onActiveCountChange?: (count: number) => void;
  onOpenBrowser?: () => void;
};

const TONE_COLOR = {
  success: "var(--fx-status-success)",
  running: "var(--fx-accent-blue)",
  danger: "var(--fx-status-danger)",
  idle: "var(--fx-text-tertiary)",
} as const;

function stateColor(process: ManagedProcessPublicInfo): string {
  if (process.state === "killed" || process.state === "reaped") return "var(--fx-status-warning)";
  if (process.state === "exited" && process.exit?.code) return "var(--fx-status-danger)";
  return TONE_COLOR[processTone(process)];
}

const buttonStyle = {
  height: 28,
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-control)",
  background: "var(--fx-surface-raised)",
  color: "var(--fx-text-secondary)",
  padding: "0 8px",
  fontSize: "var(--text-meta)",
  cursor: "pointer",
} as const;

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
  const [streams, setStreams] = useState<Set<ManagedProcessLogStream>>(() => new Set(["stdout", "stderr", "system"]));
  const [stdin, setStdin] = useState("");
  const lost = processes.some((process) => process.state === "lost");
  const exportDiagnostics = () => void invoke(() => window.piBridge.exportDiagnostics());

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
            style={{
              display: "flex",
              flex: "1 0 auto",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 320,
              borderTop: "1px solid var(--fx-line-default)",
              background: "var(--fx-surface-raised)",
            }}
          >
            <div
              style={{
                padding: "12px 12px",
                borderBottom: "1px solid var(--fx-line-default)",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong
                  style={{
                    fontSize: "var(--text-body)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {selected.label}
                </strong>
                <span style={{ color: stateColor(selected), fontSize: "var(--text-meta)" }}>
                  {processStateLabel(selected, t)}
                </span>
                <span style={{ marginLeft: "auto", color: "var(--fx-text-tertiary)", fontSize: "var(--text-micro)" }}>
                  run {selected.generation}
                </span>
              </div>
              <div
                title={selected.commandDisplay}
                style={{
                  color: "var(--fx-text-secondary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-micro)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {selected.commandDisplay}
              </div>
              <div style={{ color: "var(--fx-text-tertiary)", fontSize: "var(--text-micro)" }}>
                {selected.cwdDisplay} · {selected.kind} · {selected.readiness}
                {selected.exit ? ` · exit ${selected.exit.code ?? selected.exit.signal ?? "unknown"}` : ""}
              </div>
              <div
                style={{ color: "var(--fx-text-tertiary)", fontSize: "var(--text-micro)" }}
                title={selected.ownerSessionId}
              >
                {t("ownerTask", "Owner task")}: {selected.ownerSessionId.slice(-12)}
              </div>
              {selected.networkWarnings.map((warning) => (
                <div key={warning} style={{ color: "var(--fx-status-warning)", fontSize: "var(--text-micro)" }}>
                  {warning === "Process may be reachable from the local network"
                    ? t("managedProcessLanWarning", "Process may be reachable from the local network")
                    : warning}
                </div>
              ))}
              {selected.endpoints.map((endpoint) => (
                <button
                  key={endpoint.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void openEndpoint(selected, endpoint.url)}
                  style={{ ...buttonStyle, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {t("openInBrowser", "Open in Browser")}: {endpoint.url}
                </button>
              ))}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {isManagedProcessActiveState(selected.state) ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      style={buttonStyle}
                      onClick={() =>
                        void invoke(() =>
                          call("processes.stop", {
                            processId: selected.processId,
                            runId: selected.runId,
                            mode: "graceful",
                          }),
                        )
                      }
                    >
                      {t("stop", "Stop")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      style={buttonStyle}
                      onClick={() =>
                        void invoke(() =>
                          call("processes.stop", {
                            processId: selected.processId,
                            runId: selected.runId,
                            mode: "force",
                          }),
                        )
                      }
                    >
                      {t("forceStop", "Force Stop")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      style={buttonStyle}
                      onClick={() =>
                        void invoke(() =>
                          call("processes.restart", {
                            processId: selected.processId,
                            runId: selected.runId,
                          }),
                        )
                      }
                    >
                      {t("restart", "Restart")}
                    </button>
                  </>
                ) : selected.state === "lost" ? null : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      style={buttonStyle}
                      onClick={() =>
                        void invoke(() =>
                          call("processes.restart", { processId: selected.processId, runId: selected.runId }),
                        )
                      }
                    >
                      {t("restart", "Restart")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      style={buttonStyle}
                      onClick={() => void invoke(() => call("processes.dismiss", { processId: selected.processId }))}
                    >
                      {t("dismiss", "Dismiss")}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy}
                  style={buttonStyle}
                  onClick={() =>
                    void invoke(() =>
                      call("processes.export", {
                        processId: selected.processId,
                        runId: selected.runId,
                        streams: [...streams],
                      }),
                    )
                  }
                >
                  {t("exportLogs", "Export Logs")}
                </button>
              </div>
            </div>

            <div
              style={{
                padding: "8px 8px",
                display: "flex",
                gap: 8,
                borderBottom: "1px solid var(--fx-line-default)",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchLogs", "Search logs")}
                style={{
                  flex: 1,
                  minWidth: 100,
                  height: 26,
                  border: "1px solid var(--fx-line-default)",
                  borderRadius: "var(--radius-control)",
                  background: "var(--fx-surface-main)",
                  color: "var(--fx-text-primary)",
                  padding: "0 8px",
                  fontSize: "var(--text-meta)",
                }}
              />
              {(["stdout", "stderr", "system"] as ManagedProcessLogStream[]).map((stream) => (
                <label
                  key={stream}
                  style={{
                    fontSize: "var(--text-micro)",
                    color: "var(--fx-text-secondary)",
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={streams.has(stream)}
                    onChange={(event) =>
                      setStreams((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(stream);
                        else next.delete(stream);
                        return next;
                      })
                    }
                  />
                  {stream}
                </label>
              ))}
              <button
                type="button"
                style={buttonStyle}
                onClick={() =>
                  void copyText(filteredRecords.map((record) => `[${record.stream}] ${record.text}`).join("\n"))
                }
              >
                {t("copyVisible", "Copy Visible")}
              </button>
            </div>

            <div
              ref={logRef}
              role="log"
              aria-label={t("managedProcessLogs", "Managed process logs")}
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                padding: "8px 12px",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-micro)",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {filteredRecords.map((record) => (
                <div
                  key={`${record.runId}:${record.seq}`}
                  style={{
                    color:
                      record.stream === "stderr"
                        ? "var(--fx-status-danger)"
                        : record.stream === "system"
                          ? "var(--fx-status-warning)"
                          : "var(--fx-text-secondary)",
                  }}
                >
                  <span style={{ color: "var(--fx-text-tertiary)" }}>[{record.stream}] </span>
                  {record.text}
                </div>
              ))}
              {hasMore && (
                <button
                  type="button"
                  style={{ ...buttonStyle, marginTop: 8 }}
                  onClick={() => void readMore(selected.processId, selected.runId, cursor)}
                >
                  {t("loadMoreLogs", "Load more logs")}
                </button>
              )}
            </div>

            {selected.stdinOpen && isManagedProcessActiveState(selected.state) && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!stdin) return;
                  void invoke(async () => {
                    await call("processes.write", {
                      processId: selected.processId,
                      runId: selected.runId,
                      text: stdin,
                      appendNewline: true,
                    });
                    setStdin("");
                  });
                }}
                style={{ padding: 8, borderTop: "1px solid var(--fx-line-default)", display: "flex", gap: 8 }}
              >
                <input
                  value={stdin}
                  onChange={(event) => setStdin(event.target.value)}
                  placeholder={t("processStdin", "Send line to stdin")}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 28,
                    border: "1px solid var(--fx-line-default)",
                    borderRadius: "var(--radius-control)",
                    background: "var(--fx-surface-main)",
                    color: "var(--fx-text-primary)",
                    padding: "0 8px",
                    fontSize: "var(--text-meta)",
                  }}
                />
                <button type="submit" disabled={busy || !stdin} style={buttonStyle}>
                  {t("send", "Send")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  style={buttonStyle}
                  onClick={() =>
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
                >
                  {t("closeStdin", "Close stdin")}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
