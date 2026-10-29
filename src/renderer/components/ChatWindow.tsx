import type { AgentMessage } from "@/lib/types";
import { DragOverlay } from "./chat-window/drag-overlay";
import { ChatMessages } from "./chat-window/messages";
import { OlderHistoryZone } from "./chat-window/older-history-zone";
import { ScrollToBottomButton } from "./chat-window/scroll-to-bottom";
import { CHAT_COLUMN_PADDING, Props, phaseLabel } from "./chat-window/shared";
import { ExtensionStatusBar, ExtensionWidgets, NoticeShelf } from "./chat-window/status";
import { TurnNavigator } from "./chat-window/turn-navigator";
import { useChatWindow } from "./chat-window/use-chat-window";
import { Welcome } from "./chat-window/welcome";
import { ToolCardDock } from "./interactive-tools/tool-card-dock";
import { MessageView } from "./MessageView";
import { RetryCountdownLine } from "./messages/FailureLine";
import { SessionProfiler } from "./SessionProfiler";
import { useLayoutEffect } from "react";

const detachedSentinel = () => {};

const floatingLayerStyle = {
  position: "absolute",
  top: 12,
  left: 0,
  right: 0,
  zIndex: 40,
  padding: `0 ${CHAT_COLUMN_PADDING}px`,
  pointerEvents: "none",
} as const;

