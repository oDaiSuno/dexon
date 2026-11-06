import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ImgHTMLAttributes,
  type JSX,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type Options as ReactMarkdownOptions,
} from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import {
  chatRemarkPlugins,
  filePreviewRemarkPlugins,
  markdownRehypePlugins,
  userMessageRehypePlugins,
  userMessageRemarkPlugins,
  userMessageRemarkRehypeOptions,
} from "@/lib/markdown";
import { remarkLeadingSkill } from "@shared/markdown-attachment-tokens";
import { SessionProfiler } from "./SessionProfiler";
import { useI18n } from "@/i18n";
import { useEnvironments } from "@/lib/environment-registry";
import { environmentAffordances } from "@/lib/environment-affordances";
import { useFileEnvironment } from "@/lib/use-file-environment";
import type { EnvironmentId } from "@contract/environment";
import { CodeBlock, MermaidBlock, type CodeBlockVariant } from "./markdown/code-block";

interface MarkdownBodyProps {
  environmentId?: EnvironmentId;
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  imageBasePath?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string) => void;
  inlineChips?: InlineChips;
  codeBlockVariant?: CodeBlockVariant;
  mathMode?: MathMode;
}

type MathMode = "chat" | "file";

export interface InlineChips {
  leadingSkill?: string | null;
  attachment: (token: { path: string; quoted: boolean }) => ReactNode;
  skill: (name: string) => ReactNode;
}

interface ChipNodeData {
  attachmentToken?: { path: string; quoted: boolean };
  skillToken?: { name: string };
}

type MarkdownRenderContextValue = Pick<
  MarkdownBodyProps,
  "environmentId" | "isStreaming" | "cwd" | "imageBasePath" | "sourceSessionId" | "onOpenFile" | "codeBlockVariant"
>;

const MarkdownRenderContext = createContext<MarkdownRenderContextValue>({});

type MarkdownComponentProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & {
  node?: unknown;
};

function MarkdownCode({ className, children, node: _node, ...props }: MarkdownComponentProps<"code">) {
  const { isStreaming, codeBlockVariant } = useContext(MarkdownRenderContext);
  const lang = className?.replace("language-", "").toLowerCase() ?? "";
  const raw = String(children);
  const isBlock = className?.includes("language-") || raw.includes("\n");
  if (isBlock) {
    if (lang === "mermaid") {
      return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
    }
    return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} variant={codeBlockVariant} />;
  }
  return (
    <code className="markdown-inline-code" {...props}>
      {children}
    </code>
  );
}

function MarkdownPre({ children }: MarkdownComponentProps<"pre">) {
  return <>{children}</>;
}

function MarkdownAnchor({ href, children, node: _node, ...props }: MarkdownComponentProps<"a">) {
  const { cwd, onOpenFile, environmentId: requestedEnvironmentId } = useContext(MarkdownRenderContext);
  const environmentId = useFileEnvironment(requestedEnvironmentId);
  const { language, t } = useI18n();
  const affordances = environmentAffordances(useEnvironments().find((view) => view.id === environmentId));
  const [menuError, setMenuError] = useState(false);
  const filePath = resolveLocalFileHref(href, cwd);
  if (!filePath || !onOpenFile) {
    return (
      <a
        href={href}
        {...props}
        onClick={filePath && !affordances.isPrimary ? (event) => event.preventDefault() : undefined}
      >
        {children}
      </a>
    );
  }

  const hrefText = typeof href === "string" ? href : "";
  const revealInFolder = /^file:/i.test(hrefText) || /^[a-zA-Z]:[\\/]/.test(hrefText) || hrefText.startsWith("/");

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.currentTarget.getAttribute("target");
    if (target && target !== "_self") return;
    event.preventDefault();
    if (revealInFolder && affordances.revealInFileManager && window.piBridge?.showItemInFolder) {
      void window.piBridge.showItemInFolder(filePath);
      return;
    }
    onOpenFile(filePath);
  };

  const handleContextMenu = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || !affordances.revealInFileManager || !window.piBridge?.showFileContextMenu) return;
    event.preventDefault();
    const request = window.piBridge.showFileContextMenu({
      href: filePath,
      cwd,
      source: "rendered-agent-text",
      language,
    });
    void request.then((result) => setMenuError(!result.shown)).catch(() => setMenuError(true));
  };

  return (
    <>
      <a href={href} {...props} onClick={handleClick} onContextMenu={handleContextMenu}>
        {children}
      </a>
      {menuError && (
        <span role="status" className="type-label-default" style={{ marginLeft: 4, color: "var(--fx-status-danger)" }}>
          {t("fileContextMenuUnavailable", "The file menu could not be opened.")}
        </span>
      )}
    </>
  );
}

function MarkdownImg({ src, alt, node: _node, ...props }: MarkdownComponentProps<"img">) {
  const { cwd, imageBasePath, sourceSessionId, environmentId } = useContext(MarkdownRenderContext);
  return (
    <MarkdownImage
      environmentId={environmentId}
      src={src}
      alt={alt}
      cwd={cwd}
      relativeBase={imageBasePath ?? cwd}
      sourceSessionId={sourceSessionId}
      {...props}
    />
  );
}

function MarkdownTable({ children }: MarkdownComponentProps<"table">) {
  return (
    <div className="markdown-table-wrap">
      <table>{children}</table>
    </div>
  );
}

const markdownComponents: Components = {
  code: MarkdownCode,
  pre: MarkdownPre,
  a: MarkdownAnchor,
  img: MarkdownImg,
  table: MarkdownTable,
};

