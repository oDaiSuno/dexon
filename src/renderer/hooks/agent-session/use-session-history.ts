import {
  agentState,
  getSession,
  getSessionContext,
  getSessionContextPage,
  getSessionEntryContent,
} from "@/lib/api-client";
import { sessionClientErrorMessage } from "@/lib/session-error-message";
import { normalizeSessionHistory, type SessionHistoryValue } from "@/lib/session-history-update";
import { mergeHistoryTail, prependHistoryPage } from "@/lib/session-pagination";
import {
  consumeSessionLoadTrace,
  failSessionLoadTrace,
  finishSessionLoadTrace,
  logSessionPerformanceEvent,
  markSessionLoadPhase,
} from "@/lib/session-performance";
import type { AgentMessage } from "@/lib/types";
import { useCallback, useEffect, useRef } from "react";
import {
  AgentStateResponse,
  DEFERRED_CONTENT_CACHE_SIZE,
  HISTORY_PAGE_MAX_BYTES,
  INITIAL_HISTORY_TURNS,
  SessionData,
  ThinkingLevelOption,
  normalizeQueuedMessages,
} from "./shared";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  | "interactiveTools"
  | "loadedMessagesRef"
  | "loadedEntryIdsRef"
  | "setMessages"
  | "setEntryIds"
  | "historyRevisionRef"
  | "previousCursorRef"
  | "setHistoryRevision"
  | "setPreviousCursor"
  | "setLoading"
  | "historyGenerationRef"
  | "olderRequestRef"
  | "setLoadingOlder"
  | "setData"
  | "setActiveLeafId"
  | "setError"
  | "sessionIdRef"
  | "pendingSessionLoadTraceRef"
  | "deferredContentCacheRef"
  | "deferredContentRequestRef"
  | "setCurrentModelOverride"
  | "setContextUsage"
  | "setSystemPrompt"
  | "setThinkingLevel"
  | "setExtensionStatuses"
  | "setExtensionWidgets"
  | "setQueuedMessages"
  | "t"
  | "messages"
  | "scrollContainerRef"
