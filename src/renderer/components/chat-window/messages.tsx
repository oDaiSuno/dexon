import { type MessageRenderRole } from "@/lib/message-render-key";
import type { AgentMessage } from "@/lib/types";
import { type ReactNode } from "react";
import { MessageView } from "../MessageView";
import { ProcessDetailsGroup } from "../ProcessDetailsGroup";
import { ProcessFlow } from "../ProcessFlow";
import { SessionProfiler } from "../SessionProfiler";
import { findRetriedFailureIndices } from "./shared";
import { type TurnAnswerPiece, type TurnFailurePiece, type TurnProcessPiece, buildTurnLayout } from "./turn-layout";
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
  assistantBlockCache,
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
  | "assistantBlockCache"
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

    const refForPiece = (refIndex: number | undefined) =>
      refIndex === undefined
        ? undefined
        : (el: HTMLDivElement | null) => {
            messageRefs.current[refIndex] = el;
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
        <div
          key={renderKey}
          className={compact ? undefined : "chat-history-item"}
          ref={attachVisibleRef(idx, currentRefIdx)}
        >
          {view}
        </div>
      );
    };

    const renderAnswer = (piece: TurnAnswerPiece, turnEndIdx: number): ReactNode => {
      const toolData = toolMessageIndex.get(messages[piece.index]);
      const forkEntryId = piece.hasFooter ? entryIds[turnEndIdx - 1] : undefined;
      return (
        <div key={piece.key} className="chat-history-item" ref={refForPiece(piece.refIndex)}>
          <SessionProfiler id="MessageView">
            <MessageView
              sessionId={session?.id}
              message={piece.hasFooter ? piece.footerBody : piece.body}
              toolResults={toolData?.results}
              toolCallDurations={toolData?.durations}
              modelNames={modelNames}
              cwd={messageCwd}
              onOpenFile={onOpenFile}
              entryId={piece.entryId}
              forkEntryId={forkEntryId}
              onFork={agentRunning || isNew ? undefined : handleFork}
              forking={forkEntryId !== undefined && forkingEntryId === forkEntryId}
              onLoadDeferredContent={loadDeferredContent}
              showTimestamp={piece.hasFooter}
              prevTimestamp={piece.prevTimestamp}
              thinkingExpansionStore={thinkingExpansionStore}
            />
          </SessionProfiler>
        </div>
      );
    };

    const renderProcess = (piece: TurnProcessPiece): ReactNode => (
      <div key={piece.key} className="chat-history-item" ref={refForPiece(piece.refIndex)}>
        <ProcessDetailsGroup
          stateKey={piece.key}
          expansionStore={processDetailsExpansionStore}
          messageCount={piece.flow.messageCount}
          toolCallCount={piece.flow.toolCallCount}
          durationSeconds={piece.durationSeconds}
        >
          <ProcessFlow
            items={piece.flow.items}
            cwd={messageCwd}
            onOpenFile={onOpenFile}
            onLoadDeferredContent={loadDeferredContent}
            thinkingExpansionStore={thinkingExpansionStore}
          />
        </ProcessDetailsGroup>
      </div>
    );

    const renderFailure = (piece: TurnFailurePiece): ReactNode => (
      <div key={piece.key} className="chat-history-item" ref={refForPiece(piece.refIndex)}>
        <SessionProfiler id="MessageView">
          <MessageView
            sessionId={session?.id}
            message={piece.message}
            modelNames={modelNames}
            cwd={messageCwd}
            onOpenFile={onOpenFile}
            entryId={entryIds[piece.index]}
            onLoadDeferredContent={loadDeferredContent}
            thinkingExpansionStore={thinkingExpansionStore}
            retried={piece.retried}
          />
        </SessionProfiler>
      </div>
    );

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

      const isLiveTail =
        (agentRunning || streamState.isStreaming) && endIdx === messages.length && userIdx === lastUserIdx;
      const layout = isLiveTail
        ? null
        : buildTurnLayout({
            messages,
            userIdx,
            endIdx,
            entryIds,
            toolData: toolMessageIndex,
            refIndexFor: (messageIndex) => visibleRefIndexByMessage.get(messageIndex),
            keyFor: (message, entryId, role) => messageRenderKeys.keyFor(message, entryId, role),
            retriedIndices: retriedFailureIndices,
            cache: assistantBlockCache,
          });

      rendered.push(renderMessage(userIdx));
      if (!layout || layout.lastAssistantIndex === -1) {
        for (let renderIdx = userIdx + 1; renderIdx < endIdx; renderIdx++) {
          rendered.push(renderMessage(renderIdx));
        }
        idx = endIdx;
        continue;
      }

      for (const piece of layout.pieces) {
        if (piece.kind === "answer") rendered.push(renderAnswer(piece, endIdx));
        else if (piece.kind === "process") rendered.push(renderProcess(piece));
        else rendered.push(renderFailure(piece));
      }
      for (let renderIdx = layout.lastAssistantIndex + 1; renderIdx < endIdx; renderIdx++) {
        rendered.push(renderMessage(renderIdx));
      }
      idx = endIdx;
    }
    return rendered;
  })();
}
