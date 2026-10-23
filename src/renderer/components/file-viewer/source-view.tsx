import { CodeLineText } from "./code-line";
import { useHighlightedLines } from "./highlighted-lines";

export function SourceView({ code, language, wrapLines }: { code: string; language: string; wrapLines: boolean }) {
  const lines = useHighlightedLines(code, language);
  return (
    <div className={`file-code prismjs type-mono-code${wrapLines ? " is-wrapped" : ""}`}>
      {lines.map((tokens, index) => (
        <div key={index} className="file-code-row">
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
