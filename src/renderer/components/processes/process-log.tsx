import { useState, type FormEvent, type RefObject } from "react";
import type { ManagedProcessLogRecord, ManagedProcessLogStream, ManagedProcessPublicInfo } from "@contract/processes";
import { isManagedProcessActiveState } from "@contract/processes";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { formatClock } from "./process-format";
import { ArrowRightGlyph, CopyGlyph, DownloadGlyph, SearchGlyph, XGlyph } from "./process-icons";

export const LOG_STREAMS: ManagedProcessLogStream[] = ["stdout", "stderr", "system"];

const STREAM_TAG: Record<ManagedProcessLogStream, string> = { stdout: "out", stderr: "err", system: "sys" };

const STREAM_TAG_COLOR: Record<ManagedProcessLogStream, string> = {
  stdout: "var(--fx-text-tertiary)",
  stderr: "var(--fx-status-danger-text)",
  system: "var(--fx-accent-blue-text)",
};

const SUCCESS_LINE = /(?:^\s*[✓✔])|\b(?:ready in|passed|compiled successfully|succeeded)\b/i;
const FAILURE_WORD = /\b(?:fail(?:ed|ure)?|errors?)\b|✗/i;

function lineColor(record: ManagedProcessLogRecord): string {
  if (record.stream === "stderr") return "var(--fx-status-danger-text)";
  if (record.stream === "system") return "var(--fx-text-secondary)";
  if (SUCCESS_LINE.test(record.text) && !FAILURE_WORD.test(record.text)) return "var(--fx-status-success-text)";
  return "var(--fx-text-body)";
}

const iconButtonClass =
  "process-summary-button flex size-[26px] shrink-0 items-center justify-center rounded-[var(--radius-chip)] p-0";

