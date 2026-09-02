import { useMemo } from "react";
import { parseUnifiedPatch, type SplitDiffCell } from "@/lib/patch";
import { scaledChatFont } from "@/lib/chat-appearance";
import { isRecord } from "./shared";
import type { ToolResultMessage } from "@/lib/types";

export interface ResultDiff {
  text: string;
}

export function PairedDiffResult({ diff }: { diff: ResultDiff }) {
  return (
    <div className="chat-diff-card">
      <SplitPatchView text={diff.text} />
    </div>
  );
}

function SplitPatchView({ text }: { text: string }) {
  const files = useMemo(() => parseUnifiedPatch(text), [text]);
  if (!files) return <PatchTextView text={text} />;
  const showFileHeaders = files.length > 1;

  return (
    <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "hidden", background: "var(--bui-inset)" }}>
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          style={{
            minWidth: 0,
            borderTop: fileIndex === 0 ? "none" : "1px solid var(--bui-line)",
            fontFamily: "var(--font-mono)",
            fontSize: scaledChatFont(11.5),
            lineHeight: 1.65,
          }}
        >
          {showFileHeaders && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: "var(--bui-surface)",
                borderBottom: "1px solid var(--bui-line)",
              }}
            >
              <SplitDiffHeader title={file.oldPath || "Before"} side="left" />
              <SplitDiffHeader title={file.newPath || "After"} side="right" />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            {file.rows.map((row, rowIndex) => {
              if (row.type === "hunk") {
                return null;
              }

              return (
                <div key={rowIndex} style={{ display: "contents" }}>
                  <SplitDiffCellView cell={row.left} side="left" />
                  <SplitDiffCellView cell={row.right} side="right" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div
      title={title}
      style={{
        padding: "5px 10px",
        color: "var(--bui-ink-3)",
        borderRight: side === "left" ? "1px solid var(--bui-line)" : "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </div>
  );
}

function SplitDiffCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const bg =
    cell.type === "added"
      ? "var(--bui-green-tint)"
      : cell.type === "removed"
        ? "var(--bui-red-tint)"
        : cell.type === "empty"
          ? "var(--bui-hover)"
          : "transparent";
  const marker = cell.type === "added" ? "+" : cell.type === "removed" ? "−" : " ";
  const markerColor =
    cell.type === "added" ? "var(--bui-green)" : cell.type === "removed" ? "var(--bui-red)" : "var(--bui-ink-3)";

  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        background: bg,
        borderRight: side === "left" ? "1px solid var(--bui-line)" : "none",
      }}
    >
      <span
        style={{
          width: 42,
          padding: "0 6px",
          textAlign: "right",
          color: "var(--bui-ink-3)",
          opacity: 0.65,
          userSelect: "none",
          background: "var(--bui-surface)",
          borderRight: "1px solid var(--bui-line)",
          flexShrink: 0,
        }}
      >
        {cell.lineNo ?? ""}
      </span>
      <span
        style={{
          width: 18,
          padding: "0 5px",
          color: markerColor,
          userSelect: "none",
          fontWeight: cell.type === "context" || cell.type === "empty" ? 400 : 700,
          flexShrink: 0,
        }}
      >
        {marker}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0 10px 0 0",
          color:
            cell.type === "empty" ? "var(--bui-ink-3)" : cell.type === "context" ? "var(--bui-ink-2)" : markerColor,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}

function PatchTextView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div
      style={{
        maxHeight: 520,
        overflowY: "auto",
        overflowX: "hidden",
        fontFamily: "var(--font-mono)",
        fontSize: scaledChatFont(11.5),
        lineHeight: 1.65,
        minWidth: 0,
      }}
    >
      {lines.map((line, i) => {
        const kind = line.startsWith("@@")
          ? "hunk"
          : line.startsWith("+") && !line.startsWith("+++")
            ? "added"
            : line.startsWith("-") && !line.startsWith("---")
              ? "removed"
              : "context";
        const bg =
          kind === "added"
            ? "var(--bui-green-tint)"
            : kind === "removed"
              ? "var(--bui-red-tint)"
              : kind === "hunk"
                ? "var(--bui-hover)"
                : "transparent";
        const color =
          kind === "added"
            ? "var(--bui-green)"
            : kind === "removed"
              ? "var(--bui-red)"
              : kind === "hunk"
                ? "var(--bui-ink-3)"
                : "var(--bui-ink-2)";

        return (
          <div
            key={i}
            style={{
              display: "flex",
              background: bg,
              borderLeft:
                kind === "added"
                  ? "3px solid var(--bui-green)"
                  : kind === "removed"
                    ? "3px solid var(--bui-red)"
                    : kind === "hunk"
                      ? "3px solid var(--bui-line-strong)"
                      : "3px solid transparent",
            }}
          >
            <span
              style={{
                width: 48,
                padding: "0 8px",
                color: "var(--bui-ink-3)",
                opacity: 0.65,
                background: "var(--bui-surface)",
                borderRight: "1px solid var(--bui-line)",
                textAlign: "right",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span style={{ padding: "0 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color }}>
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function getResultDiff(result: ToolResultMessage): ResultDiff | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;

  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return { text: patch };

  const diff = typeof details.diff === "string" ? details.diff : null;
  if (diff) return { text: diff };

  return null;
}
