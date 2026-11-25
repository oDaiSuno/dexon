import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Ban, ChevronRight, CodeXml, LoaderCircle, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n";
import { useExpansion } from "@/lib/thinking-expansion-store";
import type { ToolCallBlockProps } from "./ToolCallBlock";
import { codemodeToolDetail } from "./codemode-tool-detail";
import { CodemodeWorkbench } from "./codemode-workbench";
import { DeferredContentActions, useDelayedUnmount } from "./shared";
import { formatToolDuration, useElapsedSince } from "./tool-elapsed";

export function CodemodeToolRow({
  block,
  result,
  liveUpdate,
  duration,
  startedAt,
  stateKey,
  expansionStore,
  cwd,
  environmentId,
  onOpenFile,
  onLoadDeferredContent,
}: ToolCallBlockProps) {
  const { t } = useI18n();
  const [remembered, toggle] = useExpansion(expansionStore, stateKey);
  const expanded = remembered ?? false;
  const mounted = useDelayedUnmount(expanded);
  const panelId = useId();
  const detail = useMemo(
    () => codemodeToolDetail({ block, result, liveUpdate, cwd, t }),
    [block, result, liveUpdate, cwd, t],
  );
  const running =
    !result && liveUpdate?.endedAt === undefined && (detail.lifecycle === "starting" || detail.lifecycle === "running");
  const cancelled = detail.lifecycle === "cancelled";
  const failed = detail.lifecycle === "error";
  const start = liveUpdate?.startedAt ?? startedAt;
  const end = liveUpdate?.endedAt ?? result?.timestamp;
  const endedDuration =
    start !== undefined && liveUpdate?.endedAt !== undefined ? Math.max(0, liveUpdate.endedAt - start) : undefined;
  const observedEnd = useRef<{ id: string; duration: number } | null>(null);
  const elapsed = useElapsedSince(running ? start : undefined);
  const [frozen, setFrozen] = useState<{ id: string; duration: number } | null>(null);

  useEffect(() => {
    if (endedDuration !== undefined) observedEnd.current = { id: block.toolCallId, duration: endedDuration };
  }, [endedDuration, block.toolCallId]);

  useEffect(() => {
    if (running || start === undefined || duration !== undefined || end !== undefined) return;
    setFrozen({ id: block.toolCallId, duration: Math.max(0, Date.now() - start) });
  }, [running, start, duration, end, block.toolCallId]);

  const settledDuration =
    endedDuration ??
    (observedEnd.current?.id === block.toolCallId ? observedEnd.current.duration : undefined) ??
    duration ??
    (start !== undefined && end !== undefined
      ? Math.max(0, end - start)
      : frozen?.id === block.toolCallId
        ? frozen.duration
        : undefined);
  const metaDuration = running ? elapsed : settledDuration;
  const label = cancelled ? t("codemodeStopped", "Stopped script") : t("codemodeRun", "Run script");

  return (
    <div className="chat-acc chat-codemode" data-open={expanded ? "true" : "false"} data-lifecycle={detail.lifecycle}>
      <div className="chat-tool-row-wrap">
        <button
          type="button"
          className={`chat-tool-row chat-quiet-head chat-codemode-row${running ? " is-running" : ""}${failed ? " is-error" : ""}${cancelled ? " is-cancelled" : ""}`}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => toggle(expanded)}
        >
          <span className={`chat-tool-icon${failed ? " is-error" : ""}`} aria-hidden="true">
            {running ? (
              <LoaderCircle size={15} strokeWidth={1.8} className="chat-codemode-spinner" />
            ) : cancelled ? (
              <Ban size={15} strokeWidth={1.8} />
            ) : failed ? (
              <TriangleAlert size={15} strokeWidth={1.8} />
            ) : (
              <CodeXml size={15} strokeWidth={1.8} />
            )}
          </span>
          <span className="chat-tool-name type-body-medium">{label}</span>
          <span className="chat-codemode-summary type-mono-label" title={detail.summary}>
            {detail.summary}
          </span>
          <span className="chat-tool-meta type-mono-label">
            {running && <span className="chat-codemode-running-dot" aria-hidden="true" />}
            {metaDuration !== undefined && <span>{formatToolDuration(metaDuration)}</span>}
            <ChevronRight
              size={14}
              strokeWidth={2}
              className="chat-codemode-chevron"
              style={{ transform: expanded ? "rotate(90deg)" : undefined }}
              aria-hidden="true"
            />
          </span>
        </button>
      </div>
      <div id={panelId} className="chat-acc-panel" aria-hidden={!expanded} inert={!expanded}>
        <div className="chat-acc-panel-clip">
          {mounted && (
            <CodemodeWorkbench
              detail={detail}
              stateKey={stateKey}
              expansionStore={expansionStore}
              environmentId={environmentId}
              onOpenFile={onOpenFile}
            />
          )}
        </div>
      </div>
      {result && <DeferredContentActions content={result.content} onLoad={onLoadDeferredContent} />}
    </div>
  );
}
