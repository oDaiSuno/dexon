import { MarkdownBody } from "../MarkdownBody";
import {
  getAssistantFailureDetail,
  hasRenderableAssistantMessage,
  isAssistantFailure,
  isEmptyTextBlock,
  isEmptyThinkingBlock,
} from "@/lib/message-display";
import { thinkingDurationSeconds } from "@/lib/process-flow";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { FailureLine } from "./FailureLine";
import { StreamSpeedHint } from "./StreamSpeedHint";
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
  const failed = isAssistantFailure(message);

  if (!hasRenderableAssistantMessage(message, { isStreaming }) && !isStreaming) return null;
  if (failed && blocks.length === 0 && !isStreaming) {
    return <FailureLine detail={getAssistantFailureDetail(message)} retried={retried} retry={message.retry} />;
  }

  return (
    <div style={{ marginBottom: compact ? 8 : 14 }}>
      {isStreaming && <StreamSpeedHint message={message} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blockItems.map(({ block, originalIndex }) => (
          <BlockView
            key={originalIndex}
            block={block}
            toolResults={toolResults}
            isStreaming={isStreaming}
            streamingDuration={
              block.type === "thinking" ? thinkingDurationSeconds(message, originalIndex, prevTimestamp) : undefined
            }
            toolCallDurations={toolCallDurations}
            toolStartedAt={compact && !isStreaming ? message.timestamp : undefined}
            cwd={cwd}
            onOpenFile={onOpenFile}
            onLoadDeferredContent={onLoadDeferredContent}
            blockStateKey={`${entryId ?? "assistant"}:${originalIndex}`}
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
  blockStateKey,
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
  blockStateKey: string;
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
          stateKey={blockStateKey}
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
          stateKey={blockStateKey}
          expansionStore={thinkingExpansionStore}
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