export function ChatWindow(props: Props) {
  const visible = props.visible ?? true;
  useLayoutEffect(() => {
    if (visible) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest("[data-chat-surface]")) active.blur();
  }, [visible]);
  const {
    loading,
    error,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isDragOver,
    isEmptyNew,
    t,
    notices,
    dismissNotice,
    isMobile,
    scrollContainerRef,
    hasOlder,
    loadingOlder,
    olderHistorySentinelRef,
    loadOlderHistory,
    olderHistoryFailed,
    interactiveTools,
    extensionStatuses,
    aboveEditorWidgets,
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
    agentPhase,
    retryInfo,
    liveContentEndRef,
    chatViewportHeight,
    messagesEndRef,
    navigatorTurns,
    turnJump,
    isAwayFromBottom,
    reattachAutoFollow,
    belowEditorWidgets,
    chatInputElement,
  } = useChatWindow(props);
  const jumpPending = turnJump.jumpTarget !== null;

  if (loading) {
    return (
      <div hidden={!visible} aria-hidden={!visible} inert={!visible ? true : undefined}>
        <div className="flex h-full items-center justify-center" style={{ color: "var(--fx-text-secondary)" }}>
          Loading session...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div hidden={!visible} aria-hidden={!visible} inert={!visible ? true : undefined}>
        <div className="flex h-full items-center justify-center" style={{ color: "var(--fx-status-danger-text)" }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div
      data-chat-surface
      role="region"
      aria-label={t("chatWindow", "Chat")}
      hidden={!visible}
      aria-hidden={!visible}
      inert={!visible ? true : undefined}
      className="chat-appearance-scope relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <DragOverlay isDragOver={isDragOver} />

      {isEmptyNew ? (
        <Welcome notices={notices} onDismissNotice={dismissNotice} />
      ) : (
        <>
          <div className="chat-conversation-enter relative z-[1] flex min-h-0 flex-[1_1_0] overflow-hidden">
            <div style={floatingLayerStyle}>
              <div className="chat-content-column">
                <NoticeShelf notices={notices} onDismiss={dismissNotice} floating align="right" />
              </div>
            </div>
            {jumpPending ? (
              <div style={floatingLayerStyle}>
                <div className="chat-content-column">
                  <div
                    style={{
                      width: "fit-content",
                      margin: "0 auto",
                      pointerEvents: "auto",
                      borderRadius: "var(--radius-card)",
                      background: "var(--fx-surface-raised)",
                      boxShadow: "var(--shadow-popover)",
                    }}
                  >
                    <OlderHistoryZone
                      sentinelRef={detachedSentinel}
                      hasOlder={hasOlder}
                      loadingOlder={loadingOlder || (jumpPending && !olderHistoryFailed)}
                      failed={olderHistoryFailed}
                      onLoad={loadOlderHistory}
                    />
                  </div>
                </div>
              </div>
            ) : null}
            <div
              ref={scrollContainerRef}
              role="region"
              aria-label={t("chatConversation", "Conversation")}
              className="relative z-[1] flex-1 overflow-y-auto pt-4 [scrollbar-gutter:stable_both-edges]"
            >
              <div
                style={{
                  paddingLeft: CHAT_COLUMN_PADDING,
                  paddingRight: CHAT_COLUMN_PADDING,
                }}
              >
                <div role="group" aria-label={t("messages", "Messages")} className="chat-content-column">
                  {jumpPending ? null : (
                    <OlderHistoryZone
                      sentinelRef={olderHistorySentinelRef}
                      hasOlder={hasOlder}
                      loadingOlder={loadingOlder}
                      failed={olderHistoryFailed}
                      onLoad={loadOlderHistory}
                    />
                  )}
                  <ExtensionStatusBar statuses={extensionStatuses} />
                  <ExtensionWidgets widgets={aboveEditorWidgets} />

                  <ChatMessages
                    messages={messages}
                    messageRefs={messageRefs}
                    lastUserMsgRef={lastUserMsgRef}
                    entryIds={entryIds}
                    messageRenderKeys={messageRenderKeys}
                    toolMessageIndex={toolMessageIndex}
                    agentRunning={agentRunning}
                    streamState={streamState}
                    session={session}
                    modelNames={modelNames}
                    messageCwd={messageCwd}
                    onOpenFile={onOpenFile}
                    isNew={isNew}
                    handleFork={handleFork}
                    forkingEntryId={forkingEntryId}
                    editDraft={editDraft}
                    editHandlers={editHandlers}
                    handleSwitchVersion={handleSwitchVersion}
                    loadDeferredContent={loadDeferredContent}
                    thinkingExpansionStore={thinkingExpansionStore}
                    assistantBlockCache={assistantBlockCache}
                    processDetailsExpansionStore={processDetailsExpansionStore}
                  />

                  {streamState.isStreaming && streamState.streamingMessage && (
                    <SessionProfiler id="MessageView">
                      <MessageView
                        sessionId={session?.id}
                        message={streamState.streamingMessage as AgentMessage}
                        isStreaming
                        cwd={messageCwd}
                        onOpenFile={onOpenFile}
                        entryId={streamState.streamingEntryId ?? undefined}
                        thinkingExpansionStore={thinkingExpansionStore}
                        compact
                      />
                    </SessionProfiler>
                  )}

                  {agentRunning && retryInfo?.waiting && (
                    <RetryCountdownLine
                      attempt={retryInfo.attempt}
                      maxAttempts={retryInfo.maxAttempts}
                      errorMessage={retryInfo.errorMessage}
                    />
                  )}

                  {agentRunning && !retryInfo?.waiting && !streamState.streamingMessage && (
                    <div className="py-2">
                      <span className="chat-shimmer-text type-body-medium">{phaseLabel(agentPhase, t)}</span>
                    </div>
                  )}

                  <div ref={liveContentEndRef} />

                  {agentRunning && <div data-run-spacer style={{ height: chatViewportHeight }} />}

                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>
            {isMobile ? null : (
              <SessionProfiler id="TurnNavigator">
                <TurnNavigator
                  turns={navigatorTurns}
                  scrollContainer={scrollContainerRef}
                  messageRefs={messageRefs}
                  visible={visible}
                  turnJump={turnJump}
                />
              </SessionProfiler>
            )}

            {isAwayFromBottom && (
              <ScrollToBottomButton
                label={t("scrollToBottom", "Scroll to bottom")}
                title={agentRunning ? t("jumpToLatest", "Jump to latest") : t("scrollToBottom", "Scroll to bottom")}
                onClick={() => {
                  if (visible) reattachAutoFollow();
                }}
              />
            )}
          </div>
        </>
      )}

      <div
        className="chat-input-transition-dock relative z-[2] w-full flex-shrink-0 self-center"
        data-position={isEmptyNew ? "welcome" : "conversation"}
      >
        {!isEmptyNew && belowEditorWidgets.length > 0 && (
          <div
            style={{
              padding: `0 ${CHAT_COLUMN_PADDING}px`,
              paddingRight: CHAT_COLUMN_PADDING,
            }}
          >
            <div className="chat-content-column">
              <ExtensionWidgets widgets={belowEditorWidgets} />
            </div>
          </div>
        )}
        <div
          style={{
            paddingLeft: CHAT_COLUMN_PADDING,
            paddingRight: CHAT_COLUMN_PADDING,
          }}
        >
          <div className="chat-content-column">
            <ToolCardDock store={interactiveTools} visible={visible} />
          </div>
        </div>
        {chatInputElement}
      </div>

      <div className="chat-input-bottom-spacer" data-expanded={isEmptyNew ? "true" : "false"} aria-hidden="true" />
    </div>
  );
}