export function LogToolbar({
  search,
  onSearchChange,
  streams,
  onToggleStream,
  onCopyVisible,
  onExport,
  busy,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  streams: ReadonlySet<ManagedProcessLogStream>;
  onToggleStream: (stream: ManagedProcessLogStream) => void;
  onCopyVisible: () => void;
  onExport: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex h-[36px] shrink-0 items-center gap-[6px] pr-[8px] pl-[12px]"
      style={{ borderBottom: "1px solid var(--fx-line-subtle)" }}
    >
      <label
        className="flex h-[26px] min-w-0 flex-1 items-center gap-[6px] rounded-[var(--radius-chip)] px-[8px]"
        style={{ background: "var(--fx-surface-inset)", color: "var(--fx-text-tertiary)" }}
      >
        <SearchGlyph />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("searchLogs", "Search logs")}
          aria-label={t("searchLogs", "Search logs")}
          className="type-label-default h-full min-w-0 flex-1 border-0 bg-transparent p-0 outline-none placeholder:text-[var(--fx-text-tertiary)]"
          style={{ color: "var(--fx-text-primary)" }}
        />
      </label>
      <div
        role="group"
        aria-label={t("managedProcessLogStreams", "Log streams")}
        className="flex shrink-0 items-center gap-[2px] rounded-[var(--radius-chip)] p-[2px]"
        style={{ background: "var(--fx-surface-inset)" }}
      >
        {LOG_STREAMS.map((stream) => {
          const active = streams.has(stream);
          return (
            <button
              key={stream}
              type="button"
              aria-pressed={active}
              title={stream}
              className="type-mono-meta flex h-[20px] cursor-pointer items-center rounded-[var(--radius-xs)] border-0 px-[6px]"
              style={
                active
                  ? {
                      background: "var(--fx-surface-raised)",
                      boxShadow: "var(--shadow-tab)",
                      color: "var(--fx-text-primary)",
                    }
                  : { background: "var(--fx-surface-hover-clear)", color: "var(--fx-text-tertiary)" }
              }
              onClick={() => onToggleStream(stream)}
            >
              {STREAM_TAG[stream]}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={iconButtonClass}
        style={{ color: "var(--fx-text-tertiary)" }}
        aria-label={t("copyVisible", "Copy Visible")}
        title={t("copyVisible", "Copy Visible")}
        onClick={onCopyVisible}
      >
        <CopyGlyph />
      </button>
      <button
        type="button"
        disabled={busy}
        className={iconButtonClass}
        style={{ color: "var(--fx-text-tertiary)" }}
        aria-label={t("exportLogs", "Export Logs")}
        title={t("exportLogs", "Export Logs")}
        onClick={onExport}
      >
        <DownloadGlyph size={13} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function LogLine({ record }: { record: ManagedProcessLogRecord }) {
  return (
    <div
      className="type-mono-meta flex h-[20px] w-full shrink-0 items-center gap-[10px] px-[12px]"
      style={record.stream === "stderr" ? { background: "var(--fx-status-danger-soft)" } : undefined}
    >
      <span className="shrink-0 whitespace-nowrap" style={{ color: "var(--fx-text-tertiary)" }}>
        {formatClock(record.timestamp)}
      </span>
      <span className="w-[22px] shrink-0" style={{ color: STREAM_TAG_COLOR[record.stream] }}>
        {STREAM_TAG[record.stream]}
      </span>
      <span
        className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre"
        style={{ color: lineColor(record) }}
        title={record.text}
      >
        {record.text}
      </span>
    </div>
  );
}

function LogTail({ process }: { process: ManagedProcessPublicInfo }) {
  const { t } = useI18n();
  if (isManagedProcessActiveState(process.state)) {
    return (
      <div className="flex items-center gap-[8px] px-[12px] pt-[6px]">
        <span
          aria-hidden="true"
          className="process-log-caret h-[13px] w-[7px] rounded-[1px]"
          style={{ background: "var(--fx-text-secondary)" }}
        />
        <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("managedProcessLiveTail", "Following live")}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-[8px] px-[12px] pt-[6px]">
      <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
        {process.exit
          ? t("managedProcessExitedAt", "Process exited · {time}").replace(
              "{time}",
              formatClock(process.exit.finishedAt),
            )
          : t("managedProcessExitedTail", "Process exited")}
      </span>
    </div>
  );
}

export function LogView({
  process,
  records,
  hasMore,
  logRef,
  onLoadMore,
}: {
  process: ManagedProcessPublicInfo;
  records: ManagedProcessLogRecord[];
  hasMore: boolean;
  logRef: RefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      ref={logRef}
      role="log"
      aria-label={t("managedProcessLogs", "Managed process logs")}
      className="flex min-h-0 flex-1 flex-col overflow-auto py-[8px]"
      style={{ background: "var(--fx-surface-inset)" }}
    >
      {records.map((record) => (
        <LogLine key={`${record.runId}:${record.seq}`} record={record} />
      ))}
      {hasMore && (
        <div className="px-[12px] pt-[6px]">
          <Button variant="ghost" onClick={onLoadMore}>
            {t("loadMoreLogs", "Load more logs")}
          </Button>
        </div>
      )}
      <LogTail process={process} />
    </div>
  );
}

export function StdinBar({
  busy,
  onSend,
  onClose,
}: {
  busy: boolean;
  onSend: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text) return;
    void onSend(text).then((sent) => {
      if (sent) setText("");
    });
  };
  return (
    <form
      onSubmit={submit}
      className="flex shrink-0 items-center gap-[8px] py-[8px] pr-[8px] pl-[12px]"
      style={{ borderTop: "1px solid var(--fx-line-subtle)" }}
    >
      <span aria-hidden="true" className="type-mono-body shrink-0" style={{ color: "var(--fx-text-tertiary)" }}>
        ›
      </span>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t("processStdin", "Send line to stdin")}
        aria-label={t("processStdin", "Send line to stdin")}
        className="type-mono-label h-[26px] min-w-0 flex-1 border-0 bg-transparent p-0 outline-none placeholder:text-[var(--fx-text-tertiary)]"
        style={{ color: "var(--fx-text-primary)" }}
      />
      <button
        type="button"
        disabled={busy}
        className={iconButtonClass}
        style={{ color: "var(--fx-text-tertiary)" }}
        aria-label={t("closeStdin", "Close stdin")}
        title={t("closeStdin", "Close stdin")}
        onClick={onClose}
      >
        <XGlyph size={13} />
      </button>
      <button
        type="submit"
        disabled={busy || !text}
        className="process-stdin-send flex size-[26px] shrink-0 items-center justify-center rounded-[var(--radius-chip)] border-0 p-0"
        style={{ color: "var(--fx-text-tertiary)" }}
        aria-label={t("send", "Send")}
        title={t("send", "Send")}
      >
        <ArrowRightGlyph />
      </button>
    </form>
  );
}
