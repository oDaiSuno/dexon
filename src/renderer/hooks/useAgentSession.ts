import { useCallback, useRef } from "react";
import type { UseAgentSessionOptions } from "./agent-session/shared";
import { useSessionActions } from "./agent-session/use-session-actions";
import { useSessionCommands } from "./agent-session/use-session-commands";
import { useSessionConnection } from "./agent-session/use-session-connection";
import { useSessionDeferredContent } from "./agent-session/use-session-deferred-content";
import { useSessionEffects } from "./agent-session/use-session-effects";
import { useSessionEvents } from "./agent-session/use-session-events";
import { useSessionExtensions } from "./agent-session/use-session-extensions";
import { useSessionHistory } from "./agent-session/use-session-history";
import { useSessionLifecycle } from "./agent-session/use-session-lifecycle";
import { useSessionReading } from "./agent-session/use-session-reading";
import { useSessionModels } from "./agent-session/use-session-models";
import { useSessionQueue } from "./agent-session/use-session-queue";
import { useSessionScroll } from "./agent-session/use-session-scroll";
import { useSessionState } from "./agent-session/use-session-state";
import { useSessionVersions } from "./agent-session/use-session-versions";
export type {
  AgentPhase,
  BuiltinSlashCommandResult,
  ChatInputHandle,
  CompactResultInfo,
  NoticeItem,
  QueuedMessages,
  RetryInfo,
  SessionData,
  SlashCommandInfo,
  ThinkingLevelOption,
  UseAgentSessionOptions,
} from "./agent-session/shared";
export function useAgentSession(opts: UseAgentSessionOptions) {
  const readingVisible = opts.readingVisible ?? true;
  const readingVisibleRef = useRef(readingVisible);
  readingVisibleRef.current = readingVisible;
  const visualFrameIdsRef = useRef<Set<number>>(new Set());
  const state = useSessionState(opts);
  const history = useSessionHistory(state, readingVisible);
  const deferredContent = useSessionDeferredContent({ ...state, ...history });
  const connection = useSessionConnection({ ...state, ...history });
  const extensions = useSessionExtensions({ ...state, ...history, ...connection }, opts);
  const events = useSessionEvents({ ...state, ...history, ...connection, ...extensions, readingVisibleRef });
  const actions = useSessionActions({ ...state, ...history, ...connection, ...extensions, ...events });
  const versions = useSessionVersions({ ...state, ...history, ...connection, ...extensions, ...events });
  const models = useSessionModels({ ...state, ...history, ...connection, ...extensions, ...events, ...actions });
  const commands = useSessionCommands({
    ...state,
    ...history,
    ...connection,
    ...extensions,
    ...events,
    ...actions,
    ...models,
  });
  const queue = useSessionQueue(
    { ...state, ...history, ...connection, ...extensions, ...events, ...actions, ...models, ...commands },
    opts,
  );
  const scroll = useSessionScroll({
    ...state,
    ...history,
    ...connection,
    ...extensions,
    ...events,
    ...actions,
    ...versions,
    ...models,
    ...commands,
    ...queue,
    visualFrameIdsRef,
  });
  const lifecycle = useSessionLifecycle({
    ...state,
    ...history,
    ...connection,
    ...extensions,
    ...events,
    ...actions,
    ...versions,
    ...models,
    ...commands,
    ...queue,
    ...scroll,
    readingVisible,
    readingVisibleRef,
    visualFrameIdsRef,
  });
  const reading = useSessionReading({ ...state, ...scroll }, readingVisible, opts.restoreReadingPosition ?? false);
  const effects = useSessionEffects({
    ...state,
    ...history,
    ...connection,
    ...extensions,
    ...events,
    ...actions,
    ...versions,
    ...models,
    ...commands,
    ...queue,
    ...scroll,
    ...lifecycle,
  });
  const {
    data,
    loading,
    error,
    activeLeafId,
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
    newSessionModel,
    displayThinkingLevel,
    retryInfo,
    contextUsage,
    systemPrompt,
    forkingEntryId,
    isCompacting,
    compactError,
    compactResult,
    currentModel,
    displayModel,
    sessionStats,
    slashCommands,
    slashCommandsLoading,
    queuedMessages,
    previousCursor,
    loadingOlder,
    historyRevision,
    olderOutline,
    noticeState,
    dispatchNotice,
    setCompactResult,
    interactiveTools,
    extensionStatuses,
    extensionWidgets,
    isNew,
    agentPhase,
    isAwayFromBottom,
    reattachAutoFollow,
    settleAtLatest,
    sessionIdRef,
    eventUnsubRef,
    messagesEndRef,
    liveContentEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
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
    loadSlashCommands,
    loadOlder,
    loadDeferredContent,
    setActiveLeafId,
    setData,
    setMessages,
    dispatch,
    setAgentRunning,
    setForkingEntryId,
    handleAgentEventRef,
  } = {
    ...state,
    ...history,
    ...deferredContent,
    ...connection,
    ...extensions,
    ...events,
    ...actions,
    ...versions,
    ...models,
    ...commands,
    ...queue,
    ...scroll,
    ...lifecycle,
    ...reading,
    ...effects,
  };
  const dismissNotice = useCallback((id: string) => dispatchNotice({ type: "mark_exiting", id }), [dispatchNotice]);
  const dismissCompactResult = useCallback(() => setCompactResult(null), [setCompactResult]);
  return {
    // State
    data,
    loading,
    error,
    activeLeafId,
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
    newSessionModel,
    thinkingLevel: displayThinkingLevel,
    retryInfo,
    contextUsage,
    systemPrompt,
    forkingEntryId,
    isCompacting,
    compactError,
    compactResult,
    currentModel,
    displayModel,
    sessionStats,
    slashCommands,
    slashCommandsLoading,
    queuedMessages,
    previousCursor,
    hasOlder: previousCursor !== null,
    loadingOlder,
    historyRevision,
    olderOutline,
    notices: noticeState.visible,
    interactiveTools,
    extensionStatuses,
    extensionWidgets,
    isAutoModelSelection: isNew && newSessionModel === null,
    agentPhase,
    isNew,
    // "Scroll to bottom" affordance state + action
    isAwayFromBottom,
    reattachAutoFollow,
    settleAtLatest,
    // Refs
    sessionIdRef,
    eventUnsubRef,
    messagesEndRef,
    liveContentEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    // Actions
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
    setActiveLeafId,
    setData,
    setMessages,
    dispatch,
    setAgentRunning,
    setForkingEntryId,
    // Subscriptions
    handleAgentEventRef,
  };
}
