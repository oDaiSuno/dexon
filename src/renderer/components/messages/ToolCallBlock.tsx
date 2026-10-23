import { useState } from "react";
import { useI18n } from "@/i18n";
import { readSessionToolTarget, isSessionToolName, type SessionToolTargetDetails } from "@shared/session-orchestration";
import { SessionTargetLink } from "./session-links";
import { DeferredContentActions, useDelayedUnmount } from "./shared";
import { getResultDiff, PairedDiffResult } from "./DiffViews";
import { countDiffLines, toolVerbLabel, ToolGlyph } from "./tool-labels";
import { formatToolDuration, useElapsedSince } from "./tool-elapsed";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";

export function ToolCallBlock({
  block,
  result,
  duration,
  startedAt,
  onLoadDeferredContent,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  startedAt?: number;
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
  const sessionTarget = sessionToolTarget(block, result);
  const diffCounts = resultDiff ? countDiffLines(resultDiff.text) : null;
  const label = toolVerbLabel(block.toolName, t);
  const elapsed = useElapsedSince(isRunning ? startedAt : undefined);
  const metaDuration = isRunning ? elapsed : diffCounts ? undefined : duration;

  return (
    <div className="chat-acc" data-open={expanded ? "true" : "false"}>
      <div className="chat-tool-row-wrap">
        <button
          type="button"
          className={`chat-tool-row chat-quiet-head${isRunning ? " is-running" : ""}${isError ? " is-error" : ""}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className={`chat-tool-icon${isError ? " is-error" : ""}`} aria-hidden="true">
            {isRunning ? <span className="chat-tool-spinner" /> : <ToolGlyph toolName={block.toolName} />}
          </span>
          <span className="chat-tool-name type-body-medium">{label}</span>
          <span className="chat-tool-chip type-mono-label">
            <span className="chat-tool-chip-text">{preview}</span>
          </span>
          <span className="chat-tool-meta type-mono-label">
            {isRunning && (
              <span className={elapsed === undefined ? "chat-tool-meta-running" : "sr-only"}>
                {t("toolRunning", "running")}
              </span>
            )}
            {isError && (
              <span className={metaDuration === undefined ? "chat-tool-meta-failed" : "sr-only"}>
                {t("toolFailed", "failed")}
              </span>
            )}
            {diffCounts && !isRunning && (
              <>
                <span className="chat-tool-meta-added">+{diffCounts.added}</span>
                {diffCounts.removed > 0 && <span className="chat-tool-meta-removed">−{diffCounts.removed}</span>}
              </>
            )}
            {metaDuration !== undefined && (
              <span className={isRunning ? "chat-tool-meta-running" : isError ? "chat-tool-meta-failed" : undefined}>
                {formatToolDuration(metaDuration)}
              </span>
            )}
          </span>
        </button>
      </div>
      {sessionTarget && (
        <div style={{ display: "flex", paddingLeft: 22 }}>
          <SessionTargetLink target={sessionTarget} />
        </div>
      )}
      {/* Panel must stay a DIRECT child of .chat-acc: the accordion opens via
          `.chat-acc[data-open="true"] > .chat-acc-panel`, and the wrap is not
          the accordion root (this nesting is what broke expansion once). */}
      <div className="chat-acc-panel">
        <div className="chat-acc-panel-clip">
          {detailMounted && (
            <div className="chat-tool-detail type-mono-code">
              {!isEditTool && <pre className="chat-tool-input">{inputStr}</pre>}
              {resultDiff && <PairedDiffResult diff={resultDiff} />}
              {!resultDiff && result && (
                <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
              )}
              {browserTabId && (
                <button
                  type="button"
                  className="chat-tool-open-browser type-label-default"
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

function isBrowserToolName(value: string): boolean {
  return value.startsWith("browser_");
}

function sessionToolTarget(
  block: ToolCallContent,
  result: ToolResultMessage | undefined,
): SessionToolTargetDetails | null {
  if (!isSessionToolName(block.toolName)) return null;
  const reported = readSessionToolTarget(result?.details);
  if (reported) return reported;
  const named = block.input.sessionId;
  return typeof named === "string" && named.length > 0 ? { targetSessionId: named } : null;
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
    <pre className={`chat-tool-result${isError ? " is-error" : isEmpty ? " is-empty" : ""}`}>
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