const InlineChipsContext = createContext<InlineChips | null>(null);

function InlineChipSpan({ node, children, ...props }: MarkdownComponentProps<"span">) {
  const chips = useContext(InlineChipsContext);
  const data = (node as { data?: ChipNodeData } | undefined)?.data;
  if (chips && data?.attachmentToken) return <>{chips.attachment(data.attachmentToken)}</>;
  if (chips && data?.skillToken) return <>{chips.skill(data.skillToken.name)}</>;
  return <span {...props}>{children}</span>;
}

const inlineChipComponents: Components = { ...markdownComponents, span: InlineChipSpan };

type UrlTransform = (url: string, key: string, node: unknown) => string;
const fileAwareUrlTransform: UrlTransform = (url, key, node) => {
  if (/^file:/i.test(url)) return url;
  return (defaultUrlTransform as UrlTransform)(url, key, node);
};

export function MarkdownBody({
  environmentId: requestedEnvironmentId,
  children,
  className,
  isStreaming,
  cwd,
  imageBasePath,
  sourceSessionId,
  onOpenFile,
  inlineChips,
  codeBlockVariant,
  mathMode = "chat",
}: MarkdownBodyProps) {
  const environmentId = useFileEnvironment(requestedEnvironmentId);
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  const renderContext = useMemo(
    () => ({ environmentId, isStreaming, cwd, imageBasePath, sourceSessionId, onOpenFile, codeBlockVariant }),
    [environmentId, codeBlockVariant, cwd, imageBasePath, isStreaming, onOpenFile, sourceSessionId],
  );
  const hasInlineChips = inlineChips !== undefined;
  const leadingSkill = inlineChips?.leadingSkill ?? null;
  const remarkPlugins = useMemo<ReactMarkdownOptions["remarkPlugins"]>(() => {
    const mathPlugins = mathMode === "file" ? filePreviewRemarkPlugins : chatRemarkPlugins;
    if (!hasInlineChips) return mathPlugins;
    if (leadingSkill === null) return userMessageRemarkPlugins;
    return [...userMessageRemarkPlugins, [remarkLeadingSkill, leadingSkill]];
  }, [hasInlineChips, leadingSkill, mathMode]);
  const rehypePlugins = hasInlineChips ? userMessageRehypePlugins : markdownRehypePlugins;
  const components = hasInlineChips ? inlineChipComponents : markdownComponents;

  return (
    <SessionProfiler id="MarkdownBody">
      <MarkdownRenderContext.Provider value={renderContext}>
        <InlineChipsContext.Provider value={inlineChips ?? null}>
          <div className={["markdown-body", className].filter(Boolean).join(" ")}>
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              remarkRehypeOptions={hasInlineChips ? userMessageRemarkRehypeOptions : undefined}
              urlTransform={fileAwareUrlTransform}
              components={components}
            >
              {normalizedMarkdown}
            </ReactMarkdown>
          </div>
        </InlineChipsContext.Provider>
      </MarkdownRenderContext.Provider>
    </SessionProfiler>
  );
}

function MarkdownImage({
  environmentId: requestedEnvironmentId,
  src,
  alt,
  cwd,
  relativeBase,
  sourceSessionId,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  environmentId?: EnvironmentId;
  cwd?: string;
  relativeBase?: string;
  sourceSessionId?: string | null;
}) {
  const environmentId = useFileEnvironment(requestedEnvironmentId);
  const identity = JSON.stringify([environmentId, src, cwd, relativeBase, sourceSessionId]);
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  const localPath = useMemo(
    () => resolveLocalFileHref(typeof src === "string" ? src : undefined, cwd, relativeBase),
    [cwd, relativeBase, src],
  );
  const [previewSrc, setPreviewSrc] = useState<string | null>(localPath ? null : typeof src === "string" ? src : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoadedIdentity(identity);
    if (!localPath) {
      setPreviewSrc(typeof src === "string" ? src : null);
      setFailed(false);
      return;
    }

    let disposed = false;
    let revoke: (() => void) | null = null;
    setPreviewSrc(null);
    setFailed(false);

    void import("@/lib/file-blob")
      .then(({ fileToObjectUrl }) => fileToObjectUrl(environmentId, localPath, sourceSessionId))
      .then((result) => {
        if (disposed) {
          result.revoke();
          return;
        }
        revoke = result.revoke;
        setPreviewSrc(result.url);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      revoke?.();
    };
  }, [environmentId, localPath, sourceSessionId, src, identity]);

  if (loadedIdentity !== identity)
    return <span className="markdown-image-loading" aria-label={alt || "Loading image"} />;

  if (failed) {
    return (
      <span className="markdown-image-error" title={localPath ?? undefined}>
        {alt || "Image failed to load"}
      </span>
    );
  }

  if (!previewSrc) {
    return <span className="markdown-image-loading" aria-label={alt || "Loading image"} />;
  }

  return <img src={previewSrc} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" {...props} />;
}

function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        const size = fenceMatch[1].length;
        if (!fence) fence = { marker, size };
        else if (marker === fence.marker && size >= fence.size) fence = null;
        return line;
      }

      if (fence) return line;

      const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
      if (!displayMathMatch) return line;

      const math = displayMathMatch[2].trim();
      if (!math) return line;

      return `${displayMathMatch[1]}$$${lineBreak}${math}${lineBreak}${displayMathMatch[1]}$$`;
    })
    .join(lineBreak);
}
