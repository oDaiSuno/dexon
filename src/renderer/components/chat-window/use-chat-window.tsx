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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatInput } from "../ChatInput";
import { recallablePrompts } from "../chat-input/prompt-history";
import { useMessageEdit } from "../messages/user-message-editor";
import { Props, toNavigatorTurns } from "./shared";
import { AssistantBlockCache } from "./turn-layout";
import { useOlderHistory } from "./use-older-history";
import { useReadingPosition } from "./use-reading-position";

export function useChatWindow({
  session,
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
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } = useAudio();
  const isMobile = useIsMobile(visible);
  const { t } = useI18n();
  const [newSessionEnvironmentId] = useState(getActiveEnvironmentId);
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
    messages,
    entryIds,
    streamState,
    agentRunning,
    modelNames,
    modelList,
    modelCatalog,
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
    session,
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
  const statsKey = sessionStats
    ? [
        sessionStats.sessionId,
        sessionStats.sessionFile ?? "",
        sessionStats.sessionName ?? "",
        sessionStats.userMessages,
        sessionStats.assistantMessages,
        sessionStats.toolCalls,
        sessionStats.toolResults,
        sessionStats.totalMessages,
        sessionStats.tokens.input,
        sessionStats.tokens.output,
        sessionStats.tokens.cacheRead,
        sessionStats.tokens.cacheWrite,
        sessionStats.tokens.total,
        sessionStats.cost ?? 0,
        JSON.stringify(sessionStats.costs ?? null),
        sessionStats.lastCompactionAt ?? "",
      ].join("|")
    : null;

  const sessionStatsRef = useRef(sessionStats);

  sessionStatsRef.current = sessionStats;

  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);

  useEffect(
    () => () => {
      onSessionStatsChange?.(null);
    },
    [onSessionStatsChange],
  );
  const ctxKey = contextUsage ? JSON.stringify(contextUsage) : null;

  const contextUsageRef = useRef(contextUsage);

  contextUsageRef.current = contextUsage;

  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);

  useEffect(
    () => () => {
      onContextUsageChange?.(null);
    },
    [onContextUsageChange],
  );

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

  useEffect(() => {
    onCompactionChange?.(compaction);
  }, [compaction, onCompactionChange]);

  useEffect(
    () => () => {
      onCompactionChange?.(null);
    },
    [onCompactionChange],
  );

  const displayModelId = displayModelValue?.modelId ?? null;

  useEffect(() => {
    onModelIdChange?.(displayModelId);
  }, [displayModelId, onModelIdChange]);

  useEffect(
    () => () => {
      onModelIdChange?.(null);
    },
    [onModelIdChange],
  );

  const { editDraft, editHandlers, dropEditFiles } = useMessageEdit({
    sessionId: session?.id,
    environmentId: session?.environmentId ?? newSessionEnvironmentId,
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
      environmentId={session?.environmentId ?? newSessionEnvironmentId}
      ref={chatInputRef}
      promptHistory={promptHistory}
      onSend={handleSend}
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
      draftKey={session?.id ?? (newSessionCwd ? newSessionDraftKey(newSessionCwd, newSessionEnvironmentId) : undefined)}
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
