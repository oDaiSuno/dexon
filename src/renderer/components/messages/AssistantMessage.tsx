import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "../MarkdownBody";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import {
  getAssistantFailureDetail,
  hasRenderableAssistantMessage,
  isAssistantFailure,
  isEmptyTextBlock,
  isEmptyThinkingBlock,
} from "@/lib/message-display";
import { useI18n } from "@/i18n";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { DeferredContentActions, formatTime, tokenizeStreamTail } from "./shared";
import type {
  AssistantContentBlock,
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ToolResultMessage,
} from "@/lib/types";

export function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  toolCallDurations,
  modelNames,
  cwd,
  onOpenFile,
  showTimestamp,
  prevTimestamp,
  onLoadDeferredContent,
  entryId,
  thinkingExpansionStore,
  inProcessGroup,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  toolCallDurations?: ReadonlyMap<string, number>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  entryId?: string;
  thinkingExpansionStore?: ThinkingExpansionStore;
  inProcessGroup?: boolean;
}) {
  const { t } = useI18n();
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blockItems = (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming }) && !isEmptyTextBlock(block, { isStreaming }));
  const blocks = blockItems.map(({ block }) => block);
  const [hovered, setHovered] = useState(false);
  const { copied, copy } = useCopyFeedback();
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blockItemsRef = useRef(blockItems);
  blockItemsRef.current = blockItems;
  const failureDetail = isAssistantFailure(message)
    ? (getAssistantFailureDetail(message) ??
      t(
        "modelRequestFailedFallback",
        "The model service did not return error details. Check the API key, service URL, and model configuration.",
      ))
    : null;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  // This is the total generation time (thinking + any text before first tool call)
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const copyContent = () => void copy(textContent);

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = new Date().getTime();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const items = blockItemsRef.current;
      const bs = items.map(({ block }) => block);
      const now = Date.now();

      // Record start time for each block the first time we see it
      items.forEach(({ originalIndex }) => {
        if (!blockStartTimesRef.current.has(originalIndex)) blockStartTimesRef.current.set(originalIndex, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < items.length - 1; i++) {
          const originalIndex = items[i].originalIndex;
          const nextOriginalIndex = items[i + 1].originalIndex;
          if (!next.has(originalIndex) && blockStartTimesRef.current.has(originalIndex)) {
            const start = blockStartTimesRef.current.get(originalIndex)!;
            const nextStart = blockStartTimesRef.current.get(nextOriginalIndex) ?? now;
            next.set(originalIndex, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      let chars = 0;
      for (const b of bs) {
        if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
        else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
        else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
      }
      if (chars === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(chars / 4 / elapsed);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (!hasRenderableAssistantMessage(message, { isStreaming }) && !isStreaming) return null;

  return (
    <div style={{ marginBottom: 14 }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* Streaming meta: token estimate + live t/s (quiet mono). The model
          name joins the usage line once the turn completes. */}
      {isStreaming && (
        <div
          style={{
            fontSize: scaledChatFont(12),
            color: "var(--bui-ink-3)",
            marginBottom: 6,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-mono)",
          }}
        >
          {(() => {
            let chars = 0;
            for (const b of blocks) {
              if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
              else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
              else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
            }
            const est = Math.round(chars / 4);
            return (
              <>
                {est > 0 && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      color: "var(--bui-ink-3)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                    title="Estimated token count while streaming"
                  >
                    <span>{est.toLocaleString()} tok</span>
                    {tps !== null && (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        {/* speed tier uses status colors only: green fast → orange → red slow */}
                        <span
                          aria-hidden="true"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background:
                              tps >= 50 ? "var(--bui-green)" : tps >= 15 ? "var(--bui-orange)" : "var(--bui-red)",
                          }}
                        />
                        <span>{tps.toFixed(1)} t/s</span>
                      </span>
                    )}
                  </span>
                )}
              </>
            );
          })()}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blockItems.map(({ block, originalIndex }) => (
          <BlockView
            key={originalIndex}
            block={block}
            toolResults={toolResults}
            isStreaming={isStreaming}
            streamingDuration={
              streamingDurations.get(originalIndex) ??
              (block.type === "thinking" ? thinkingDurationFromFile : undefined)
            }
            toolCallDurations={toolCallDurations}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onLoadDeferredContent={onLoadDeferredContent}
            thinkingStateKey={`${entryId ?? "assistant"}:${originalIndex}`}
            thinkingExpansionStore={thinkingExpansionStore}
          />
        ))}
        <DeferredContentActions content={message.content} onLoad={onLoadDeferredContent} />
        {failureDetail && !isStreaming && (
          <div
            role="alert"
            data-testid="assistant-error-message"
            style={{
              border: "1px solid color-mix(in srgb, var(--bui-red) 30%, transparent)",
              borderRadius: "var(--bui-r-card)",
              background: "var(--bui-red-tint)",
              padding: "10px 12px",
              fontSize: scaledChatFont(13),
              lineHeight: 1.55,
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 3, color: "var(--bui-red)" }}>
              {t("modelRequestFailed", "Model request failed")}
            </div>
            <div style={{ color: "var(--bui-ink-2)" }}>{failureDetail}</div>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: 6,
        }}
      >
        {message.usage && !isStreaming && (
          <div
            style={{
              fontSize: scaledChatFont(11),
              color: "var(--bui-ink-3)",
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              marginRight: 2,
            }}
          >
            {/* model identity lives here, joined to the usage figures;
                suppressed inside process details where it repeats per turn */}
            {!inProcessGroup && message.provider && (
              <span style={{ marginRight: 8 }}>
                {modelNames?.[`${message.provider}:${message.model}`] ?? modelNames?.[message.model] ?? message.model}
              </span>
            )}
            {formatUsage(message.usage)}
          </div>
        )}
        {textContent && !isStreaming && (
          <button
            type="button"
            className="message-hover-action"
            onClick={copyContent}
            title="Copy message"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              background: "none",
              border: "none",
              borderRadius: "var(--bui-r-chip)",
              color: copied ? "var(--bui-green)" : "var(--bui-ink-3)",
              cursor: "pointer",
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
              transition: "opacity var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out)",
            }}
            onMouseEnter={(e) => {
              if (!copied) e.currentTarget.style.color = "var(--bui-ink-2)";
            }}
            onMouseLeave={(e) => {
              if (!copied) e.currentTarget.style.color = "var(--bui-ink-3)";
            }}
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
              >
                <rect x="9" y="9" width="12" height="12" rx="2.5" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        )}
        {time && !isStreaming && (
          <span
            style={{
              fontSize: scaledChatFont(11),
              color: "var(--bui-ink-3)",
              fontFamily: "var(--font-mono)",
              marginLeft: "auto",
            }}
          >
            {time}
          </span>
        )}
      </div>
    </div>
  );
}

