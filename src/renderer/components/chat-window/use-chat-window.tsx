import { useAgentSession } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useObservedElementHeight } from "@/hooks/useObservedElementHeight";
import { useI18n } from "@/i18n";
import { getActiveEnvironmentId } from "@/lib/environment-registry";
import { newSessionDraftKey } from "@/lib/unsaved-messages";
import { modelSupportsImages } from "@/lib/model-selection";
import { MessageRenderKeyRegistry } from "@/lib/message-render-key";
import { buildToolMessageIndex } from "@/lib/tool-message-index";
import { useCallback, useMemo, useRef, useState } from "react";
import { ChatInput } from "../ChatInput";
import { recallablePrompts } from "../chat-input/prompt-history";
import { useMessageEdit } from "../messages/user-message-editor";
import { Props, toNavigatorTurns } from "./shared";
import { AssistantBlockCache } from "./turn-layout";
import { useOlderHistory } from "./use-older-history";
import { useQuoteJump } from "./use-quote-jump";
import { useSessionReporting } from "./use-session-reporting";
import { useSelectionQuote } from "./use-selection-quote";
import { useReadingPosition } from "./use-reading-position";

export function useChatWindow({
  environmentId: explicitEnvironmentId,
  session,
  sessionFolderMissing: knownMissingFolder,
  missingFolderRecovery,
  newSessionCwd,
  onAgentEnd,
  onSessionCreated,
  onSessionForked,
  modelsRefreshKey,
  chatInputRef,
  onBranchDataChange,
  onSystemPromptChange,
  onSessionStatsChange,
  onSessionStatsPanelOpen,
  onContextUsageChange,
  onCompactionChange,
  onModelIdChange,
  onOpenFile,
  thinkingExpansionStore,
  processDetailsExpansionStore,
  readingPositions,
  visible = true,
  channelSnapshot,
  onChannelSnapshotChange,
  navigation,
  workspace,
}: Props) {
  const localChatInputRef = useRef<React.ComponentRef<typeof ChatInput>>(null);
  chatInputRef ??= localChatInputRef;
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } = useAudio();
  const isMobile = useIsMobile(visible);
  const { t } = useI18n();
  const [mountCapturedEnvironmentId] = useState(getActiveEnvironmentId);
  const environmentId = session?.environmentId ?? explicitEnvironmentId ?? mountCapturedEnvironmentId;
  const messageRenderKeys = useRef(new MessageRenderKeyRegistry()).current;
  const assistantBlockCache = useRef(new AssistantBlockCache()).current;
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [restoreReadingPosition] = useState(() => Boolean(session && readingPositions?.get(session.id)));

  const expansionStores = useMemo(
    () => [thinkingExpansionStore, processDetailsExpansionStore],
    [thinkingExpansionStore, processDetailsExpansionStore],
  );
  const playDoneSoundRef = useRef(playDoneSound);

  playDoneSoundRef.current = playDoneSound;

  const soundEnabledRef = useRef(soundEnabled);

  soundEnabledRef.current = soundEnabled;

  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [onAgentEnd]);

  const {
    loading,
    error,
    sessionLoadReconnecting,
    sessionFolderMissing,
    messages,
    entryIds,
    streamState,
    liveToolUpdates,
    agentRunning,
    modelNames,
    modelList,
    modelCatalog,
    modelCatalogScope,
    modelLoading,
    modelReconnecting,
    modelLoadError,
    modelRefreshing,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    thinkingLevel,
    retryInfo,
    contextUsage,
    forkingEntryId,
    isCompacting,
    compactError,
    compactResult,
    displayModel: displayModelValue,
    sessionStats,
    slashCommands,
    slashCommandsLoading,
    queuedMessages,
    hasOlder,
    previousCursor,
    loadingOlder,
    olderOutline,
    notices,
    interactiveTools,
    extensionStatuses,
    extensionWidgets,
    isAutoModelSelection,
    agentPhase,
    isNew,
    messagesEndRef,
    liveContentEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    handleSend,
    handleAbort,
    handleFork,
    handleEditMessage,
    handleSwitchVersion,
    handleModelChange,
    refreshModels,
    cancelModelRefresh,
    handleCompact,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleThinkingLevelChange,
    dismissNotice,
    dismissCompactResult,
    loadSlashCommands,
    loadOlder,
    loadDeferredContent,
    isAwayFromBottom,
    reattachAutoFollow,
    disengageAutoFollow,
    isFollowingSuspended,
    settleAtLatest,
  } = useAgentSession({
    environmentId,
    session,
    sessionFolderMissing: knownMissingFolder,
    newSessionCwd,
    onAgentEnd: wrappedOnAgentEnd,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    chatInputRef,
    onBranchDataChange,
    onSystemPromptChange,
    onSessionStatsPanelOpen,
    readingVisible: visible,
    restoreReadingPosition,
    expansionStores,
  });
  const selectionQuote = useSelectionQuote({
    visible: visible && messages.length > 0,
    sessionId: session?.id ?? null,
    scrollContainerRef,
    chatInputRef,
  });
  const compaction = useMemo(
    () =>
      session || isNew
        ? {
            isCompacting,
            disabled: agentRunning && !isCompacting,
            error: compactError,
            compact: () => void handleCompact(),
            abort: handleAbortCompaction,
          }
        : null,
    [session, isNew, isCompacting, agentRunning, compactError, handleCompact, handleAbortCompaction],
  );

  useSessionReporting({
    sessionStats,
    contextUsage,
    compaction,
    displayModelId: displayModelValue?.modelId ?? null,
    onSessionStatsChange,
    onContextUsageChange,
    onCompactionChange,
    onModelIdChange,
  });

  const { editDraft, editHandlers, dropEditFiles } = useMessageEdit({
    sessionId: session?.id,
    environmentId,
    supportsImages: modelSupportsImages(
      displayModelValue ? { provider: displayModelValue.provider, id: displayModelValue.modelId } : null,
      modelList,
    ),
    sendMessage: handleEditMessage,
  });

  const onDrop = useCallback(
    (files: File[]) => {
      if (dropEditFiles(files)) return;
      chatInputRef?.current?.addFiles(files);
    },
    [chatInputRef, dropEditFiles],
  );

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop, visible);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");

  messageRefs.current = Array(visibleMessages.length)
    .fill(null)
    .map((_, index) => messageRefs.current[index] ?? null);

  const navigatorTurns = useMemo(
    () => toNavigatorTurns(messages, entryIds, olderOutline),
    [entryIds, messages, olderOutline],
  );

  const toolMessageIndex = useMemo(() => buildToolMessageIndex(messages), [messages]);
  const promptHistory = useMemo(() => recallablePrompts(messages), [messages]);

  const {
    olderHistorySentinelRef,
    loadOlderHistory,
    continueOlderHistory,
    olderHistoryFailed,
    olderHistoryHalted,
    turnJump,
  } = useOlderHistory({
    visible,
    sessionId: session?.id ?? null,
    previousCursor,
    hasOlder,
    loadingOlder,
    loadOlder,
    messagesLength: messages.length,
    loadedEntryIds: entryIds,
    scrollContainerRef,
  });

  const { jumpToQuote, jumpingQuoteKey, detachedQuoteKeys, detachedPreview, closeDetachedPreview } = useQuoteJump({
    visible,
    sessionId: session?.id ?? null,
    scrollContainerRef,
    loadedEntryIds: entryIds,
    hasOlder,
    turnJump,
    disengageAutoFollow,
  });
  const quoteInteraction = { onJumpQuote: jumpToQuote, jumpingQuoteKey, detachedQuoteKeys };

  useReadingPosition({
    visible,
    sessionId: session?.id ?? null,
    readingPositions,
    restoreReadingPosition,
    messages,
    scrollContainerRef,
    previousCursor,
    loading,
    hasOlder,
    loadingOlder,
    olderHistoryFailed,
    olderHistoryHalted,
    continueOlderHistory,
    settleAtLatest,
  });

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;

  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  const chatViewportHeight = useObservedElementHeight(scrollContainerRef, 0, visible);

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const sessionId = session?.id;
  const remote = useMemo(
    () =>
      sessionId && channelSnapshot && onChannelSnapshotChange
        ? { sessionId, snapshot: channelSnapshot, onSnapshotChange: onChannelSnapshotChange }
        : null,
    [channelSnapshot, onChannelSnapshotChange, sessionId],
  );

  const chatInputElement = (
    <ChatInput
      environmentId={environmentId}
      sessionFolderMissing={sessionFolderMissing}
      missingFolderRecovery={missingFolderRecovery}
      ref={chatInputRef}
      promptHistory={promptHistory}
      onSend={handleSend}
      {...quoteInteraction}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={agentRunning}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelThinkingLevels={modelThinkingLevels}
      modelCatalog={modelCatalog}
      modelCatalogScope={modelCatalogScope}
      modelLoading={modelLoading}
      modelReconnecting={modelReconnecting}
      modelLoadError={modelLoadError}
      modelRefreshing={modelRefreshing}
      onModelChange={handleModelChange}
      onModelsRefresh={refreshModels}
      onModelsRefreshCancel={cancelModelRefresh}
      onOpenUsage={onSessionStatsPanelOpen}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      onDismissCompactResult={dismissCompactResult}
      contextUsage={contextUsage}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      queuedMessages={queuedMessages}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? (newSessionCwd ? newSessionDraftKey(newSessionCwd, environmentId) : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
      visible={visible}
      remote={remote}
      navigation={navigation}
      workspace={workspace}
    />
  );

  const aboveEditorWidgets = extensionWidgets.filter((widget) => widget.placement !== "belowEditor");

  const belowEditorWidgets = extensionWidgets.filter((widget) => widget.placement === "belowEditor");
  return {
    selectionQuote,
    quoteInteraction,
    detachedPreview,
    closeDetachedPreview,
    loading,
    error,
    sessionLoadReconnecting,
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
    liveToolUpdates,
    session,
    modelNames,
    messageCwd,
    environmentId,
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
    handleAbort,
    liveContentEndRef,
    chatViewportHeight,
    messagesEndRef,
    navigatorTurns,
    turnJump,
    isAwayFromBottom,
    reattachAutoFollow,
    disengageAutoFollow,
    isFollowingSuspended,
    belowEditorWidgets,
    chatInputElement,
  };
}
export type ChatWindowState = ReturnType<typeof useChatWindow>;
