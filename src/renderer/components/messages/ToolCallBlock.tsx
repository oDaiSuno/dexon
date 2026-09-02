import { useEffect, useRef, useState } from "react";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useI18n } from "@/i18n";
import { DeferredContentActions, isRecord, useDelayedUnmount } from "./shared";
import { getResultDiff, PairedDiffResult } from "./DiffViews";
import { countDiffLines, toolVerbLabel, ToolGlyph } from "./tool-labels";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";

export function ToolCallBlock({
  block,
  result,
  duration,
  onLoadDeferredContent,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();
  const detailMounted = useDelayedUnmount(expanded);
  const inputStr = JSON.stringify(block.input, null, 2);
  const isEditTool = isEditToolName(block.toolName);
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;

  const resultText = result
    ? result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : resultText.trim() === "(no output)" || resultText.trim() === "";
  const isError = result?.isError ?? false;
  const isRunning = !result;
  const preview = getToolPreview(block);
  const browserTabId = isBrowserToolName(block.toolName) ? browserTabIdFromResult(resultText) : null;
  const browserSummary =
    isBrowserToolName(block.toolName) && resultText && !isError ? browserResultSummary(resultText, t) : null;
  const diffCounts = resultDiff ? countDiffLines(resultDiff.text) : null;
  const label = toolVerbLabel(block.toolName, t);

  // Collapsed second line: only for things that matter without expanding —
  // errors and the browser inspection summaries.
  const collapsedNote = !expanded && isError ? (resultText ?? "") : !expanded && browserSummary ? browserSummary : null;

  return (
    <div className="chat-acc" data-open={expanded ? "true" : "false"}>
      <div className="chat-tool-row-wrap">
        <button
          type="button"
          className="chat-tool-row chat-quiet-head"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="chat-tool-icon">
            <ToolStatusIcon done={!isRunning} error={isError} toolName={block.toolName} />
            <span className="chat-tool-chev" aria-hidden="true">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </span>
          <span className="chat-tool-name" style={isError ? { color: "var(--bui-red)" } : undefined}>
            {label}
          </span>
          <span className="chat-tool-chip" style={isError ? { color: "var(--bui-red)" } : undefined}>
            {preview}
          </span>
          <span className="chat-tool-meta">
            {isRunning && <span className="chat-shimmer-text">{t("toolRunning", "running")}</span>}
            {diffCounts && !isRunning && (
              <>
                <span style={{ color: "var(--bui-green)" }}>+{diffCounts.added}</span>
                {diffCounts.removed > 0 && <span style={{ color: "var(--bui-red)" }}>−{diffCounts.removed}</span>}
              </>
            )}
            {!isRunning && !diffCounts && !isError && duration !== undefined && <span>{duration}s</span>}
            {isError && <span>{t("toolFailed", "failed")}</span>}
          </span>
        </button>
        <div className="chat-acc-panel">
          <div className="chat-acc-panel-clip">
            {detailMounted && (
              <div className="chat-tool-detail" style={{ fontSize: scaledChatFont(11.5) }}>
                {!isEditTool && (
                  <pre className="chat-tool-input" style={{ fontSize: scaledChatFont(11) }}>
                    {inputStr}
                  </pre>
                )}
                {resultDiff && <PairedDiffResult diff={resultDiff} />}
                {!resultDiff && result && (
                  <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
                )}
                {browserTabId && (
                  <button
                    type="button"
                    className="chat-tool-open-browser"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("dexon:open-browser-tab", { detail: { tabId: browserTabId } }),
                      )
                    }
                  >
                    {t("openInBrowser", "Open in Browser")} →
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        {collapsedNote && !resultDiff && (
          <div className="chat-tool-collapsed-note" style={{ color: isError ? "var(--bui-red)" : "var(--bui-ink-2)" }}>
            {collapsedNote}
          </div>
        )}
      </div>
      {result && <DeferredContentActions content={result.content} onLoad={onLoadDeferredContent} />}
    </div>
  );
}

/* transitions.dev 41-spinner-check-morph (adapted): running spinner blurs
   into a drawn check on completion, then settles into the resting tool
   glyph. Errors morph into a red ×. No auto-revert. Remounts after
   completion never replay the morph (phase initialises at rest). */
function ToolStatusIcon({ done, error, toolName }: { done: boolean; error: boolean; toolName: string }) {
  const [phase, setPhase] = useState<"spin" | "check" | "rest">(!done ? "spin" : "rest");
  const prevDoneRef = useRef(done);
  const checkRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    if (!prevDoneRef.current && done) {
      prevDoneRef.current = true;
      setPhase("check");
      const timer = setTimeout(() => setPhase("rest"), 1100);
      return () => clearTimeout(timer);
    }
    prevDoneRef.current = done;
    return undefined;
  }, [done]);

  // Keep the stroke-draw exact for whichever path is mounted.
  useEffect(() => {
    const path = checkRef.current;
    if (path) {
      const len = Math.ceil(path.getTotalLength()) + 1;
      path.style.setProperty("--chat-scmorph-check-len", String(len));
    }
  }, [phase, error]);

  return (
    <span
      className={`chat-status-icon${error ? " is-error" : ""}${phase === "check" ? " is-crossing is-done" : ""}${
        phase === "rest" ? " is-rest" : ""
      }`}
      aria-hidden="true"
    >
      {phase !== "rest" && <span className="chat-scmorph-spinring" />}
      <span className="chat-scmorph-badge">
        <span className="chat-scmorph-fill" />
        {error ? (
          <svg className="chat-scmorph-check" viewBox="0 0 24 24">
            <path ref={checkRef} d="M7.5 7.5l9 9M16.5 7.5l-9 9" />
          </svg>
        ) : (
          <svg className="chat-scmorph-check" viewBox="0 0 24 24">
            <path ref={checkRef} d="M7 12.5l3 3 7-7" />
          </svg>
        )}
      </span>
      <span className="chat-scmorph-rest">
        <ToolGlyph toolName={toolName} />
      </span>
    </span>
  );
}

function isBrowserToolName(value: string): boolean {
  return value.startsWith("browser_");
}

function browserTabIdFromResult(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { tabId?: unknown; id?: unknown };
    const tabId = typeof parsed.tabId === "string" ? parsed.tabId : typeof parsed.id === "string" ? parsed.id : null;
    return tabId && tabId.length <= 128 ? tabId : null;
  } catch {
    return null;
  }
}

