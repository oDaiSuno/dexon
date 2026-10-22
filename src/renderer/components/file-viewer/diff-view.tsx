import { useMemo } from "react";
import { createBoundedTextDiff } from "@/lib/text-diff";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import { collapseDiff, newSideLineNumbers } from "./diff-segments";

export function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const { language, t } = useI18n();
  const result = useMemo(() => createBoundedTextDiff(oldContent, newContent), [oldContent, newContent]);
  if (result.kind === "fallback") {
    return (
      <div
        role="status"
        style={{ padding: 16, color: "var(--fx-text-secondary)", fontSize: "var(--text-label)", lineHeight: 1.6 }}
      >
        {t(
          "diffTooLarge",
          "Diff is too large to render safely. The file changed from {oldLines} to {newLines} lines; showing the current source avoids freezing the app.",
        )
          .replace("{oldLines}", formatNumber(result.oldLines, language))
          .replace("{newLines}", formatNumber(result.newLines, language))}
      </div>
    );
  }
  const diff = result.lines;

  const hasChanges = diff.some((l) => l.type !== "unchanged");
  if (!hasChanges) {
    return (
      <div
        style={{
          padding: "12px 16px",
          fontSize: "var(--text-label)",
          color: "var(--fx-text-tertiary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {t("noChanges", "No changes")}
      </div>
    );
  }

  const segments = collapseDiff(diff);
  const newLineNos = newSideLineNumbers(diff);

  let diffIdx = 0;

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-body)", lineHeight: 1.6 }}>
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              style={{
                padding: "2px 16px",
                color: "var(--fx-text-tertiary)",
                background: "var(--fx-surface-raised)",
                fontSize: "var(--text-meta)",
                borderTop: "1px solid var(--fx-line-default)",
                borderBottom: "1px solid var(--fx-line-default)",
              }}
            >
              {t("unchangedLines", "… {count} unchanged lines …").replace("{count}", formatNumber(seg.count, language))}
            </div>
          );
          diffIdx += seg.count;
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          const idx = diffIdx + li;
          const newLno = newLineNos[idx];
          const bg =
            line.type === "added"
              ? "rgba(0,200,80,0.12)"
              : line.type === "removed"
                ? "rgba(240,60,60,0.14)"
                : "transparent";
          const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const prefixColor =
            line.type === "added"
              ? "var(--fx-status-success)"
              : line.type === "removed"
                ? "var(--fx-status-danger)"
                : "var(--fx-text-tertiary)";

          return (
            <div
              key={li}
              style={{
                display: "flex",
                background: bg,
                borderLeft:
                  line.type === "added"
                    ? "3px solid var(--fx-status-success)"
                    : line.type === "removed"
                      ? "3px solid var(--fx-status-danger)"
                      : "3px solid transparent",
              }}
            >
              <span
                style={{
                  minWidth: 44,
                  padding: "0 8px 0 16px",
                  textAlign: "right",
                  color: "var(--fx-text-tertiary)",
                  userSelect: "none",
                  fontSize: "var(--text-meta)",
                  lineHeight: 1.6,
                  borderRight: "1px solid var(--fx-line-default)",
                  background: "var(--fx-surface-raised)",
                  flexShrink: 0,
                }}
              >
                {line.type === "removed" ? line.lineNo : newLno || ""}
              </span>
              <span
                style={{
                  minWidth: 16,
                  padding: "0 8px",
                  color: prefixColor,
                  userSelect: "none",
                  flexShrink: 0,
                  fontWeight: 600,
                }}
              >
                {prefix}
              </span>
              <span
                style={{
                  flex: 1,
                  padding: "0 8px 0 0",
                  whiteSpace: "pre",
                  color: "var(--fx-text-primary)",
                  overflowX: "auto",
                }}
              >
                {line.text || "\u00a0"}
              </span>
            </div>
          );
        });
        diffIdx += seg.lines.length;
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}
