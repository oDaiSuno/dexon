import { createContext, useContext, useMemo, useRef, useState, type JSX, type MouseEvent, type ReactNode } from "react";
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
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { CodeBlock, MermaidBlock, type CodeBlockVariant } from "./markdown/code-block";
import {
  closeLinkPopover,
  LinkPopover,
  openExternalLinkUrl,
  toggleLinkPopover,
  useActiveLinkPopover,
} from "./markdown/link-popover";
import { MarkdownImage } from "./markdown/markdown-image";
import { normalizeExternalHref } from "@shared/external-links";

interface MarkdownBodyProps {
  environmentId?: EnvironmentId;
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  imageBasePath?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string, environmentId?: EnvironmentId) => void;
  inlineChips?: InlineChips;
  codeBlockVariant?: CodeBlockVariant;
  mathMode?: MathMode;
}

type MathMode = "chat" | "file";

export interface InlineChips {
  leadingSkill?: string | null;
  quote?: (ref: { quoteId: string; raw: string }) => ReactNode;
  attachment: (token: { path: string; quoted: boolean }) => ReactNode;
  skill: (name: string) => ReactNode;
}

interface ChipNodeData {
  attachmentToken?: { path: string; quoted: boolean };
  skillToken?: { name: string };
  quoteToken?: { quoteId: string; raw: string };
}

type MarkdownRenderContextValue = Pick<
  MarkdownBodyProps,
  "environmentId" | "isStreaming" | "cwd" | "imageBasePath" | "sourceSessionId" | "onOpenFile" | "codeBlockVariant"
> & { streamingSource?: string };

const MarkdownRenderContext = createContext<MarkdownRenderContextValue>({});

type MarkdownComponentProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & {
  node?: unknown;
};

interface HastPositionNode {
  position?: {
    start?: { line?: number };
    end?: { line?: number };
  };
}

function isFencedCodeStreaming(
  streamingSource: string | undefined,
  isStreaming: boolean | undefined,
  node: unknown,
): boolean {
  if (!isStreaming) return false;
  if (!streamingSource) return true;
  const position = (node as HastPositionNode | undefined)?.position;
  const startLine = position?.start?.line;
  const endLine = position?.end?.line;
  if (typeof startLine !== "number" || typeof endLine !== "number" || endLine <= startLine) return true;
  const lines = streamingSource.split("\n");
  const openingLine = lines[startLine - 1];
  const closingLine = lines[endLine - 1];
  if (typeof openingLine !== "string" || typeof closingLine !== "string") return true;
  const openMatch = /^\s*(?:>\s*)*(`{3,}|~{3,})/.exec(openingLine);
  if (!openMatch) return true;
  const fenceChar = openMatch[1][0];
  const minLength = openMatch[1].length;
  const closeMatch = /^\s*(?:>\s*)*(`{3,}|~{3,})\s*$/.exec(closingLine);
  if (!closeMatch) return true;
  return closeMatch[1][0] !== fenceChar || closeMatch[1].length < minLength;
}

