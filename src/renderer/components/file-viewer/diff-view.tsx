import { useMemo, useState } from "react";
import { createBoundedTextDiff, type DiffLine, type TextDiffResult } from "@/lib/text-diff";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import { CodeLineText } from "./code-line";
import { layoutDiff } from "./diff-segments";
import { useHighlightedLines, type CodeLineTokens } from "./highlighted-lines";

const NO_FOLDS: ReadonlySet<number> = new Set();
const SIGN: Record<DiffLine["type"], string> = { added: "+", removed: "\u2212", unchanged: "" };

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
}: {
  oldContent: string;
  newContent: string;
  language: string;
  wrapLines: boolean;
}) {
  const { language: locale, t } = useI18n();
  const result = useMemo(() => createBoundedTextDiff(oldContent, newContent), [oldContent, newContent]);
  const [expansion, setExpansion] = useState<{ result: TextDiffResult; folds: ReadonlySet<number> } | null>(null);
  const expandedFolds = expansion?.result === result ? expansion.folds : NO_FOLDS;
  const diff = result.kind === "lines" ? result.lines : null;
  const oldTokens = useHighlightedLines(oldContent, language, diff !== null);
  const newTokens = useHighlightedLines(newContent, language, diff !== null);
  const layout = useMemo(() => (diff ? layoutDiff(diff, expandedFolds) : null), [diff, expandedFolds]);
  const expandFold = (start: number) => setExpansion({ result, folds: new Set(expandedFolds).add(start) });

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

  if (!layout?.header) {
    return <div className="file-diff-note type-mono-code">{t("noChanges", "No changes")}</div>;
  }

  const tokensOf = (line: DiffLine) =>
    line.type === "removed" ? oldTokens[line.oldLineNo - 1] : newTokens[line.newLineNo - 1];

  return (
    <div className={`file-diff prismjs type-mono-code${wrapLines ? " is-wrapped" : ""}`}>
      <div className="file-diff-hunk type-mono-meta">
        <span>{layout.header}</span>
      </div>
      {layout.blocks.map((block) =>
        block.kind === "fold" ? (
          <button
            key={`fold-${block.start}`}
            type="button"
            className="file-diff-fold type-meta-default"
            title={t("expandUnchangedLines", "Show unchanged lines")}
            onClick={() => expandFold(block.start)}
          >
            <FoldIcon />
            {t("unchangedLines", "… {count} unchanged lines …").replace("{count}", formatNumber(block.count, locale))}
          </button>
        ) : (
          block.lines.map((line, offset) => <DiffRow key={block.start + offset} line={line} tokens={tokensOf(line)} />)
        ),
      )}
    </div>
  );
}
