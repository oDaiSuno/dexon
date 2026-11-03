import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { isSessionToolName } from "@shared/session-orchestration";
import { useExpansion, type ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { SessionToolRow } from "./session-tool-row";
import { DeferredContentActions, useDelayedUnmount } from "./shared";
import { getResultDiff, PairedDiffResult } from "./DiffViews";
import { countDiffLines, toolVerbLabel, ToolGlyph } from "./tool-labels";
import { formatToolDuration, useElapsedSince } from "./tool-elapsed";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import { describeWorkspaceKey } from "@shared/workspace-ref";
import { toolFileReference } from "@/lib/tool-file-reference";
import { useToolFileNavigation } from "./tool-file-context";

interface ToolCallBlockProps {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
  startedAt?: number;
  stateKey: string;
  expansionStore?: ThinkingExpansionStore;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

export function ToolCallBlock(props: ToolCallBlockProps) {
  return isSessionToolName(props.block.toolName) ? <SessionToolRow {...props} /> : <GenericToolRow {...props} />;
}

function GenericToolRow({
  block,
  result,
  duration,
  startedAt,
  stateKey,
  expansionStore,
  onLoadDeferredContent,
  cwd,
  onOpenFile,
}: ToolCallBlockProps) {
  const [remembered, toggle] = useExpansion(expansionStore, stateKey);
  const expanded = remembered ?? false;
  const { t } = useI18n();
  const detailMounted = useDelayedUnmount(expanded);
  const inputStr = JSON.stringify(block.input, null, 2);
  const isEditTool = isEditToolName(block.toolName);
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;

  const resultText = result
    ? result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : resultText.trim() === "(no output)" || resultText.trim() === "";
  const isError = result?.isError ?? false;
  const isRunning = !result;
  const preview = getToolPreview(block);
  const browserTabId = isBrowserToolName(block.toolName) ? browserTabIdFromResult(resultText) : null;
  const diffCounts = resultDiff ? countDiffLines(resultDiff.text) : null;
  const label = toolVerbLabel(block.toolName, t);
  const elapsed = useElapsedSince(isRunning ? startedAt : undefined);
  const metaDuration = isRunning ? elapsed : diffCounts ? undefined : duration;
  const navigation = useToolFileNavigation();
  const sessionCwd = cwd ?? navigation.cwd;
  const openFile = onOpenFile ?? navigation.onOpenFile;
  const inputPath = block.input?.path ?? block.input?.file_path;
  const filePath =
    /(^|[._])(read|write|edit)$/i.test(block.toolName) && typeof inputPath === "string" ? inputPath : null;
  const reference = filePath ? toolFileReference(filePath, sessionCwd, navigation.homeDir) : null;
  const provenance =
    reference && describeWorkspaceKey(sessionCwd ?? "").isSsh
      ? reference.space === "local-overlay"
        ? t("sshToolLocalOverlay", "💻 Local read-only layer")
        : t("sshToolRemote", "Remote {host}").replace("{host}", reference.hostLabel ?? "")
      : null;

  return (
    <div className="chat-acc" data-open={expanded ? "true" : "false"}>
      <ToolCallHeader
        label={label}
        preview={preview}
        expanded={expanded}
        onToggle={() => toggle(expanded)}
        isRunning={isRunning}
        isError={isError}
        reference={reference}
        filePath={filePath}
        onOpenFile={openFile}
        provenance={provenance}
        icon={isRunning ? <span className="chat-tool-spinner" /> : <ToolGlyph toolName={block.toolName} />}
      >
        <span className="chat-tool-meta type-mono-label">
          {isRunning && (
            <span className={elapsed === undefined ? "chat-tool-meta-running" : "sr-only"}>
              {t("toolRunning", "running")}
            </span>
          )}
          {isError && (
            <span className={metaDuration === undefined ? "chat-tool-meta-failed" : "sr-only"}>
              {t("toolFailed", "failed")}
            </span>
          )}
          {diffCounts && !isRunning && (
            <>
              <span className="chat-tool-meta-added">+{diffCounts.added}</span>
              {diffCounts.removed > 0 && <span className="chat-tool-meta-removed">−{diffCounts.removed}</span>}
            </>
          )}
          {metaDuration !== undefined && (
            <span className={isRunning ? "chat-tool-meta-running" : isError ? "chat-tool-meta-failed" : undefined}>
              {formatToolDuration(metaDuration)}
            </span>
          )}
        </span>
      </ToolCallHeader>
      {/* Panel must stay a DIRECT child of .chat-acc: the accordion opens via
          `.chat-acc[data-open="true"] > .chat-acc-panel`, and the wrap is not
          the accordion root (this nesting is what broke expansion once). */}
      <div className="chat-acc-panel">
        <div className="chat-acc-panel-clip">
          {detailMounted && (
            <div className="chat-tool-detail type-mono-code">
              {!isEditTool && <pre className="chat-tool-input">{inputStr}</pre>}
              {resultDiff && <PairedDiffResult diff={resultDiff} />}
              {!resultDiff && result && (
                <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
              )}
              {browserTabId && (
                <button
                  type="button"
                  className="chat-tool-open-browser type-label-default"
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent("dexon:open-browser-tab", { detail: { tabId: browserTabId } }))
                  }
                >
                  {t("openInBrowser", "Open in Browser")} →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {result && <DeferredContentActions content={result.content} onLoad={onLoadDeferredContent} />}
    </div>
  );
}

function ToolCallHeader({
  label,
  preview,
  expanded,
  onToggle,
  isRunning,
  isError,
  reference,
  filePath,
  onOpenFile,
  provenance,
  icon,
  children,
}: {
  label: string;
  preview: string;
  expanded: boolean;
  onToggle: () => void;
  isRunning: boolean;
  isError: boolean;
  reference: ReturnType<typeof toolFileReference>;
  filePath: string | null;
  onOpenFile?: (path: string) => void;
  provenance: string | null;
  icon: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const className = `chat-tool-row chat-quiet-head${isRunning ? " is-running" : ""}${isError ? " is-error" : ""}`;
  const leading = (
    <>
      <span className={`chat-tool-icon${isError ? " is-error" : ""}`} aria-hidden="true">
        {icon}
      </span>
      <span className="chat-tool-name type-body-medium">{label}</span>
    </>
  );
  const chip = <span className="chat-tool-chip-text">{preview}</span>;
  if (!reference || !onOpenFile)
    return (
      <div className="chat-tool-row-wrap">
        <button type="button" className={className} aria-expanded={expanded} onClick={onToggle}>
          {leading}
          <span className="chat-tool-chip type-mono-label">{chip}</span>
          {children}
        </button>
      </div>
    );
  return (
    <div className="chat-tool-row-wrap">
      <div className={className}>
        <button
          type="button"
          className="chat-quiet-head"
          style={{ flexShrink: 0, height: "100%", margin: 0, padding: 0 }}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {leading}
          <span className="sr-only">{` ${preview}`}</span>
        </button>
        <button
          type="button"
          className="chat-tool-chip type-mono-label"
          style={{ border: "none", cursor: "pointer" }}
          aria-label={t("sshToolOpenFile", "Open {path}").replace("{path}", filePath!)}
          title={filePath!}
          onClick={() => onOpenFile(reference.path)}
        >
          {chip}
        </button>
        {provenance && (
          <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}>
            {provenance}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

function isBrowserToolName(value: string): boolean {
  return value.startsWith("browser_");
}

function browserTabIdFromResult(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { tabId?: unknown; id?: unknown };
    const tabId = typeof parsed.tabId === "string" ? parsed.tabId : typeof parsed.id === "string" ? parsed.id : null;
    return tabId && tabId.length <= 128 ? tabId : null;
  } catch {
    return null;
  }
}

function PairedResult({ text, isEmpty, isError }: { text: string; isEmpty: boolean; isError: boolean }) {
  return (
    <pre className={`chat-tool-result${isError ? " is-error" : isEmpty ? " is-empty" : ""}`}>
      {isEmpty ? "(no output)" : text}
    </pre>
  );
}

function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return (
    name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor")
  );
}

function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}
