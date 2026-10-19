import { type MessageRenderRole } from "@/lib/message-render-key";
import { buildProcessFlowItems, computeTurnDurationSeconds, type ProcessFlowSource } from "@/lib/process-flow";
import type { AgentMessage, AssistantMessage, CustomMessage } from "@/lib/types";
import { type ReactNode } from "react";
import { MessageView } from "../MessageView";
import { ProcessDetailsGroup } from "../ProcessDetailsGroup";
import { ProcessFlow } from "../ProcessFlow";
import { SessionProfiler } from "../SessionProfiler";
import {
  findFinalAssistantIndex,
  findRetriedFailureIndices,
  failureOnlyMessage,
  getAssistantRenderParts,
  segmentTurnAtFailures,
} from "./shared";
import type { ChatWindowState } from "./use-chat-window";
export function ChatMessages({
  messages,
  messageRefs,
  lastUserMsgRef,
  entryIds,
  messageRenderKeys,
  toolMessageIndex,
  agentRunning,
  streamState,
  session,
  modelNames,
  messageCwd,
  onOpenFile,
  isNew,
  handleFork,
  forkingEntryId,
  handleNavigate,
  insertEditedContent,
  loadDeferredContent,
  thinkingExpansionStore,
  assistantRenderParts,
  processDetailsExpansionStore,
}: Pick<
  ChatWindowState,
  | "messages"
  | "messageRefs"
  | "lastUserMsgRef"
  | "entryIds"
  | "messageRenderKeys"
  | "toolMessageIndex"
  | "agentRunning"
  | "streamState"
  | "session"
  | "modelNames"
  | "messageCwd"
  | "onOpenFile"
  | "isNew"
  | "handleFork"
  | "forkingEntryId"
  | "handleNavigate"
  | "insertEditedContent"
  | "loadDeferredContent"
  | "thinkingExpansionStore"
  | "assistantRenderParts"
  | "processDetailsExpansionStore"
>) {
  return (() => {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }

    const timestampAssistantIndices = new Set<number>();
    let foundAssistantInTurn = false;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        foundAssistantInTurn = false;
      } else if (messages[i].role === "assistant" && !foundAssistantInTurn) {
        timestampAssistantIndices.add(i);
        foundAssistantInTurn = true;
      }
    }

    const retriedFailureIndices = findRetriedFailureIndices(messages);

    const visibleRefIndexByMessage = new Map<number, number>();
    let refIdx = 0;
    messages.forEach((msg, idx) => {
      if (msg.role === "user" || msg.role === "assistant") {
        visibleRefIndexByMessage.set(idx, refIdx++);
      }
    });

    const attachVisibleRef = (idx: number, refIndex: number) => (el: HTMLDivElement | null) => {
      messageRefs.current[refIndex] = el;
      if (idx === lastUserIdx) {
        (lastUserMsgRef as { current: HTMLDivElement | null }).current = el;
      }
    };

    const renderMessage = (
      idx: number,
      options: {
        attachRef?: boolean;
        renderRole?: MessageRenderRole;
        messageOverride?: AgentMessage;
        showTimestamp?: boolean;
      } = {},
    ): ReactNode => {
      const msg = options.messageOverride ?? messages[idx];
      const prevIsAssistant = msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant";
      const prevAssistantEntryId = prevIsAssistant ? entryIds[idx - 1] : undefined;
      const isVisible = msg.role === "user" || msg.role === "assistant";
      const currentRefIdx = visibleRefIndexByMessage.get(idx);
      const renderRole = options.renderRole ?? "message";
      const renderKey = messageRenderKeys.keyFor(messages[idx], entryIds[idx], renderRole);
      const toolData = toolMessageIndex.get(messages[idx]);
      // The in-flight turn renders as a process stream: 8px rhythm,
      // no per-message footer — it settles into groups on completion.
      const compact = (agentRunning || streamState.isStreaming) && lastUserIdx !== -1 && idx > lastUserIdx;
      let showTimestamp = false;
      if (msg.role === "assistant") {
        showTimestamp = timestampAssistantIndices.has(idx);
        // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
        if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
          showTimestamp = false;
        }
      }
      if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
      const view = (
        <SessionProfiler key={renderKey} id="MessageView">
          <MessageView
            sessionId={session?.id}
            message={msg}
            toolResults={toolData?.results}
            toolCallDurations={toolData?.durations}
            modelNames={modelNames}
            cwd={messageCwd}
            onOpenFile={onOpenFile}
            entryId={entryIds[idx]}
            onFork={agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
            forking={forkingEntryId === entryIds[idx]}
            onNavigate={agentRunning ? undefined : handleNavigate}
            prevAssistantEntryId={agentRunning ? undefined : prevAssistantEntryId}
            onEditContent={insertEditedContent}
            onLoadDeferredContent={loadDeferredContent}
            afterAssistant={prevIsAssistant}
            showTimestamp={showTimestamp}
            prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
            thinkingExpansionStore={thinkingExpansionStore}
            compact={compact}
            retried={retriedFailureIndices.has(idx)}
          />
        </SessionProfiler>
      );
      if (!isVisible || options.attachRef === false || currentRefIdx === undefined) return view;
      return (
        <div key={renderKey} ref={attachVisibleRef(idx, currentRefIdx)}>
          {view}
        </div>
      );
    };

    const rendered: ReactNode[] = [];
    for (let idx = 0; idx < messages.length;) {
      const msg = messages[idx];
      if (msg.role !== "user") {
        rendered.push(renderMessage(idx));
        idx += 1;
        continue;
      }

      const userIdx = idx;
      let endIdx = userIdx + 1;
      while (endIdx < messages.length && messages[endIdx].role !== "user") endIdx += 1;

      const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

      if (finalAssistantIdx === -1) {
        for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
          rendered.push(renderMessage(renderIdx));
        }
        idx = endIdx;
        continue;
      }

      const isLiveTail =
        (agentRunning || streamState.isStreaming) && endIdx === messages.length && userIdx === lastUserIdx;
      if (isLiveTail) {
        for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
          rendered.push(renderMessage(renderIdx));
        }
        idx = endIdx;
        continue;
      }

      rendered.push(renderMessage(userIdx));

      const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
      const finalParts = getAssistantRenderParts(assistantRenderParts, finalAssistant);
      const finalAnswerMessage = finalParts.answerMessage;
      const segments = segmentTurnAtFailures(messages, userIdx, finalAssistantIdx);
      const turnDurationSeconds = computeTurnDurationSeconds(
        (messages[userIdx] as AgentMessage & { timestamp?: number }).timestamp,
        (finalAssistant as AgentMessage & { timestamp?: number }).timestamp,
      );
      const finalKey = messageRenderKeys.keyFor(messages[finalAssistantIdx], entryIds[finalAssistantIdx], "final");
      const userKey = messageRenderKeys.keyFor(messages[userIdx], entryIds[userIdx], "message");

      segments.forEach((segment, segmentIdx) => {
        if (segment.kind === "failure") {
          rendered.push(
            renderMessage(segment.index, {
              messageOverride: failureOnlyMessage(messages[segment.index] as AssistantMessage),
            }),
          );
          return;
        }
        const isLastSegment = segmentIdx === segments.length - 1;
        const processSources: ProcessFlowSource[] = segment.indices.map((processIdx) => ({
          message: messages[processIdx] as AssistantMessage | CustomMessage,
          entryId: entryIds[processIdx],
          prevTimestamp:
            processIdx > 0 ? (messages[processIdx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined,
          toolData: toolMessageIndex.get(messages[processIdx]),
        }));
        if (isLastSegment && finalParts.processMessage) {
          processSources.push({
            message: finalAssistant,
            blocks: finalParts.processBlocks,
            entryId: entryIds[finalAssistantIdx],
            prevTimestamp:
              finalAssistantIdx > 0
                ? (messages[finalAssistantIdx - 1] as AgentMessage & { timestamp?: number }).timestamp
                : undefined,
            toolData: toolMessageIndex.get(finalAssistant),
          });
        }
        const processFlow = buildProcessFlowItems(processSources, (message, entryId) =>
          messageRenderKeys.keyFor(message, entryId, "process"),
        );
        if (processFlow.messageCount === 0) return;

        const processGroupKey = `process-group:${userKey}:${finalKey}${segmentIdx === 0 ? "" : `:${segmentIdx}`}`;
        const processRefIdx =
          segment.indices
            .map((processIdx) => visibleRefIndexByMessage.get(processIdx))
            .find((value): value is number => typeof value === "number") ??
          (isLastSegment && !finalAnswerMessage ? visibleRefIndexByMessage.get(finalAssistantIdx) : undefined);
        rendered.push(
          <div
            key={processGroupKey}
            ref={
              processRefIdx === undefined
                ? undefined
                : (el) => {
                    messageRefs.current[processRefIdx] = el;
                  }
            }
          >
            <ProcessDetailsGroup
              stateKey={processGroupKey}
              expansionStore={processDetailsExpansionStore}
              messageCount={processFlow.messageCount}
              toolCallCount={processFlow.toolCallCount}
              durationSeconds={segments.length === 1 ? turnDurationSeconds : undefined}
            >
              <ProcessFlow
                items={processFlow.items}
                cwd={messageCwd}
                onOpenFile={onOpenFile}
                onLoadDeferredContent={loadDeferredContent}
                thinkingExpansionStore={thinkingExpansionStore}
              />
            </ProcessDetailsGroup>
          </div>,
        );
      });

      if (finalAnswerMessage) {
        rendered.push(
          renderMessage(finalAssistantIdx, {
            renderRole: "final",
            messageOverride: finalAnswerMessage,
          }),
        );
      }
      for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
        rendered.push(renderMessage(renderIdx));
      }
      idx = endIdx;
    }
    return rendered;
  })();
}
