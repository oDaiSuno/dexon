import { type MessageRenderRole } from "@/lib/message-render-key";
import { readingAnchorAttributes } from "@/lib/reading-anchor";
import type { AgentMessage, AssistantMessage } from "@/lib/types";
import { type ReactNode } from "react";
import { MessageView } from "../MessageView";
import { ProcessDetailsGroup } from "../ProcessDetailsGroup";
import { ProcessFlow } from "../ProcessFlow";
import { SessionProfiler } from "../SessionProfiler";
import { AnswerTurn } from "./answer-turn";
import { classifyTurnFailures } from "./shared";
import {
  type TurnAnswerPiece,
  type TurnFailurePiece,
  type TurnPiece,
  type TurnProcessPiece,
  buildTurnLayout,
} from "./turn-layout";
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
  editDraft,
  editHandlers,
  handleSwitchVersion,
  loadDeferredContent,
  thinkingExpansionStore,
  assistantBlockCache,
  processDetailsExpansionStore,
  disengageAutoFollow,
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
  | "editDraft"
  | "editHandlers"
  | "handleSwitchVersion"
  | "loadDeferredContent"
  | "thinkingExpansionStore"
  | "assistantBlockCache"
  | "processDetailsExpansionStore"
  | "disengageAutoFollow"
>) {
  return (() => {
    const streaming = streamState.streamingMessage;
    const streamingMessage = streaming?.role === "assistant" ? (streaming as AssistantMessage) : undefined;
    const replyInProgress = agentRunning || streamState.isStreaming;
    const shownMessages: AgentMessage[] = streamingMessage ? [...messages, streamingMessage] : messages;
    const shownEntryIds: string[] = streamingMessage ? [...entryIds, streamState.streamingEntryId ?? ""] : entryIds;

    let lastUserIdx = -1;
    for (let i = shownMessages.length - 1; i >= 0; i--) {
      if (shownMessages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }

    const { retried: retriedFailureIndices, resolved: resolvedFailureIndices } = classifyTurnFailures(messages);

    const visibleRefIndexByMessage = new Map<number, number>();
    let refIdx = 0;
    shownMessages.forEach((msg, idx) => {
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
      } = {},
    ): ReactNode => {
      const msg = options.messageOverride ?? shownMessages[idx];
      const prevIsAssistant = msg.role === "user" && idx > 0 && shownMessages[idx - 1].role === "assistant";
      const isVisible = msg.role === "user" || msg.role === "assistant";
      const currentRefIdx = visibleRefIndexByMessage.get(idx);
      const renderRole = options.renderRole ?? "message";
      const renderKey = messageRenderKeys.keyFor(shownMessages[idx], entryIds[idx], renderRole);
      const screenKey = messageRenderKeys.screenKey(renderKey);
      const toolData = toolMessageIndex.get(shownMessages[idx]);
      const view = (
        <SessionProfiler key={screenKey} id="MessageView">
          <MessageView
            sessionId={session?.id}
            message={msg}
            toolResults={toolData?.results}
            toolCallDurations={toolData?.durations}
            cwd={messageCwd}
            onOpenFile={onOpenFile}
            entryId={entryIds[idx]}
            editDraft={editDraft}
            editHandlers={editHandlers}
            onSwitchVersion={handleSwitchVersion}
            agentRunning={agentRunning}
            onLoadDeferredContent={loadDeferredContent}
            afterAssistant={prevIsAssistant}
            prevTimestamp={
              idx > 0 ? (shownMessages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined
            }
            thinkingExpansionStore={thinkingExpansionStore}
            retried={retriedFailureIndices.has(idx)}
          />
        </SessionProfiler>
      );
      if (!isVisible || options.attachRef === false || currentRefIdx === undefined) return view;
      return (
        <div
          key={screenKey}
          className="chat-history-item"
          ref={attachVisibleRef(idx, currentRefIdx)}
          {...readingAnchorAttributes(renderKey)}
        >
          {view}
        </div>
      );
    };

    const renderAnswer = (piece: TurnAnswerPiece, writing: boolean): ReactNode => {
      const toolData = toolMessageIndex.get(shownMessages[piece.index]);
      return (
        <div
          key={messageRenderKeys.screenKey(piece.key)}
          className="chat-history-item"
          ref={refForPiece(piece.refIndex)}
          {...readingAnchorAttributes(piece.anchor)}
        >
          <SessionProfiler id="MessageView">
            <MessageView
              sessionId={session?.id}
              message={piece.body}
              isStreaming={writing}
              toolResults={toolData?.results}
              toolCallDurations={toolData?.durations}
              cwd={messageCwd}
              onOpenFile={onOpenFile}
              entryId={piece.entryId}
              onLoadDeferredContent={loadDeferredContent}
              prevTimestamp={piece.prevTimestamp}
              thinkingExpansionStore={thinkingExpansionStore}
            />
          </SessionProfiler>
        </div>
      );
    };

    const renderProcess = (piece: TurnProcessPiece, inProgress: boolean): ReactNode => (
      <div
        key={messageRenderKeys.screenKey(piece.key)}
        className="chat-history-item"
        ref={refForPiece(piece.refIndex)}
        {...readingAnchorAttributes(piece.anchor)}
      >
        <ProcessDetailsGroup
          stateKey={piece.key}
          expansionStore={processDetailsExpansionStore}
          messageCount={piece.flow.messageCount}
          toolCallCount={piece.flow.toolCallCount}
          createdSessionCount={piece.flow.createdSessionCount}
          durationSeconds={piece.durationSeconds}
          liveStartedAt={piece.liveStartedAt}
          onReaderAction={inProgress ? disengageAutoFollow : undefined}
        >
          <ProcessFlow
            items={piece.flow.items}
            cwd={messageCwd}
            onOpenFile={onOpenFile}
            onLoadDeferredContent={loadDeferredContent}
            thinkingExpansionStore={thinkingExpansionStore}
            speedHint={piece.liveStartedAt === undefined ? undefined : streamingMessage}
          />
        </ProcessDetailsGroup>
      </div>
    );

    const renderFailure = (piece: TurnFailurePiece): ReactNode => (
      <div
        key={messageRenderKeys.screenKey(piece.key)}
        className="chat-history-item"
        ref={refForPiece(piece.refIndex)}
        {...readingAnchorAttributes(piece.anchor)}
      >
        <SessionProfiler id="MessageView">
          <MessageView
            sessionId={session?.id}
            message={piece.message}
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

    const renderPiece = (piece: TurnPiece, inProgress: boolean, writing: boolean): ReactNode => {
      if (piece.kind === "answer") return renderAnswer(piece, writing);
      if (piece.kind === "process") return renderProcess(piece, inProgress);
      return renderFailure(piece);
    };

    const rendered: ReactNode[] = [];
    for (let idx = 0; idx < shownMessages.length;) {
      const userIdx = shownMessages[idx].role === "user" ? idx : -1;
      let endIdx = userIdx + 1;
      while (endIdx < shownMessages.length && shownMessages[endIdx].role !== "user") endIdx += 1;

      const isLiveTurn =
        replyInProgress && endIdx === shownMessages.length && userIdx !== -1 && userIdx === lastUserIdx;
      const layout = buildTurnLayout({
        messages: shownMessages,
        userIdx,
        endIdx,
        entryIds: shownEntryIds,
        toolData: toolMessageIndex,
        refIndexFor: (messageIndex) => (isLiveTurn ? undefined : visibleRefIndexByMessage.get(messageIndex)),
        keyFor: (message, entryId, role) => messageRenderKeys.keyFor(message, entryId, role),
        retriedIndices: retriedFailureIndices,
        resolvedIndices: resolvedFailureIndices,
        cache: assistantBlockCache,
        live: isLiveTurn,
        streamingMessage: isLiveTurn ? streamingMessage : undefined,
      });

      if (userIdx !== -1) rendered.push(renderMessage(userIdx));
      if (layout.lastAssistantIndex === -1) {
        for (let renderIdx = userIdx + 1; renderIdx < endIdx; renderIdx++) {
          rendered.push(renderMessage(renderIdx));
        }
        idx = endIdx;
        continue;
      }

      rendered.push(
        <AnswerTurn
          key={messageRenderKeys.screenKey(messageRenderKeys.keyFor(messages[idx], entryIds[idx], "turn"))}
          footer={isLiveTurn ? null : layout.footer}
          modelNames={modelNames}
          onFork={agentRunning || isNew ? undefined : handleFork}
          forking={layout.footer?.forkEntryId !== undefined && forkingEntryId === layout.footer.forkEntryId}
        >
          {layout.pieces.map((piece, index) =>
            renderPiece(piece, replyInProgress, isLiveTurn && index === layout.pieces.length - 1),
          )}
        </AnswerTurn>,
      );
      for (let renderIdx = layout.lastAssistantIndex + 1; renderIdx < endIdx; renderIdx++) {
        rendered.push(renderMessage(renderIdx));
      }
      idx = endIdx;
    }
    return rendered;
  })();
}
