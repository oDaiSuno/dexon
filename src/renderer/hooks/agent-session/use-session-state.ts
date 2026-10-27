import { useI18n } from "@/i18n";
import { sendAgentCommand } from "@/lib/agent-client";
import { EventStreamConnectionManager } from "@/lib/event-stream-connection";
import { InteractiveToolStore, toolDraftStorage } from "@/lib/interactive-tool-store";
import { LatestRequestGate } from "@/lib/latest-request-gate";
import { noticeReducer } from "@/lib/notice-queue";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { type SessionLoadTrace } from "@/lib/session-performance";
import { summarizeSessionMessages } from "@/lib/session-stats";
import type {
  AgentMessage,
  AssistantContentBlock,
  ExtensionStatusItem,
  ExtensionWidgetItem,
  ImageContent,
  TextContent,
} from "@/lib/types";
import type { ContextUsageInfo, ModelCatalogStatus, TurnOutlineItem } from "@contract/types";
import { useReducer, useRef, useState } from "react";
import {
  AgentEvent,
  AgentPhase,
  CompactResultInfo,
  ModelEntry,
  QueuedMessages,
  RetryInfo,
  SelectedModel,
  SessionData,
  SlashCommandInfo,
  ThinkingLevelOption,
  UseAgentSessionOptions,
  getScrollMagnetEngaged,
  streamReducer,
} from "./shared";