function BlockView({
  block,
  toolResults,
  isStreaming,
  streamingDuration,
  toolCallDurations,
  cwd,
  onOpenFile,
  onLoadDeferredContent,
  thinkingStateKey,
  thinkingExpansionStore,
}: {
  block: AssistantContentBlock;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  isStreaming?: boolean;
  streamingDuration?: number;
  toolCallDurations?: ReadonlyMap<string, number>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  thinkingStateKey: string;
  thinkingExpansionStore?: ThinkingExpansionStore;
}) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (block.type === "thinking") {
    return (
      <>
        <ThinkingBlock
          block={block as ThinkingContent}
          duration={streamingDuration}
          stateKey={thinkingStateKey}
          store={thinkingExpansionStore}
          streaming={isStreaming}
        />
        <DeferredContentActions content={[block]} onLoad={onLoadDeferredContent} />
      </>
    );
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    return (
      <>
        <ToolCallBlock block={tc} result={result} duration={duration} onLoadDeferredContent={onLoadDeferredContent} />
        <DeferredContentActions content={[block]} onLoad={onLoadDeferredContent} />
      </>
    );
  }
  return null;
}

function TextBlock({
  block,
  isStreaming,
  cwd,
  onOpenFile,
}: {
  block: TextContent;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const text = block.text ?? "";
  if (!isStreaming) {
    return (
      <div
        style={{
          fontSize: scaledChatFont(13.5),
          lineHeight: 1.7,
          minWidth: 0,
        }}
      >
        <MarkdownBody cwd={cwd} onOpenFile={onOpenFile}>
          {text}
        </MarkdownBody>
      </div>
    );
  }
  // transitions.dev 30-streaming-text, adapted for growing markdown:
  // settled lines render as markdown; only the tail after the last newline
  // resolves token by token (CJK per glyph, latin per word), keyed by the
  // token's absolute character offset so existing tokens never replay.
  const lastBreak = text.lastIndexOf("\n");
  const settled = lastBreak >= 0 ? text.slice(0, lastBreak + 1) : "";
  const tail = lastBreak >= 0 ? text.slice(lastBreak + 1) : text;
  const tailOffset = lastBreak >= 0 ? lastBreak + 1 : 0;
  const tokens = tokenizeStreamTail(tail, tailOffset);
  return (
    <div
      style={{
        fontSize: scaledChatFont(13.5),
        lineHeight: 1.7,
        minWidth: 0,
      }}
    >
      {settled && (
        <MarkdownBody isStreaming cwd={cwd} onOpenFile={onOpenFile}>
          {settled}
        </MarkdownBody>
      )}
      <span>
        {tokens.map((token) => (
          <span key={token.start} className="chat-stream-token">
            {token.text}
          </span>
        ))}
        <span className="chat-stream-caret" aria-hidden="true" />
      </span>
    </div>
  );
}

function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}
