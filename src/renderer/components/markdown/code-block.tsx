import { useEffect, useState, type ReactNode } from "react";
import { SyntaxHighlighter } from "@/lib/syntax-highlight";
import { useTheme } from "@/hooks/useTheme";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useI18n } from "@/i18n";
import { shouldHighlightCode } from "@/lib/code-highlight-policy";
import { mermaidCacheKey, renderMermaidSvg } from "@/lib/mermaid-renderer";
import {
  CheckIcon,
  CopyIcon,
  ExpandIcon,
  WarningTriangleIcon,
  WordWrapIcon,
} from "@/components/media-lightbox/media-lightbox-icons";
import { MermaidLightbox } from "@/components/media-lightbox/mermaid-lightbox";
import { CodeLines } from "./code-lines";

export type CodeBlockVariant = "card" | "plain";

type MermaidViewMode = "preview" | "source";

interface RenderedMermaid {
  key: string;
  code: string;
  svg: string;
}

export function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const [viewModeOverride, setViewModeOverride] = useState<MermaidViewMode | null>(null);
  const [rendered, setRendered] = useState<RenderedMermaid | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const currentKey = mermaidCacheKey(code, isDark);

  useEffect(() => {
    if (isStreaming) return;

    let cancelled = false;

    const render = async () => {
      const svg = await renderMermaidSvg(code, isDark);
      if (!cancelled) {
        setRendered({ key: currentKey, code, svg });
        setFailedKey((prev) => (prev === currentKey ? null : prev));
      }
    };

    render().catch(() => {
      if (!cancelled) setFailedKey(currentKey);
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, isStreaming]);

  const hasFailed = !isStreaming && failedKey === currentKey;
  const activeSvg = !isStreaming && !hasFailed && rendered?.code === code ? rendered.svg : null;
  const isReady = activeSvg !== null;
  const showDiagram = isReady && viewModeOverride !== "source";

  if (hasFailed) {
    return (
      <CodeCard
        code={code}
        lang="mermaid"
        banner={
          <div className="mermaid-block-error-banner type-label-default" role="status">
            <WarningTriangleIcon />
            <span>{t("mermaidSyntaxErrorBanner", "Diagram syntax error — keeping source code for inspection")}</span>
          </div>
        }
      />
    );
  }

  if (showDiagram && activeSvg) {
    const copyLabel = copied ? t("copied", "Copied") : t("copySource", "Copy source");
    const expandLabel = t("expandPreview", "Expand");
    return (
      <>
        <div className="markdown-code-block">
          <div className="markdown-code-header">
            <span className="markdown-code-lang">mermaid</span>
            <div className="markdown-code-actions">
              <button
                type="button"
                onClick={() => setViewModeOverride("source")}
                title={t("mermaidShowSource", "Show Mermaid source")}
                className="markdown-code-action type-meta-default"
              >
                {t("source", "Source")}
              </button>
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="markdown-code-icon-btn"
                title={expandLabel}
                aria-label={expandLabel}
              >
                <ExpandIcon size={13} />
              </button>
              <button
                type="button"
                onClick={() => void copy(code)}
                className={["markdown-code-copy", copied ? "is-copied" : ""].filter(Boolean).join(" ")}
                title={copyLabel}
                aria-label={copyLabel}
              >
                {copied ? <CheckIcon /> : <CopyIcon size={14} />}
              </button>
            </div>
          </div>
          <div
            className="mermaid-block is-interactive"
            onDoubleClick={() => setLightboxOpen(true)}
            dangerouslySetInnerHTML={{ __html: activeSvg }}
          />
        </div>
        {lightboxOpen && <MermaidLightbox code={code} svg={activeSvg} onClose={() => setLightboxOpen(false)} />}
      </>
    );
  }

  const expandLabel = t("expandPreview", "Expand");
  const previewButton = (
    <button
      type="button"
      onClick={() => setViewModeOverride("preview")}
      disabled={!isReady}
      title={
        isReady
          ? t("mermaidShowPreview", "Preview Mermaid diagram")
          : t("mermaidPreviewStreamingHint", "Preview available after streaming")
      }
      className="markdown-code-action type-meta-default"
    >
      {t("preview", "Preview")}
    </button>
  );

  const expandButton = (
    <button
      type="button"
      onClick={() => {
        if (isReady) setLightboxOpen(true);
      }}
      disabled={!isReady}
      className="markdown-code-icon-btn"
      title={isReady ? expandLabel : t("mermaidPreviewStreamingHint", "Preview available after streaming")}
      aria-label={expandLabel}
    >
      <ExpandIcon size={13} />
    </button>
  );

  return (
    <>
      <CodeCard code={code} lang="mermaid" headerAction={previewButton} afterWrapAction={expandButton} />
      {lightboxOpen && activeSvg && (
        <MermaidLightbox code={code} svg={activeSvg} onClose={() => setLightboxOpen(false)} />
      )}
    </>
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

function CodeCard({
  code,
  lang,
  headerAction,
  afterWrapAction,
  banner,
}: {
  code: string;
  lang: string;
  headerAction?: ReactNode;
  afterWrapAction?: ReactNode;
  banner?: ReactNode;
}) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const [wrapLines, setWrapLines] = useState(true);
  const copyLabel = copied ? t("copied", "Copied") : t("copyCode", "Copy code");

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || "text"}</span>
        <div className="markdown-code-actions">
          {headerAction}
          <button
            type="button"
            onClick={() => setWrapLines((current) => !current)}
            className={["markdown-code-icon-btn", wrapLines ? "is-active" : ""].filter(Boolean).join(" ")}
            aria-label={t("wrap", "Word wrap")}
            aria-pressed={wrapLines}
            title={wrapLines ? t("disableWordWrap", "Disable word wrap") : t("enableWordWrap", "Enable word wrap")}
          >
            <WordWrapIcon size={13} />
          </button>
          {afterWrapAction}
          <button
            type="button"
            onClick={() => void copy(code)}
            className={["markdown-code-copy", copied ? "is-copied" : ""].filter(Boolean).join(" ")}
            title={copyLabel}
            aria-label={copyLabel}
          >
            {copied ? <CheckIcon /> : <CopyIcon size={14} />}
          </button>
        </div>
      </div>
      {banner}
      <CodeLines code={code} lang={lang || "text"} wrapLines={wrapLines} />
    </div>
  );
}
