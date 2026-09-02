import { useEffect, useRef, useState } from "react";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useI18n } from "@/i18n";
import { DeferredContentActions, useDelayedUnmount } from "./shared";
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
  const diffCounts = resultDiff ? countDiffLines(resultDiff.text) : null;
  const label = toolVerbLabel(block.toolName, t);

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
            {!isRunning && !diffCounts && !isError && duration !== undefined && (
              <span>{formatToolDuration(duration)}</span>
            )}
            {isError && <span style={{ color: "var(--bui-red)" }}>{t("toolFailed", "failed")}</span>}
          </span>
        </button>
      </div>
      {/* Panel must stay a DIRECT child of .chat-acc: the accordion opens via
          `.chat-acc[data-open="true"] > .chat-acc-panel`, and the wrap is not
          the accordion root (this nesting is what broke expansion once). */}
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
                    window.dispatchEvent(new CustomEvent("dexon:open-browser-tab", { detail: { tabId: browserTabId } }))
                  }
                >
                  {t("openInBrowser", "Open in Browser")} →
                </button>
              )}
            </div>
          )}
        </div>
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

/* Sub-second tools still earn a mark: anything under half a second shows
   "<1s" instead of silently disappearing from the row. */
function formatToolDuration(elapsedMs: number): string {
  return elapsedMs >= 500 ? `${Math.round(elapsedMs / 1000)}s` : "<1s";
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
