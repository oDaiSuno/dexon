import { useMemo, useState, Fragment } from "react";
import { createBoundedTextDiff, type DiffLine, type TextDiffResult } from "@/lib/text-diff";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import { CodeLineText } from "./code-line";
import { layoutDiff, ratioSquares, type RatioSquare } from "./diff-segments";
import { useHighlightedLines, type CodeLineTokens } from "./highlighted-lines";
import type { DiffSummary } from "./use-text-file";

const NO_FOLDS: ReadonlySet<number> = new Set();
const SIGN: Record<DiffLine["type"], string> = { added: "+", removed: "\u2212", unchanged: "" };

const RATIO_COLOR: Record<RatioSquare, string> = {
  added: "var(--fx-status-success)",
  removed: "var(--fx-status-danger)",
  track: "var(--fx-surface-track)",
};

function DiffRow({ line, tokens }: { line: DiffLine; tokens: CodeLineTokens | undefined }) {
  return (
    <div className={`file-diff-row is-${line.type}`}>
      <span className="file-diff-no" aria-hidden="true">
        {line.type === "added" ? "" : line.oldLineNo}
      </span>
      <span className="file-diff-no" aria-hidden="true">
        {line.type === "removed" ? "" : line.newLineNo}
      </span>
      <span className="file-diff-sign" aria-hidden="true">
        {SIGN[line.type]}
      </span>
      <span className="file-diff-code">
        <CodeLineText tokens={tokens} />
      </span>
    </div>
  );
}

function FoldIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

export function DiffView({
  oldContent,
  newContent,
  language,
  wrapLines,
  summary = null,
}: {
  oldContent: string;
  newContent: string;
  language: string;
  wrapLines: boolean;
  summary?: DiffSummary | null;
}) {
  const { language: locale, t } = useI18n();
  const result = useMemo(() => createBoundedTextDiff(oldContent, newContent), [oldContent, newContent]);
  const [expansion, setExpansion] = useState<{ result: TextDiffResult; folds: ReadonlySet<number> } | null>(null);
  const expandedFolds = expansion?.result === result ? expansion.folds : NO_FOLDS;
  const diff = result.kind === "lines" ? result.lines : null;
  const oldTokens = useHighlightedLines(oldContent, language, diff !== null);
  const newTokens = useHighlightedLines(newContent, language, diff !== null);
  const layout = useMemo(() => (diff ? layoutDiff(diff, expandedFolds) : null), [diff, expandedFolds]);

  const toggleFold = (start: number) => {
    const folds = new Set(expandedFolds);
    if (folds.has(start)) folds.delete(start);
    else folds.add(start);
    setExpansion({ result, folds });
  };

  if (result.kind === "fallback") {
    return (
      <div role="status" className="file-diff-note type-body-relaxed">
        {t(
          "diffTooLarge",
          "Diff is too large to render safely. The file changed from {oldLines} to {newLines} lines; showing the current source avoids freezing the app.",
        )
          .replace("{oldLines}", formatNumber(result.oldLines, locale))
          .replace("{newLines}", formatNumber(result.newLines, locale))}
      </div>
    );
  }

  if (!layout?.hasChanges) {
    return <div className="file-diff-note type-mono-code">{t("noChanges", "No changes")}</div>;
  }

  const tokensOf = (line: DiffLine) =>
    line.type === "removed" ? oldTokens[line.oldLineNo - 1] : newTokens[line.newLineNo - 1];

  return (
    <div className={`file-diff prismjs type-mono-code${wrapLines ? " is-wrapped" : ""}`}>
      {summary && (
        <div className="file-diff-summary">
          <span className="type-mono-label text-[var(--fx-text-primary)]">
            {`+${formatNumber(summary.added, locale)}  \u2212${formatNumber(summary.removed, locale)}`}
          </span>
          <span className="file-diff-ratio" aria-hidden="true">
            {ratioSquares(summary.added, summary.removed).map((square, index) => (
              <span key={index} style={{ background: RATIO_COLOR[square] }} />
            ))}
          </span>
          <span className="flex-1" />
          <span className="type-meta-default text-[var(--fx-text-tertiary)]">
            {t("diffComparedWithHead", "Compared with HEAD")}
          </span>
        </div>
      )}
      <div className="file-diff-hunks">
        {layout.blocks.map((block) =>
          block.kind === "fold" ? (
            <button
              key={`fold-${block.start}`}
              type="button"
              className="file-diff-fold type-meta-default"
              aria-expanded={block.expanded}
              title={
                block.expanded
                  ? t("collapseUnchangedLines", "Hide unchanged lines")
                  : t("expandUnchangedLines", "Show unchanged lines")
              }
              onClick={() => toggleFold(block.start)}
            >
              <FoldIcon />
              {t("unchangedLines", "… {count} unchanged lines …").replace("{count}", formatNumber(block.count, locale))}
            </button>
          ) : (
            <Fragment key={`lines-${block.start}`}>
              {block.header && (
                <div className="file-diff-hunk type-mono-meta">
                  <span>{block.header}</span>
                </div>
              )}
              {block.lines.map((line, offset) => (
                <DiffRow key={block.start + offset} line={line} tokens={tokensOf(line)} />
              ))}
            </Fragment>
          ),
        )}
      </div>
    </div>
  );
}
