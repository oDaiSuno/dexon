import type { CSSProperties } from "react";
import { CodeLineText } from "@/components/file-viewer/code-line";
import { shouldHighlightCode } from "@/lib/code-highlight-policy";
import { useCodeLines } from "@/lib/highlighted-lines";

export function CodeLines({
  code,
  lang,
  wrapLines,
  className,
}: {
  code: string;
  lang: string;
  wrapLines: boolean;
  className?: string;
}) {
  const lines = useCodeLines(code, lang, shouldHighlightCode(code));
  const gutterDigits = Math.max(2, String(lines.length).length);

  return (
    <pre
      className={["markdown-code-body", "prismjs", "type-mono-chat-code", wrapLines ? "is-wrapped" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={{ "--code-gutter-digits": String(gutterDigits) } as CSSProperties}
    >
      <code className="markdown-code-lines">
        {lines.map((tokens, index) => (
          <span key={index} className="markdown-code-line">
            <span className="markdown-code-line-no" aria-hidden="true">
              {index + 1}
            </span>
            <span className="markdown-code-line-text">
              <CodeLineText tokens={tokens} />
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}