>;
export function useSessionHistory(context: Dependencies) {
  const {
    interactiveTools,
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
  } = context;

  const commitHistory = useCallback(
    (nextMessages: AgentMessage[], nextEntryIds: string[]) => {
      const normalized = normalizeSessionHistory(nextMessages, nextEntryIds);
      loadedMessagesRef.current = normalized.messages;
      loadedEntryIdsRef.current = normalized.entryIds;
      setMessages(normalized.messages);
      setEntryIds(normalized.entryIds);
    },
    [loadedEntryIdsRef, loadedMessagesRef, setEntryIds, setMessages],
  );

  const updateHistory = useCallback(
    (update: (current: SessionHistoryValue) => SessionHistoryValue) => {
      const next = update({ messages: loadedMessagesRef.current, entryIds: loadedEntryIdsRef.current });
      commitHistory(next.messages, next.entryIds);
    },
    [commitHistory, loadedEntryIdsRef, loadedMessagesRef],
  );

  const updatePagingState = useCallback(
    (revision: string, cursor?: string) => {
      historyRevisionRef.current = revision;
      previousCursorRef.current = cursor ?? null;
      setHistoryRevision(revision);
      setPreviousCursor(cursor ?? null);
    },
    [historyRevisionRef, previousCursorRef, setHistoryRevision, setPreviousCursor],
  );

  const loadSession = useCallback(
    async (sid: string, showLoading = false, includeState = false, resetHistory = false) => {
      const trace = consumeSessionLoadTrace(sid, showLoading ? "initial" : "refresh");
      const interactiveVersion = interactiveTools.getVersion();
      let traceFailed = false;
      try {
        if (showLoading) setLoading(true);
        if (resetHistory) {
          historyGenerationRef.current += 1;
          olderRequestRef.current = null;
          setLoadingOlder(false);
        }
        const loadGeneration = historyGenerationRef.current;
        let result: SessionData;
        try {
          markSessionLoadPhase(trace, "rpc-start");
          result = await getSession(sid, includeState, trace.id, {
            maxTurns: INITIAL_HISTORY_TURNS,
            maxBytes: HISTORY_PAGE_MAX_BYTES,
          });
          markSessionLoadPhase(trace, "rpc-end");
        } catch (e) {
          failSessionLoadTrace(trace);
          traceFailed = true;
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("not found") || msg.includes("NOT_FOUND")) {
            if (showLoading) {
              setData(null);
              setActiveLeafId(null);
              commitHistory([], []);
              setError(null);
            }
            return null;
          }
          throw e;
        }
        const d = result;
        if (sessionIdRef.current !== sid || loadGeneration !== historyGenerationRef.current) {
          failSessionLoadTrace(trace);
          traceFailed = true;
          return null;
        }

        setData(d);
        setActiveLeafId(d.leafId);
        const replacedCommitTrace = pendingSessionLoadTraceRef.current;
        if (replacedCommitTrace && replacedCommitTrace !== trace) failSessionLoadTrace(replacedCommitTrace);
        pendingSessionLoadTraceRef.current = trace;
        const mergedHistory = mergeHistoryTail(
          {
            messages: loadedMessagesRef.current,
            entryIds: loadedEntryIdsRef.current,
            revision: historyRevisionRef.current,
            previousCursor: previousCursorRef.current,
          },
          d.context,
          resetHistory,
        );
        if (mergedHistory.revision !== historyRevisionRef.current) {
          deferredContentCacheRef.current.clear();
          deferredContentRequestRef.current.clear();
        }
        commitHistory(mergedHistory.messages, mergedHistory.entryIds);
        updatePagingState(mergedHistory.revision!, mergedHistory.previousCursor ?? undefined);
        setCurrentModelOverride(null);
        setError(null);
        const liveState = d.agentState?.state;
        if (includeState && d.agentState && interactiveVersion === interactiveTools.getVersion()) {
          interactiveTools.reconcile(liveState?.extensionUi ?? null);
        }
        if (liveState) {
          if (liveState.contextUsage !== undefined) setContextUsage(liveState.contextUsage ?? null);
          if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
          if (liveState.thinkingLevel !== undefined)
            setThinkingLevel((liveState.thinkingLevel as ThinkingLevelOption) ?? "auto");
          if (liveState.extensionStatuses !== undefined) setExtensionStatuses(liveState.extensionStatuses ?? []);
          if (liveState.extensionWidgets !== undefined) setExtensionWidgets(liveState.extensionWidgets ?? []);
          if (liveState.queuedMessages !== undefined)
            setQueuedMessages(normalizeQueuedMessages(liveState.queuedMessages));
        } else if (d.agentState && !d.agentState.running) {
          setQueuedMessages({ steering: [], followUp: [] });
          // Sessions without a live runtime carry a file-reconstructed usage
          // on the detail itself (see sessions.get). Undefined means "not
          // computable" — keep the current state instead of fabricating one.
          if (d.contextUsage !== undefined) setContextUsage(d.contextUsage ?? null);
        }
        if (!liveState?.thinkingLevel && d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
          setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
        }
        return d.agentState ?? null;
      } catch (e) {
        if (!traceFailed) failSessionLoadTrace(trace);
        setError(sessionClientErrorMessage(e, t, t("sessionLoadFailed", "Failed to load session.")));
        return null;
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [
      commitHistory,
      deferredContentCacheRef,
      deferredContentRequestRef,
      historyGenerationRef,
      historyRevisionRef,
      interactiveTools,
      loadedEntryIdsRef,
      loadedMessagesRef,
      olderRequestRef,
      pendingSessionLoadTraceRef,
      previousCursorRef,
      sessionIdRef,
      setActiveLeafId,
      setContextUsage,
      setCurrentModelOverride,
      setData,
      setError,
      setExtensionStatuses,
      setExtensionWidgets,
      setLoading,
      setLoadingOlder,
      setQueuedMessages,
      setSystemPrompt,
      setThinkingLevel,
      t,
      updatePagingState,
    ],
  );

  /**
   * Pull the authoritative context usage for a live session (model switch,
   * branch navigation, compaction) without touching other state. Failures
   * keep the last known value; the next refresh path retries.
   */
  const refreshContextUsage = useCallback(
    async (sid: string | null = sessionIdRef.current) => {
      if (!sid) return;
      try {
        const d = await agentState(sid);
        const state = d.state as AgentStateResponse | undefined;
        if (state?.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
      } catch {
        // Keep the last known usage.
      }
    },
    [sessionIdRef, setContextUsage],
  );

  useEffect(() => {
    const trace = pendingSessionLoadTraceRef.current;
    if (!trace) return;
    pendingSessionLoadTraceRef.current = null;
    markSessionLoadPhase(trace, "react-commit");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => finishSessionLoadTrace(trace));
    });
  }, [messages, pendingSessionLoadTraceRef]);

  useEffect(
    () => () => {
      const trace = pendingSessionLoadTraceRef.current;
      pendingSessionLoadTraceRef.current = null;
      if (trace) failSessionLoadTrace(trace);
    },
    [pendingSessionLoadTraceRef],
  );

  const contextGenRef = useRef(0);

  const loadContext = useCallback(
    async (sid: string, leafId: string | null) => {
      // ISSUE-007: only apply the latest navigation result
      const gen = ++contextGenRef.current;
      historyGenerationRef.current += 1;
      olderRequestRef.current = null;
      setLoadingOlder(false);
      try {
        const d = await getSessionContext(sid, leafId ?? undefined, {
          maxTurns: INITIAL_HISTORY_TURNS,
          maxBytes: HISTORY_PAGE_MAX_BYTES,
        });
        if (gen !== contextGenRef.current) return;
        commitHistory(d.context.messages, d.context.entryIds ?? []);
        updatePagingState(d.context.historyRevision, d.context.previousCursor);
      } catch (e) {
        if (gen !== contextGenRef.current) return;
        console.error("Failed to load context:", e);
      }
    },
    [commitHistory, historyGenerationRef, olderRequestRef, setLoadingOlder, updatePagingState],
  );

  const loadOlder = useCallback(async () => {
    const sid = sessionIdRef.current;
    const cursor = previousCursorRef.current;
    const revision = historyRevisionRef.current;
    if (!sid || !cursor || !revision || olderRequestRef.current === cursor) return;
    const generation = historyGenerationRef.current;
    const startedAt = performance.now();
    let outcome = "ok";
    const scrollElement = scrollContainerRef.current;
    const previousScrollHeight = scrollElement?.scrollHeight ?? 0;
    const previousScrollTop = scrollElement?.scrollTop ?? 0;
    olderRequestRef.current = cursor;
    setLoadingOlder(true);
    try {
      const page = await getSessionContextPage(sid, cursor, INITIAL_HISTORY_TURNS, HISTORY_PAGE_MAX_BYTES);
      if (
        generation !== historyGenerationRef.current ||
        sid !== sessionIdRef.current ||
        revision !== historyRevisionRef.current
      ) {
        outcome = "discarded";
        return;
      }
      if (page.context.historyRevision !== revision) {
        outcome = "revision-reset";
        await loadSession(sid, false, false, true);
        return;
      }
      const prepended = prependHistoryPage(
        {
          messages: loadedMessagesRef.current,
          entryIds: loadedEntryIdsRef.current,
          revision,
          previousCursor: previousCursorRef.current,
        },
        page.context,
      );
      if (!prepended) {
        outcome = "revision-reset";
        await loadSession(sid, false, false, true);
        return;
      }
      commitHistory(prepended.messages, prepended.entryIds);
      updatePagingState(revision, prepended.previousCursor ?? undefined);
      requestAnimationFrame(() => {
        const current = scrollContainerRef.current;
        if (!current || current !== scrollElement) return;
        current.scrollTop = previousScrollTop + (current.scrollHeight - previousScrollHeight);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("STALE_CURSOR")) {
        outcome = "stale-reset";
        await loadSession(sid, false, false, true);
      } else {
        outcome = "error";
        console.error("Failed to load older session history:", error);
      }
    } finally {
      if (olderRequestRef.current === cursor) olderRequestRef.current = null;
      if (generation === historyGenerationRef.current) setLoadingOlder(false);
      logSessionPerformanceEvent("history-page", {
        outcome,
        totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
      });
    }
  }, [
    commitHistory,
    historyGenerationRef,
    historyRevisionRef,
    loadSession,
    loadedEntryIdsRef,
    loadedMessagesRef,
    olderRequestRef,
    previousCursorRef,
    scrollContainerRef,
    sessionIdRef,
    setLoadingOlder,
    updatePagingState,
  ]);

  const loadDeferredContent = useCallback(
    async (entryId: string, blockIndex = 0) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const generation = historyGenerationRef.current;
      const cacheKey = `${sid}:${entryId}:${blockIndex}`;
      let loadedContent = deferredContentCacheRef.current.get(cacheKey);
      if (loadedContent === undefined) {
        let request = deferredContentRequestRef.current.get(cacheKey);
        if (!request) {
          request = getSessionEntryContent(sid, entryId, blockIndex).then((result) => result.content);
          deferredContentRequestRef.current.set(cacheKey, request);
        }
        try {
          loadedContent = await request;
        } finally {
          deferredContentRequestRef.current.delete(cacheKey);
        }
        const cache = deferredContentCacheRef.current;
        cache.delete(cacheKey);
        cache.set(cacheKey, loadedContent);
        while (cache.size > DEFERRED_CONTENT_CACHE_SIZE) cache.delete(cache.keys().next().value!);
      }
      if (generation !== historyGenerationRef.current || sid !== sessionIdRef.current) return;
      const nextMessages = loadedMessagesRef.current.map((message, messageIndex) => {
        if (loadedEntryIdsRef.current[messageIndex] !== entryId || !Array.isArray(message.content)) return message;
        const content = message.content.map((block, index) => {
          if (index !== blockIndex || !("deferredContent" in block)) return block;
          return loadedContent;
        });
        return { ...message, content } as AgentMessage;
      });
      commitHistory(nextMessages, loadedEntryIdsRef.current);
    },
    [
      commitHistory,
      deferredContentCacheRef,
      deferredContentRequestRef,
      historyGenerationRef,
      loadedEntryIdsRef,
      loadedMessagesRef,
      sessionIdRef,
    ],
  );
  return {
    loadSession,
    updateHistory,
    loadContext,
    refreshContextUsage,
    contextGenRef,
    commitHistory,
    loadOlder,
    loadDeferredContent,
  };
}
export type SessionHistory = ReturnType<typeof useSessionHistory>;
