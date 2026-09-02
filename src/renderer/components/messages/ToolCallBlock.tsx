import { useState } from "react";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useI18n } from "@/i18n";
import { DeferredContentActions, isRecord } from "./shared";
import { getResultDiff, PairedDiffResult } from "./DiffViews";
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
  const inputStr = JSON.stringify(block.input, null, 2);
  const isEditTool = isEditToolName(block.toolName);
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;

  // Result display
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

  return (
    <div
      style={{
        borderRadius: 9,
        overflow: "hidden",
        fontSize: scaledChatFont(12),
        fontFamily: "var(--font-mono)",
        background: "var(--tool-bg)",
        border: isError
          ? "1px solid color-mix(in srgb, var(--danger) 55%, transparent)"
          : "1px solid var(--tool-border)",
      }}
    >
      {/* ── Tool call header ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "7px 12px",
          background: "none",
          border: "none",
          borderBottom: expanded || result ? "1px solid var(--tool-border)" : "none",
          color: isError ? "var(--danger)" : "var(--accent)",
          cursor: "pointer",
          fontSize: scaledChatFont(12),
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ flexShrink: 0, opacity: 0.85 }}>{expanded ? "▾" : "▸"}</span>
        <span style={{ fontWeight: 600, flexShrink: 0 }}>{block.toolName}</span>
        <span
          style={{
            color: "var(--tool-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
            opacity: 0.85,
          }}
        >
          {preview}
        </span>
        {duration !== undefined && (
          <span
            style={{
              fontSize: scaledChatFont(11),
              color: "var(--text-dim)",
              flexShrink: 0,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {duration}s
          </span>
        )}
      </button>

      {/* ── Expanded: input args ── */}
      {expanded && !isEditTool && (
        <pre
          style={{
            margin: 0,
            padding: "8px 12px",
            color: "var(--tool-fg)",
            fontSize: scaledChatFont(12),
            lineHeight: 1.5,
            overflow: "auto",
            background: "transparent",
            borderTop: "none",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {inputStr}
        </pre>
      )}

      {/* ── Running indicator (design.html terminal style) ── */}
      {isRunning && !expanded && (
        <div style={{ padding: "8px 12px", color: "var(--text-dim)" }}>
          running
          <span className="stream-caret" aria-hidden="true" />
        </div>
      )}

      {/* ── Paired result — always show summary; expand for full detail ── */}
      {result &&
        (resultDiff ? (
          expanded ? (
            <PairedDiffResult diff={resultDiff} />
          ) : (
            <div
              style={{
                padding: "8px 12px",
                color: "var(--tool-fg)",
                whiteSpace: "pre-wrap",
                maxHeight: 80,
                overflow: "hidden",
                opacity: 0.9,
              }}
            >
              {resultDiff.text.split("\n").slice(0, 4).join("\n")}
              {resultDiff.text.split("\n").length > 4 ? "\n…" : ""}
            </div>
          )
        ) : (
          <PairedResult
            text={!expanded && browserSummary ? browserSummary : (resultText ?? "")}
            isEmpty={resultIsEmpty}
            isError={isError}
            collapsed={!expanded}
          />
        ))}
      {result && <DeferredContentActions content={result.content} onLoad={onLoadDeferredContent} />}
      {browserTabId && (
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("dexon:open-browser-tab", { detail: { tabId: browserTabId } }))
          }
          style={{
            width: "100%",
            minHeight: 30,
            border: "none",
            borderTop: "1px solid var(--tool-border)",
            background: "transparent",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: scaledChatFont(11),
            textAlign: "left",
            padding: "0 12px",
          }}
        >
          Open in Browser →
        </button>
      )}
    </div>
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

function PairedResult({
  text,
  isEmpty,
  isError,
  collapsed,
}: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
  collapsed?: boolean;
}) {
  return (
    <div
      style={{
        borderTop: isError
          ? "1px solid color-mix(in srgb, var(--danger) 40%, transparent)"
          : "1px solid var(--tool-border)",
        background: isError ? "color-mix(in srgb, var(--danger) 8%, transparent)" : "transparent",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 12px",
          color: isError ? "var(--danger)" : isEmpty ? "var(--text-dim)" : "var(--tool-fg)",
          fontSize: scaledChatFont(12),
          lineHeight: 1.5,
          maxHeight: collapsed ? 180 : 400,
          overflow: "auto",
          background: "transparent",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontStyle: isEmpty ? "italic" : "normal",
          opacity: isEmpty ? 0.6 : 1,
        }}
      >
        {isEmpty ? "(no output)" : text}
      </pre>
    </div>
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
