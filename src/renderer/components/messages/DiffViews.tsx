import { useMemo } from "react";
import { parseUnifiedPatch, type SplitDiffCell } from "@/lib/patch";
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
    <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "hidden", background: "var(--fx-surface-inset)" }}>
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          style={{
            minWidth: 0,
            borderTop: fileIndex === 0 ? "none" : "1px solid var(--fx-line-default)",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
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
                background: "var(--fx-surface-raised)",
                borderBottom: "1px solid var(--fx-line-default)",
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
        color: "var(--fx-text-tertiary)",
        borderRight: side === "left" ? "1px solid var(--fx-line-default)" : "none",
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
      ? "var(--fx-status-success-soft)"
      : cell.type === "removed"
        ? "var(--fx-status-danger-soft)"
        : cell.type === "empty"
          ? "var(--fx-surface-hover-overlay)"
          : "transparent";
  const marker = cell.type === "added" ? "+" : cell.type === "removed" ? "−" : " ";
  const markerColor =
    cell.type === "added"
      ? "var(--fx-status-success-text)"
      : cell.type === "removed"
        ? "var(--fx-status-danger-text)"
        : "var(--fx-text-tertiary)";

  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        background: bg,
        borderRight: side === "left" ? "1px solid var(--fx-line-default)" : "none",
      }}
    >
      <span
        style={{
          width: 42,
          padding: "0 6px",
          textAlign: "right",
          color: "var(--fx-text-tertiary)",
          opacity: 0.65,
          userSelect: "none",
          background: "var(--fx-surface-raised)",
          borderRight: "1px solid var(--fx-line-default)",
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
            cell.type === "empty"
              ? "var(--fx-text-tertiary)"
              : cell.type === "context"
                ? "var(--fx-text-secondary)"
                : markerColor,
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
        fontSize: 11.5,
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
            ? "var(--fx-status-success-soft)"
            : kind === "removed"
              ? "var(--fx-status-danger-soft)"
              : kind === "hunk"
                ? "var(--fx-surface-hover-overlay)"
                : "transparent";
        const color =
          kind === "added"
            ? "var(--fx-status-success-text)"
            : kind === "removed"
              ? "var(--fx-status-danger-text)"
              : kind === "hunk"
                ? "var(--fx-text-tertiary)"
                : "var(--fx-text-secondary)";

        return (
          <div
            key={i}
            style={{
              display: "flex",
              background: bg,
              borderLeft:
                kind === "added"
                  ? "3px solid var(--fx-status-success-text)"
                  : kind === "removed"
                    ? "3px solid var(--fx-status-danger-text)"
                    : kind === "hunk"
                      ? "3px solid var(--fx-line-strong)"
                      : "3px solid transparent",
            }}
          >
            <span
              style={{
                width: 48,
                padding: "0 8px",
                color: "var(--fx-text-tertiary)",
                opacity: 0.65,
                background: "var(--fx-surface-raised)",
                borderRight: "1px solid var(--fx-line-default)",
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
