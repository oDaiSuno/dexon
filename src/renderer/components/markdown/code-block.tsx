import { useEffect, useState, type ReactNode } from "react";
import { SyntaxHighlighter } from "@/lib/syntax-highlight";
import { useTheme } from "@/hooks/useTheme";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { shouldHighlightCode } from "@/lib/code-highlight-policy";
import { mermaidCacheKey, renderMermaidSvg } from "@/lib/mermaid-renderer";

export type CodeBlockVariant = "card" | "plain";

export function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { isDark } = useTheme();
  const [showPreview, setShowPreview] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const currentKey = mermaidCacheKey(code, isDark);

  useEffect(() => {
    if (!showPreview || isStreaming) return;

    let cancelled = false;
    setFailedKey(null);

    const render = async () => {
      const rendered = await renderMermaidSvg(code, isDark);
      if (!cancelled) {
        setSvg(rendered);
        setRenderedKey(currentKey);
      }
    };

    render().catch(() => {
      if (!cancelled) setFailedKey(currentKey);
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, isStreaming, showPreview]);

  const previewButton = (
    <button
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={
        isStreaming
          ? "Preview available after streaming"
          : showPreview
            ? "Show Mermaid source"
            : "Preview Mermaid diagram"
      }
      className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {showPreview ? "Source" : "Preview"}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
  }

  const body =
    failedKey === currentKey ? (
      <div className="mermaid-block mermaid-block-error">Invalid Mermaid diagram</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div className="mermaid-block mermaid-block-loading" aria-label="Rendering Mermaid diagram" />
    ) : (
      <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />
    );

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">mermaid</span>
        {previewButton}
      </div>
      {body}
    </div>
  );
}

function PlainCodeBlock({ code, lang }: { code: string; lang: string }) {
  return shouldHighlightCode(code) ? (
    <SyntaxHighlighter
      language={lang || "text"}
      className="markdown-code-plain type-mono-code"
      codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
    >
      {code}
    </SyntaxHighlighter>
  ) : (
    <pre className="markdown-code-plain type-mono-code">
      <code>{code}</code>
    </pre>
  );
}

export function CodeBlock({
  code,
  lang,
  headerAction,
  variant = "card",
}: {
  code: string;
  lang: string;
  headerAction?: ReactNode;
  variant?: CodeBlockVariant;
}) {
  if (variant === "plain") return <PlainCodeBlock code={code} lang={lang} />;
  return <CodeCard code={code} lang={lang} headerAction={headerAction} />;
}

function CodeCard({ code, lang, headerAction }: { code: string; lang: string; headerAction?: ReactNode }) {
  const { copied, copy } = useCopyFeedback();

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || "text"}</span>
        <div className="markdown-code-actions">
          {headerAction}
          <button
            onClick={() => void copy(code)}
            className={["markdown-code-copy", copied ? "is-copied" : ""].filter(Boolean).join(" ")}
            aria-label={copied ? "copied" : "copy"}
          >
            {copied ? (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="12" height="12" rx="2.5" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {shouldHighlightCode(code) ? (
        <SyntaxHighlighter
          language={lang || "text"}
          className="markdown-code-body type-mono-chat-code"
          showLineNumbers
          lineNumberStyle={{ color: "var(--fx-text-tertiary)", fontStyle: "normal" }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
        >
          {code}
        </SyntaxHighlighter>
      ) : (
        <pre className="markdown-code-body type-mono-chat-code">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
