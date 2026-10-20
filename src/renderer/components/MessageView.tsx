import { memo } from "react";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { UserMessageView } from "./messages/UserMessage";
import { AssistantMessageView } from "./messages/AssistantMessage";
import { CompactionMessageView, CustomMessageView } from "./messages/SystemMessages";
import { DeferredContentActions } from "./messages/shared";
import type { AgentMessage, AssistantMessage, CustomMessage, ToolResultMessage, UserMessage } from "@/lib/types";

interface Props {
  /** Active session id — authorizes files.read for referenced attachment paths. */
  sessionId?: string | null;
  message: AgentMessage;
  /* Previous message is an assistant reply — user bubble gets turn-boundary top spacing. */
  afterAssistant?: boolean;
  isStreaming?: boolean;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  toolCallDurations?: ReadonlyMap<string, number>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  prevTimestamp?: number;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  thinkingExpansionStore?: ThinkingExpansionStore;
  compact?: boolean;
  retried?: boolean;
}

export const MessageView = memo(function MessageView({
  sessionId,
  message,
  afterAssistant,
  isStreaming,
  toolResults,
  toolCallDurations,
  cwd,
  onOpenFile,
  entryId,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
  prevTimestamp,
  onLoadDeferredContent,
  thinkingExpansionStore,
  compact,
  retried,
}: Props) {
  if (message.role === "user") {
    return (
      <UserMessageView
        message={message as UserMessage}
        sessionId={sessionId}
        afterAssistant={afterAssistant}
        cwd={cwd}
        onOpenFile={onOpenFile}
        onNavigate={onNavigate}
        prevAssistantEntryId={prevAssistantEntryId}
        onEditContent={onEditContent}
        onLoadDeferredContent={onLoadDeferredContent}
      />
    );
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessageView
        message={message as AssistantMessage}
        isStreaming={isStreaming}
        toolResults={toolResults}
        toolCallDurations={toolCallDurations}
        cwd={cwd}
        onOpenFile={onOpenFile}
        prevTimestamp={prevTimestamp}
        onLoadDeferredContent={onLoadDeferredContent}
        entryId={entryId}
        thinkingExpansionStore={thinkingExpansionStore}
        compact={compact}
        retried={retried}
      />
    );
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    if ((message as CustomMessage).customType === "compaction") {
      return (
        <>
          <CompactionMessageView message={message as CustomMessage} />
          <DeferredContentActions content={message.content} onLoad={onLoadDeferredContent} />
        </>
      );
    }
    return (
      <CustomMessageView
        message={message as CustomMessage}
        cwd={cwd}
        onOpenFile={onOpenFile}
        onLoadDeferredContent={onLoadDeferredContent}
      />
    );
  }
  return null;
});