export function useSessionState(opts: UseAgentSessionOptions) {
  const { t } = useI18n();
  const {
    session,
    newSessionCwd,
    onAgentEnd,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    onBranchDataChange,
    onSystemPromptChange,
    onSessionStatsPanelOpen,
  } = opts;

  const isNew = session === null && newSessionCwd !== null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogStatus>({
    source: "cache",
    refreshed: false,
    aborted: false,
    warnings: [],
  });
  const [modelRefreshing, setModelRefreshing] = useState(false);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>(
    {},
  );
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [retryInfo, setRetryInfo] = useState<RetryInfo | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsageInfo | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const [sessionStatsOverride, setSessionStatsOverride] = useState<SessionStatsInfo | null>(null);
  const [interactiveTools] = useState(
    () => new InteractiveToolStore(session?.id ?? null, sendAgentCommand, toolDraftStorage()),
  );
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });
  const [previousCursor, setPreviousCursor] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState<string | null>(null);
  const [olderOutline, setOlderOutline] = useState<TurnOutlineItem[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // True when the chat viewport has scrolled away from the bottom; drives the
  // floating "scroll to bottom" affordance in ChatWindow.
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);

  const eventUnsubRef = useRef<(() => void) | null>(null);
  const [eventConnectionManager] = useState(() => new EventStreamConnectionManager(eventUnsubRef));
  const modelRefreshRequestRef = useRef<string | null>(null);
  const modelListRequestGateRef = useRef(new LatestRequestGate());
  const modelListSizeRef = useRef(0);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const completionScrollAllowedRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const ignoreProgrammaticScrollUntilRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const liveContentEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const touchStartClientYRef = useRef<number | null>(null);
  const externalTurnAutoFollowRef = useRef(false);
  // Set when the user explicitly re-attaches the viewport to the newest
  // content (clicks "scroll to bottom"); live-follow then stays engaged until
  // the user scrolls away again or the run ends.
  // Restored from the module flag so the magnet survives session switches that
  // remount ChatWindow (key={sessionKey}).
  const autoFollowMagnetRef = useRef(getScrollMagnetEngaged());
  const sessionChangeIgnoreScrollUntilRef = useRef(0);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const promptRunIdRef = useRef(0);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const pendingSessionLoadTraceRef = useRef<SessionLoadTrace | null>(null);
  const historyGenerationRef = useRef(0);
  const historyRevisionRef = useRef<string | null>(null);
  const previousCursorRef = useRef<string | null>(null);
  const loadedMessagesRef = useRef<AgentMessage[]>([]);
  const loadedEntryIdsRef = useRef<string[]>([]);
  const olderRequestRef = useRef<string | null>(null);
  const deferredContentCacheRef = useRef<Map<string, AssistantContentBlock | TextContent | ImageContent>>(new Map());
  const deferredContentRequestRef = useRef<
    Map<string, Promise<AssistantContentBlock | TextContent | ImageContent | undefined>>
  >(new Map());

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;

  const sessionStats = (() => {
    if (sessionStatsOverride) return sessionStatsOverride;
    const detail = session && data?.sessionId === session.id ? data : null;
    if (session && !detail) return null;
    const summary = detail?.stats ?? summarizeSessionMessages(messages);
    if (summary.totalMessages === 0 && summary.tokens.total === 0) return null;
    return {
      sessionFile: detail?.filePath || undefined,
      sessionId: session?.id ?? sessionIdRef.current ?? "",
      sessionName: session?.name,
      ...summary,
      ...(contextUsage ? { contextUsage } : {}),
    } satisfies SessionStatsInfo;
  })();
  return {
    loadedMessagesRef,
    loadedEntryIdsRef,
    setMessages,
    setEntryIds,
    historyRevisionRef,
    previousCursorRef,
    setHistoryRevision,
    setPreviousCursor,
    setLoading,
    historyGenerationRef,
    olderRequestRef,
    setLoadingOlder,
    setData,
    setActiveLeafId,
    setError,
    sessionIdRef,
    pendingSessionLoadTraceRef,
    deferredContentCacheRef,
    deferredContentRequestRef,
    setCurrentModelOverride,
    setContextUsage,
    setSystemPrompt,
    setThinkingLevel,
    setExtensionStatuses,
    setExtensionWidgets,
    setQueuedMessages,
    t,
    messages,
    scrollContainerRef,
    isNew,
    newSessionCwd,
    newSessionPromotedRef,
    onSessionCreated,
    ensuringNewSessionRef,
    newSessionModel,
    newSessionDefaultModel,
    setPendingModel,
    thinkingLevel,
    setSlashCommands,
    setSlashCommandsLoading,
    eventConnectionManager,
    handleAgentEventRef,
    dispatchNotice,
    promptRunIdRef,
    optimisticUserMessageKeyRef,
    agentRunningRef,
    setAgentRunning,
    setAgentPhase,
    setRetryInfo,
    dispatch,
    onAgentEnd,
    setIsCompacting,
    agentRunning,
    externalTurnAutoFollowRef,
    completionScrollAllowedRef,
    lastScrollTopRef,
    setCompactError,
    setCompactResult,
    pendingScrollToUserRef,
    session,
    setForkingEntryId,
    onSessionForked,
    setNewSessionModel,
    isCompacting,
    setModelNames,
    setModelThinkingLevels,
    setModelThinkingLevelMaps,
    modelListSizeRef,
    setModelList,
    setModelCatalog,
    setNewSessionDefaultModel,
    modelListRequestGateRef,
    modelRefreshRequestRef,
    setModelRefreshing,
    setSessionStatsOverride,
    onSessionStatsPanelOpen,
    ignoreProgrammaticScrollUntilRef,
    liveContentEndRef,
    messagesEndRef,
    lastUserMsgRef,
    setIsAwayFromBottom,
    autoFollowMagnetRef,
    initialScrollDoneRef,
    userScrollIntentUntilRef,
    touchStartClientYRef,
    sessionChangeIgnoreScrollUntilRef,
    onSystemPromptChange,
    systemPrompt,
    onBranchDataChange,
    data,
    activeLeafId,
    loading,
    agentPhase,
    isAwayFromBottom,
    streamState,
    modelsRefreshKey,
    compactError,
    compactResult,
    noticeState,
    contextUsage,
    error,
    entryIds,
    modelNames,
    modelList,
    modelCatalog,
    modelRefreshing,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    retryInfo,
    forkingEntryId,
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
    setOlderOutline,
    interactiveTools,
    extensionStatuses,
    extensionWidgets,
    eventUnsubRef,
  };
}
export type SessionState = ReturnType<typeof useSessionState>;
