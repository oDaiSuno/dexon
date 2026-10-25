import type { MouseEvent } from "react";
import { CodeLineText } from "./code-line";
import { useHighlightedLines } from "./highlighted-lines";

export interface SourceCursor {
  line: number;
  column: number;
}

function caretColumn(text: Element | null): number {
  const selection = window.getSelection();
  const node = selection?.focusNode;
  if (!selection || !text || !node || !text.contains(node)) return 1;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(node, selection.focusOffset);
  return range.toString().length + 1;
}

export function SourceView({
  code,
  language,
  wrapLines,
  cursorLine,
  onCursorChange,
}: {
  code: string;
  language: string;
  wrapLines: boolean;
  cursorLine: number | null;
  onCursorChange: (cursor: SourceCursor) => void;
}) {
  const lines = useHighlightedLines(code, language);
  const markLine = (event: MouseEvent<HTMLDivElement>) => {
    const row = (event.target as Element).closest<HTMLElement>("[data-line]");
    if (!row) return;
    onCursorChange({
      line: Number(row.dataset.line),
      column: caretColumn(row.querySelector(".file-code-text")),
    });
  };

  return (
    <div className={`file-code prismjs type-mono-code${wrapLines ? " is-wrapped" : ""}`} onClick={markLine}>
      {lines.map((tokens, index) => (
        <div
          key={index}
          data-line={index + 1}
          className={index + 1 === cursorLine ? "file-code-row is-current" : "file-code-row"}
          aria-current={index + 1 === cursorLine ? "true" : undefined}
        >
          <span className="file-code-no" aria-hidden="true">
            {index + 1}
          </span>
          <span className="file-code-text">
            <CodeLineText tokens={tokens} />
          </span>
        </div>
      ))}
    </div>
  );
}
