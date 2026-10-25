import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "../MarkdownBody";
import {
  getAssistantFailureDetail,
  hasRenderableAssistantMessage,
  isAssistantFailure,
  isEmptyTextBlock,
  isEmptyThinkingBlock,
} from "@/lib/message-display";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { FailureLine } from "./FailureLine";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { DeferredContentActions, tokenizeStreamTail } from "./shared";
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
  cwd,
  onOpenFile,
  prevTimestamp,
  onLoadDeferredContent,
  entryId,
  thinkingExpansionStore,
  compact,
  retried,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  toolCallDurations?: ReadonlyMap<string, number>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  prevTimestamp?: number;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  entryId?: string;
  thinkingExpansionStore?: ThinkingExpansionStore;
  /* In-flight process stream: 8px rhythm like the process-details flow, no
     per-message footer (usage row + copy button) — the turn settles into
     groups once it completes. */
  compact?: boolean;
  retried?: boolean;
}) {
  const blockItems = (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming }) && !isEmptyTextBlock(block, { isStreaming }));
  const blocks = blockItems.map(({ block }) => block);
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blockItemsRef = useRef(blockItems);
  blockItemsRef.current = blockItems;
  const failed = isAssistantFailure(message);

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
  if (failed && blocks.length === 0 && !isStreaming) {
    return <FailureLine detail={getAssistantFailureDetail(message)} retried={retried} retry={message.retry} />;
  }

  return (
    <div style={{ marginBottom: compact ? 8 : 14 }}>
      {/* Streaming meta: token estimate + live t/s (quiet mono). */}
      {isStreaming && (
        <div
          className="type-mono-label"
          style={{
            color: "var(--fx-text-tertiary)",
            marginBottom: 6,
            display: "flex",
            alignItems: "center",
            gap: 8,
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
                      color: "var(--fx-text-tertiary)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                    title="Estimated token count while streaming"
                  >
                    <span>{est.toLocaleString()} tok</span>
                    {tps !== null && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {/* speed tier uses status colors only: green fast → orange → red slow */}
                        <span
                          aria-hidden="true"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background:
                              tps >= 50
                                ? "var(--fx-status-success-text)"
                                : tps >= 15
                                  ? "var(--fx-status-warning-text)"
                                  : "var(--fx-status-danger-text)",
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
            toolStartedAt={compact && !isStreaming ? message.timestamp : undefined}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onLoadDeferredContent={onLoadDeferredContent}
            thinkingStateKey={`${entryId ?? "assistant"}:${originalIndex}`}
            thinkingExpansionStore={thinkingExpansionStore}
          />
        ))}
        <DeferredContentActions content={message.content} onLoad={onLoadDeferredContent} />
        {failed && !isStreaming && (
          <FailureLine detail={getAssistantFailureDetail(message)} retried={retried} retry={message.retry} />
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
  toolStartedAt,
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
  toolStartedAt?: number;
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
        <ToolCallBlock
          block={tc}
          result={result}
          duration={duration}
          startedAt={toolStartedAt}
          onLoadDeferredContent={onLoadDeferredContent}
        />
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
      <div className="chat-reading type-chat-body" style={{ minWidth: 0 }}>
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
    <div className="chat-reading type-chat-body" style={{ minWidth: 0 }}>
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
