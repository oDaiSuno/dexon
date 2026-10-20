import { scaledChatFont } from "@/lib/chat-appearance";
import type { AgentMessage } from "@/lib/types";
import { DragOverlay } from "./chat-window/drag-overlay";
import { ChatMessages } from "./chat-window/messages";
import { OlderHistoryZone } from "./chat-window/older-history-zone";
import {
  CHAT_COLUMN_PADDING,
  CHAT_INPUT_RIGHT_PADDING,
  CHAT_MINIMAP_WIDTH,
  Props,
  phaseLabel,
} from "./chat-window/shared";
import { ExtensionStatusBar, ExtensionWidgets, NoticeShelf } from "./chat-window/status";
import { useChatWindow } from "./chat-window/use-chat-window";
import { Welcome } from "./chat-window/welcome";
import { ChatMinimap } from "./ChatMinimap";
import { ToolCardDock } from "./interactive-tools/tool-card-dock";
import { MessageView } from "./MessageView";
import { RetryCountdownLine } from "./messages/FailureLine";
import { SessionProfiler } from "./SessionProfiler";
import { useLayoutEffect } from "react";
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
    handleNavigate,
    insertEditedContent,
    loadDeferredContent,
    thinkingExpansionStore,
    assistantBlockCache,
    processDetailsExpansionStore,
    agentPhase,
    retryInfo,
    handleAbort,
    liveContentEndRef,
    chatViewportHeight,
    messagesEndRef,
    minimapMessages,
    minimapStreamingMessage,
    isAwayFromBottom,
    reattachAutoFollow,
    belowEditorWidgets,
    chatInputElement,
  } = useChatWindow(props);

  if (loading) {
    return (
      <div hidden={!visible} aria-hidden={!visible} inert={!visible ? true : undefined}>
        <div className="flex h-full items-center justify-center text-text-muted">Loading session...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div hidden={!visible} aria-hidden={!visible} inert={!visible ? true : undefined}>
        <div className="flex h-full items-center justify-center text-red-400">{error}</div>
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
        <Welcome notices={notices} />
      ) : (
        <>
          <div className="chat-conversation-enter relative z-[1] flex min-h-0 flex-[1_1_0] overflow-hidden">
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 0,
                right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
                zIndex: 40,
                padding: `0 ${CHAT_COLUMN_PADDING}px`,
                pointerEvents: "none",
              }}
            >
              <div className="chat-content-column">
                <NoticeShelf notices={notices} floating align="right" />
              </div>
            </div>
            <div
              ref={scrollContainerRef}
              role="region"
              aria-label={t("chatConversation", "Conversation")}
              className="relative z-[1] flex-1 overflow-y-auto pt-4 [scrollbar-width:none]"
            >
              <div
                style={{
                  paddingLeft: CHAT_COLUMN_PADDING,
                  paddingRight: CHAT_COLUMN_PADDING,
                }}
              >
                <div role="group" aria-label={t("messages", "Messages")} className="chat-content-column">
                  <OlderHistoryZone
                    sentinelRef={olderHistorySentinelRef}
                    hasOlder={hasOlder}
                    loadingOlder={loadingOlder}
                    failed={olderHistoryFailed}
                    onLoad={loadOlderHistory}
                  />
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
                    handleNavigate={handleNavigate}
                    insertEditedContent={insertEditedContent}
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
                        modelNames={modelNames}
                        cwd={messageCwd}
                        onOpenFile={onOpenFile}
                        entryId="streaming"
                        thinkingExpansionStore={thinkingExpansionStore}
                        compact
                      />
                    </SessionProfiler>
                  )}

                  {agentRunning && retryInfo?.waiting && (
                    <RetryCountdownLine retryAt={retryInfo.retryAt} onCancel={handleAbort} />
                  )}

                  {agentRunning && !retryInfo?.waiting && !streamState.streamingMessage && (
                    <div className="py-2" style={{ fontSize: scaledChatFont(13) }}>
                      <span className="chat-shimmer-text" style={{ fontWeight: 500 }}>
                        {phaseLabel(agentPhase, t)}
                      </span>
                    </div>
                  )}

                  <div ref={liveContentEndRef} />

                  {agentRunning && <div data-run-spacer style={{ height: chatViewportHeight }} />}

                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>
            {isMobile ? null : (
              <SessionProfiler id="ChatMinimap">
                <ChatMinimap
                  messages={minimapMessages}
                  streamingMessage={minimapStreamingMessage}
                  scrollContainer={scrollContainerRef}
                  messageRefs={messageRefs}
                  historyTruncated={hasOlder}
                  visible={visible}
                />
              </SessionProfiler>
            )}

            {/* Floating "scroll to bottom" badge: appears when the chat has
                scrolled away from the newest content. Clicking it snaps to the
                bottom and re-magnets the viewport so streaming thinking/tool
                output keeps the view attached until the user scrolls away. */}
            {isAwayFromBottom && (
              <button
                type="button"
                className="chat-scroll-to-bottom"
                onClick={() => {
                  if (visible) reattachAutoFollow();
                }}
                aria-label={t("scrollToBottom", "Scroll to bottom")}
                title={agentRunning ? t("jumpToLatest", "Jump to latest") : t("scrollToBottom", "Scroll to bottom")}
                style={{
                  bottom: 12,
                  right: isMobile ? 12 : CHAT_MINIMAP_WIDTH + 12,
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="3.5 6 8 10.5 12.5 6" />
                </svg>
                {agentRunning && (
                  <span
                    aria-hidden="true"
                    className="chat-scroll-to-bottom-live-dot"
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--accent)",
                    }}
                  />
                )}
              </button>
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
              paddingRight: isMobile ? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING,
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
            paddingRight: isMobile ? CHAT_COLUMN_PADDING : CHAT_INPUT_RIGHT_PADDING,
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