function MarkdownCode({ className, children, node, ...props }: MarkdownComponentProps<"code">) {
  const { isStreaming, streamingSource, codeBlockVariant } = useContext(MarkdownRenderContext);
  const lang = className?.replace("language-", "").toLowerCase() ?? "";
  const raw = String(children);
  const isBlock = className?.includes("language-") || raw.includes("\n");
  if (isBlock) {
    if (lang === "mermaid") {
      return (
        <MermaidBlock
          code={raw.replace(/\n$/, "")}
          isStreaming={isFencedCodeStreaming(streamingSource, isStreaming, node)}
        />
      );
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

function hasSelectedText(anchor: HTMLAnchorElement): boolean {
  const selection = anchor.ownerDocument.defaultView?.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
}

function MarkdownAnchor({ href, children, node: _node, ...props }: MarkdownComponentProps<"a">) {
  const { cwd, imageBasePath, onOpenFile, environmentId = PRIMARY_ENVIRONMENT_ID } = useContext(MarkdownRenderContext);
  const { language, t } = useI18n();
  const affordances = environmentAffordances(useEnvironments().find((view) => view.id === environmentId));
  const [menuError, setMenuError] = useState(false);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const activePopover = useActiveLinkPopover(anchorRef);
  const filePath = resolveLocalFileHref(href, cwd, imageBasePath ?? cwd);
  const externalHref = !filePath ? normalizeExternalHref(href) : null;

  if (!filePath) {
    if (externalHref) {
      const openExternal = () => openExternalLinkUrl(externalHref);
      const handleExternalClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (hasSelectedText(event.currentTarget)) {
          event.preventDefault();
          closeLinkPopover();
          return;
        }
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          closeLinkPopover();
          void openExternal().catch(() => undefined);
          return;
        }
        if (event.shiftKey || event.altKey) return;
        event.preventDefault();
        toggleLinkPopover({
          kind: "external",
          anchor: event.currentTarget,
          copyValue: externalHref,
          openTitle: externalHref,
          onOpen: openExternal,
          clickPoint: event.detail > 0 ? { x: event.clientX, y: event.clientY } : undefined,
        });
      };
      return (
        <>
          <a ref={anchorRef} href={href} title={props.title ?? externalHref} {...props} onClick={handleExternalClick}>
            {children}
          </a>
          {activePopover && <LinkPopover active={activePopover} />}
        </>
      );
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  const hrefText = typeof href === "string" ? href : "";
  const revealInFolder = /^file:/i.test(hrefText) || /^[a-zA-Z]:[\\/]/.test(hrefText) || hrefText.startsWith("/");
  const canRevealInFolder =
    revealInFolder && affordances.revealInFileManager && Boolean(window.piBridge?.showItemInFolder);
  const openLocal =
    canRevealInFolder || onOpenFile
      ? async () => {
          if (canRevealInFolder && window.piBridge?.showItemInFolder) {
            await window.piBridge.showItemInFolder(filePath);
            return;
          }
          onOpenFile?.(filePath, environmentId);
        }
      : undefined;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (hasSelectedText(event.currentTarget)) {
      event.preventDefault();
      closeLinkPopover();
      return;
    }
    const target = event.currentTarget.getAttribute("target");
    if (target && target !== "_self") return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      closeLinkPopover();
      if (openLocal) void openLocal().catch(() => undefined);
      return;
    }
    if (event.shiftKey || event.altKey) return;
    event.preventDefault();
    toggleLinkPopover({
      kind: "local",
      anchor: event.currentTarget,
      copyValue: filePath,
      openTitle: filePath,
      onOpen: openLocal,
      clickPoint: event.detail > 0 ? { x: event.clientX, y: event.clientY } : undefined,
    });
  };

  const handleContextMenu = (event: MouseEvent<HTMLAnchorElement>) => {
    closeLinkPopover();
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
      <a
        ref={anchorRef}
        href={href}
        title={props.title ?? filePath}
        {...props}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {children}
      </a>
      {activePopover && <LinkPopover active={activePopover} />}
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
  const quoteId = (props as Record<string, unknown>)["data-quote-ref"];
  const quote = data?.quoteToken ?? (typeof quoteId === "string" ? { quoteId, raw: `[quote:${quoteId}]` } : null);
  if (quote) return <>{chips?.quote?.(quote) ?? quote.raw}</>;
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
  environmentId = PRIMARY_ENVIRONMENT_ID,
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
  const streamingSource = isStreaming ? children : undefined;
  const renderContext = useMemo(
    () => ({
      environmentId,
      isStreaming,
      streamingSource,
      cwd,
      imageBasePath,
      sourceSessionId,
      onOpenFile,
      codeBlockVariant,
    }),
    [environmentId, codeBlockVariant, cwd, imageBasePath, isStreaming, streamingSource, onOpenFile, sourceSessionId],
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
              {children}
            </ReactMarkdown>
          </div>
        </InlineChipsContext.Provider>
      </MarkdownRenderContext.Provider>
    </SessionProfiler>
  );
}
