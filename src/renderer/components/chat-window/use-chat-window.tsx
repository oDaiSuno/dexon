import { useAgentSession } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useObservedElementHeight } from "@/hooks/useObservedElementHeight";
import { useI18n } from "@/i18n";
import { MessageRenderKeyRegistry } from "@/lib/message-render-key";
import { buildToolMessageIndex } from "@/lib/tool-message-index";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ChatInput } from "../ChatInput";
import { Props, toMinimapMessage } from "./shared";
import { AssistantBlockCache } from "./turn-layout";

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
  onOpenFile,
  thinkingExpansionStore,
  processDetailsExpansionStore,
  visible = true,
}: Props) {
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio } = useAudio();

  const isMobile = useIsMobile(visible);

  const { t } = useI18n();

  const messageRenderKeys = useRef(new MessageRenderKeyRegistry()).current;

  const assistantBlockCache = useRef(new AssistantBlockCache()).current;
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
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
    loadingOlder,
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
    handleNavigate,
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
    loadSlashCommands,
    loadOlder,
    loadDeferredContent,
    isAwayFromBottom,
    reattachAutoFollow,
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
    messageRefs,
    readingVisible: visible,
  });

  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
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

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;

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

  const onDrop = useCallback(
    (files: File[]) => {
      // Attaching while the agent runs is fine — send stays gated separately.
      chatInputRef?.current?.addFiles(files);
    },
    [chatInputRef],
  );

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop, visible);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");

  messageRefs.current = Array(visibleMessages.length)
    .fill(null)
    .map((_, index) => messageRefs.current[index] ?? null);

  const minimapMessages = useMemo(() => messages.flatMap((message) => toMinimapMessage(message) ?? []), [messages]);

  const minimapStreamingMessage = useMemo(
    () => (streamState.streamingMessage ? toMinimapMessage(streamState.streamingMessage) : null),
    [streamState.streamingMessage],
  );

  const toolMessageIndex = useMemo(() => buildToolMessageIndex(messages), [messages]);

  const insertEditedContent = useCallback(
    (content: string) => chatInputRef?.current?.insertIfEmpty(content),
    [chatInputRef],
  );

  const olderHistorySentinelRef = useRef<HTMLDivElement | null>(null);

  const automaticHistoryPagesRef = useRef(0);

  useEffect(() => {
    automaticHistoryPagesRef.current = 0;
  }, [session?.id]);

  useEffect(() => {
    if (!visible) return;
    const sentinel = olderHistorySentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || !hasOlder || loadingOlder) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || automaticHistoryPagesRef.current >= 3) return;
        automaticHistoryPagesRef.current += 1;
        void loadOlder();
      },
      { root, rootMargin: "160px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasOlder, loadOlder, loadingOlder, messages.length, scrollContainerRef, visible]);
  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;

  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  const chatViewportHeight = useObservedElementHeight(scrollContainerRef, 0, visible);

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
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
      modelCatalog={modelCatalog}
      modelRefreshing={modelRefreshing}
      onModelChange={handleModelChange}
      onModelsRefresh={refreshModels}
      onModelsRefreshCancel={cancelModelRefresh}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
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
      draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
      visible={visible}
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
    isMobile,
    scrollContainerRef,
    hasOlder,
    loadingOlder,
    olderHistorySentinelRef,
    loadOlder,
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
  };
}
export type ChatWindowState = ReturnType<typeof useChatWindow>;