function browserResultSummary(value: string, t: (key: string, fallback: string) => string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.inspectionId === "string" && typeof parsed.changed === "boolean") {
      const truncated = isRecord(parsed.truncated)
        ? Object.entries(parsed.truncated)
            .filter(([, entry]) => entry === true)
            .map(([key]) => key)
            .join(", ")
        : "";
      return parsed.changed
        ? formatBrowserSummary(t("browserToolInspectChanged", "Page changed · generation {generation}{truncated}"), {
            generation: Number(parsed.generation ?? 0),
            truncated: truncated ? ` · truncated: ${truncated}` : "",
          })
        : formatBrowserSummary(t("browserToolInspectUnchanged", "Page unchanged · generation {generation}"), {
            generation: Number(parsed.generation ?? 0),
          });
    }
    if (typeof parsed.differenceRatio === "number") {
      return formatBrowserSummary(t("browserToolVisualDifference", "Visual difference: {percent}% · {pixels} pixels"), {
        percent: (parsed.differenceRatio * 100).toFixed(3),
        pixels: Number(parsed.differentPixels ?? 0).toLocaleString(),
      });
    }
    if (typeof parsed.total === "number" && typeof parsed.failed === "number" && isRecord(parsed.byResourceType)) {
      return formatBrowserSummary(
        t("browserToolNetworkSummary", "Network: {total} requests · {failed} failed · {pending} pending"),
        {
          total: parsed.total,
          failed: parsed.failed,
          pending: Number(parsed.pending ?? 0),
        },
      );
    }
    if (Array.isArray(parsed.entries)) {
      return formatBrowserSummary(t("browserToolConsoleSummary", "Console: {count} entries{truncated}"), {
        count: parsed.entries.length,
        truncated: parsed.truncated === true ? " · more available" : "",
      });
    }
  } catch {
    return null;
  }
  return null;
}

function formatBrowserSummary(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) =>
    values[key] === undefined ? match : String(values[key]),
  );
}

function PairedResult({ text, isEmpty, isError }: { text: string; isEmpty: boolean; isError: boolean }) {
  return (
    <pre
      className="chat-tool-result"
      style={{
        color: isError ? "var(--bui-red)" : isEmpty ? "var(--bui-ink-3)" : "var(--bui-ink-2)",
        fontStyle: isEmpty ? "italic" : "normal",
      }}
    >
      {isEmpty ? "(no output)" : text}
    </pre>
  );
}

function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return (
    name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor")
  );
}

function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}
