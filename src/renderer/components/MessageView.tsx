import { memo } from "react";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { UserMessageView } from "./messages/UserMessage";
import { AssistantMessageView } from "./messages/AssistantMessage";
import { CompactionMessageView, CustomMessageView } from "./messages/SystemMessages";
import { DeferredContentActions } from "./messages/shared";
import type { AgentMessage, AssistantMessage, CustomMessage, ToolResultMessage, UserMessage } from "@/lib/types";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: ReadonlyMap<string, ToolResultMessage>;
  toolCallDurations?: ReadonlyMap<string, number>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  onLoadDeferredContent?: (entryId: string, blockIndex?: number) => Promise<void>;
  thinkingExpansionStore?: ThinkingExpansionStore;
  compact?: boolean;
}

export const MessageView = memo(function MessageView({
  message,
  isStreaming,
  toolResults,
  toolCallDurations,
  modelNames,
  cwd,
  onOpenFile,
  entryId,
  onFork,
  forking,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
  showTimestamp,
  prevTimestamp,
  onLoadDeferredContent,
  thinkingExpansionStore,
  compact,
}: Props) {
  if (message.role === "user") {
    return (
      <UserMessageView
        message={message as UserMessage}
        cwd={cwd}
        onOpenFile={onOpenFile}
        entryId={entryId}
        onFork={onFork}
        forking={forking}
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
        modelNames={modelNames}
        cwd={cwd}
        onOpenFile={onOpenFile}
        showTimestamp={showTimestamp}
        prevTimestamp={prevTimestamp}
        onLoadDeferredContent={onLoadDeferredContent}
        entryId={entryId}
        thinkingExpansionStore={thinkingExpansionStore}
        compact={compact}
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
