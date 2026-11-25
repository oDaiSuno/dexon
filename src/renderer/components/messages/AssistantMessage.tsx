import type { LiveToolUpdate } from "@/hooks/agent-session/shared";
import type { EnvironmentId } from "@contract/environment";
import { MarkdownBody } from "../MarkdownBody";
import {
  getAssistantFailureDetail,
  hasRenderableAssistantMessage,
  isAssistantFailure,
  isAssistantLengthTruncated,
  isEmptyTextBlock,
  isEmptyThinkingBlock,
} from "@/lib/message-display";
import { thinkingDurationSeconds } from "@/lib/process-flow";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { readAutomationChatCard } from "@shared/automation/chat-tools";
import { AutomationChatCardView } from "./automation-chat-card";
import { FailureLine, LengthLimitLine } from "./FailureLine";
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
  environmentId,
  sourceSessionId,
  message,
  isStreaming,
  toolResults,
  liveToolUpdates,
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
  environmentId: EnvironmentId;
  sourceSessionId?: string | null;
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  liveToolUpdates?: ReadonlyMap<string, LiveToolUpdate>;
  toolCallDurations?: ReadonlyMap<string, number>;
  cwd?: string;
  onOpenFile?: (filePath: string, environmentId?: EnvironmentId) => void;
  prevTimestamp?: number;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  entryId?: string;
  thinkingExpansionStore?: ThinkingExpansionStore;
  compact?: boolean;
  retried?: boolean;
}) {
  const blockItems = (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming }) && !isEmptyTextBlock(block, { isStreaming }));
  const blocks = blockItems.map(({ block }) => block);
  const failed = isAssistantFailure(message);
  const truncated = isAssistantLengthTruncated(message);

  if (!hasRenderableAssistantMessage(message, { isStreaming }) && !isStreaming) return null;
  if (truncated && blocks.length === 0 && !isStreaming) {
    return <LengthLimitLine detail={getAssistantFailureDetail(message)} />;
  }
  if (failed && blocks.length === 0 && !isStreaming) {
    return <FailureLine detail={getAssistantFailureDetail(message)} retried={retried} retry={message.retry} />;
  }

  return (
    <div style={{ marginBottom: compact ? 8 : 14 }}>
      {isStreaming && <StreamSpeedHint message={message} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blockItems.map(({ block, originalIndex }) => (
          <BlockView
            environmentId={environmentId}
            sourceSessionId={sourceSessionId}
            key={originalIndex}
            block={block}
            toolResults={toolResults}
            liveToolUpdates={liveToolUpdates}
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
        {truncated && !isStreaming && <LengthLimitLine detail={getAssistantFailureDetail(message)} />}
      </div>
    </div>
  );
}

function BlockView({
  environmentId,
  sourceSessionId,
  block,
  toolResults,
  liveToolUpdates,
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
  environmentId: EnvironmentId;
  sourceSessionId?: string | null;
  block: AssistantContentBlock;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  liveToolUpdates?: ReadonlyMap<string, LiveToolUpdate>;
  isStreaming?: boolean;
  streamingDuration?: number;
  toolCallDurations?: ReadonlyMap<string, number>;
  toolStartedAt?: number;
  cwd?: string;
  onOpenFile?: (filePath: string, environmentId?: EnvironmentId) => void;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  blockStateKey: string;
  thinkingExpansionStore?: ThinkingExpansionStore;
}) {
  if (block.type === "text") {
    return (
      <TextBlock
        environmentId={environmentId}
        sourceSessionId={sourceSessionId}
        block={block as TextContent}
        isStreaming={isStreaming}
        cwd={cwd}
        onOpenFile={onOpenFile}
      />
    );
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
    const automationCard = result && !result.isError ? readAutomationChatCard(result.details) : null;
    return (
      <>
        <ToolCallBlock
          block={tc}
          result={result}
          liveUpdate={liveToolUpdates?.get(tc.toolCallId)}
          environmentId={environmentId}
          cwd={cwd}
          onOpenFile={onOpenFile}
          duration={duration}
          startedAt={toolStartedAt}
          stateKey={blockStateKey}
          expansionStore={thinkingExpansionStore}
          onLoadDeferredContent={onLoadDeferredContent}
        />
        {automationCard && <AutomationChatCardView environmentId={environmentId} card={automationCard} />}
        <DeferredContentActions content={[block]} onLoad={onLoadDeferredContent} />
      </>
    );
  }
  return null;
}

function TextBlock({
  environmentId,
  sourceSessionId,
  block,
  isStreaming,
  cwd,
  onOpenFile,
}: {
  environmentId: EnvironmentId;
  sourceSessionId?: string | null;
  block: TextContent;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, environmentId?: EnvironmentId) => void;
}) {
  const text = block.text ?? "";
  if (!isStreaming) {
    return (
      <div className="chat-reading type-chat-body" style={{ minWidth: 0 }}>
        <MarkdownBody environmentId={environmentId} sourceSessionId={sourceSessionId} cwd={cwd} onOpenFile={onOpenFile}>
          {text}
        </MarkdownBody>
      </div>
    );
  }
  const lastBreak = text.lastIndexOf("\n");
  const settled = lastBreak >= 0 ? text.slice(0, lastBreak + 1) : "";
  const tail = lastBreak >= 0 ? text.slice(lastBreak + 1) : text;
  const tailOffset = lastBreak >= 0 ? lastBreak + 1 : 0;
  const tokens = tokenizeStreamTail(tail, tailOffset);
  return (
    <div className="chat-reading type-chat-body" style={{ minWidth: 0 }}>
      {settled && (
        <MarkdownBody
          environmentId={environmentId}
          sourceSessionId={sourceSessionId}
          isStreaming
          cwd={cwd}
          onOpenFile={onOpenFile}
        >
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
