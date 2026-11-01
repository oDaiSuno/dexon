import { agentState, getSession, getSessionContext, getSessionContextPage } from "@/lib/api-client";
import { sessionClientErrorMessage } from "@/lib/session-error-message";
import { captureReadingAnchor } from "@/lib/reading-anchor";
import { normalizeSessionHistory, type SessionHistoryValue } from "@/lib/session-history-update";
import { mergeHistoryTail, outlineBeyondWindow, prependHistoryPage } from "@/lib/session-pagination";
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
  HISTORY_PAGE_MAX_BYTES,
  INITIAL_HISTORY_TURNS,
  SessionData,
  normalizeQueuedMessages,
} from "./shared";
import { choiceOfContext } from "./model-choice-ledger";
import type { SessionState } from "./use-session-state";
import { useSessionHistoryVisuals } from "./use-session-history-visuals";
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
  | "setOlderOutline"
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
  | "completionScrollAllowedRef"
  | "modelChoice"
  | "snapshotOrder"
  | "setContextUsage"
  | "setSystemPrompt"
  | "setExtensionStatuses"
  | "setExtensionWidgets"
  | "setQueuedMessages"
  | "t"
  | "messages"
  | "scrollContainerRef"
  | "userScrollIntentUntilRef"
>;
export type OlderHistoryOutcome = "unavailable" | "loaded" | "stalled" | "discarded" | "reset" | "failed";
export type OlderHistoryPurpose = "reading" | "jump";

export function useSessionHistory(context: Dependencies, readingVisible = true) {
  const {
    readingVisibleRef,
    scheduleVisualFrame: scheduleTrackedVisualFrame,
    queueHistoryAnchor,
  } = useSessionHistoryVisuals({
    readingVisible,
    historyGenerationRef: context.historyGenerationRef,
    sessionIdRef: context.sessionIdRef,
    historyRevisionRef: context.historyRevisionRef,
    scrollContainerRef: context.scrollContainerRef,
    userScrollIntentUntilRef: context.userScrollIntentUntilRef,
  });

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
    setOlderOutline,
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
    completionScrollAllowedRef,
    modelChoice,
    snapshotOrder,
    setContextUsage,
    setSystemPrompt,
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
        const ticket = snapshotOrder.issue({ resetHistory });
        const isCurrentLoad = () => sessionIdRef.current === sid && loadGeneration === historyGenerationRef.current;
        let result: SessionData;
        try {
          markSessionLoadPhase(trace, "rpc-start");
          result = await modelChoice.observe(
            () =>
              getSession(sid, includeState, trace.id, {
                maxTurns: INITIAL_HISTORY_TURNS,
                maxBytes: HISTORY_PAGE_MAX_BYTES,
              }),
            (detail) =>
              isCurrentLoad() && snapshotOrder.canCommit(ticket)
                ? choiceOfContext(detail.context, includeState ? detail.agentState?.state?.thinkingLevel : undefined)
                : null,
          );
          markSessionLoadPhase(trace, "rpc-end");
        } catch (e) {
          failSessionLoadTrace(trace);
          traceFailed = true;
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("not found") || msg.includes("NOT_FOUND")) {
            if (showLoading && isCurrentLoad() && snapshotOrder.canCommit(ticket)) {
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
        if (!isCurrentLoad()) {
          failSessionLoadTrace(trace);
          traceFailed = true;
          return null;
        }

        const history = snapshotOrder.admitHistory(ticket);
        if (history.admitted) {
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
            history.resetHistory,
          );
          if (mergedHistory.revision !== historyRevisionRef.current) {
            deferredContentCacheRef.current.clear();
            deferredContentRequestRef.current.clear();
          }
          commitHistory(mergedHistory.messages, mergedHistory.entryIds);
          updatePagingState(mergedHistory.revision!, mergedHistory.previousCursor ?? undefined);
          setOlderOutline(outlineBeyondWindow(d.context.outline, mergedHistory.entryIds));
          setError(null);
        } else {
          failSessionLoadTrace(trace);
          traceFailed = true;
        }
        if (!includeState || !d.agentState) return d.agentState ?? null;
        const runtime = snapshotOrder.admitRuntime(ticket, d.agentState);
        if (!runtime.current) return runtime.latest;
        const liveState = d.agentState.state;
        if (interactiveVersion === interactiveTools.getVersion()) {
          interactiveTools.reconcile(liveState?.extensionUi ?? null);
        }
        if (liveState) {
          if (liveState.contextUsage !== undefined) setContextUsage(liveState.contextUsage ?? null);
          if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
          if (liveState.extensionStatuses !== undefined) setExtensionStatuses(liveState.extensionStatuses ?? []);
          if (liveState.extensionWidgets !== undefined) setExtensionWidgets(liveState.extensionWidgets ?? []);
          if (liveState.queuedMessages !== undefined)
            setQueuedMessages(normalizeQueuedMessages(liveState.queuedMessages));
        } else if (!d.agentState.running) {
          setQueuedMessages({ steering: [], followUp: [] });
          if (d.contextUsage !== undefined) setContextUsage(d.contextUsage ?? null);
        }
        return d.agentState;
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
      modelChoice,
      setContextUsage,
      setData,
      setError,
      setExtensionStatuses,
      setExtensionWidgets,
      setLoading,
      setLoadingOlder,
      setOlderOutline,
      setQueuedMessages,
      setSystemPrompt,
      snapshotOrder,
      t,
      updatePagingState,
    ],
  );

  const refreshContextUsage = useCallback(
    async (sid: string | null = sessionIdRef.current) => {
      if (!sid) return;
      try {
        const d = await agentState(sid);
        const state = d.state as AgentStateResponse | undefined;
        if (state?.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
      } catch {
        return;
      }
    },
    [sessionIdRef, setContextUsage],
  );

  useEffect(() => {
    const trace = pendingSessionLoadTraceRef.current;
    if (!trace) return;
    pendingSessionLoadTraceRef.current = null;
    markSessionLoadPhase(trace, "react-commit");
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      finishSessionLoadTrace(trace);
    };
    if (!readingVisibleRef.current) {
      finish();
      return;
    }
    const scheduleSecondFrame = () => {
      if (!readingVisibleRef.current || scheduleTrackedVisualFrame(finish) === null) finish();
    };
    if (scheduleTrackedVisualFrame(scheduleSecondFrame) === null) finish();
    return finish;
  }, [messages, pendingSessionLoadTraceRef, readingVisible, readingVisibleRef, scheduleTrackedVisualFrame]);

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
      const gen = ++contextGenRef.current;
      historyGenerationRef.current += 1;
      olderRequestRef.current = null;
      setLoadingOlder(false);
      try {
        const d = await modelChoice.observe(
          () =>
            getSessionContext(sid, leafId ?? undefined, {
              maxTurns: INITIAL_HISTORY_TURNS,
              maxBytes: HISTORY_PAGE_MAX_BYTES,
            }),
          (detail) =>
            gen === contextGenRef.current && sessionIdRef.current === sid ? choiceOfContext(detail.context) : null,
        );
        if (gen !== contextGenRef.current) return;
        commitHistory(d.context.messages, d.context.entryIds ?? []);
        updatePagingState(d.context.historyRevision, d.context.previousCursor);
        setOlderOutline(outlineBeyondWindow(d.context.outline, d.context.entryIds ?? []));
      } catch (e) {
        if (gen !== contextGenRef.current) return;
        console.error("Failed to load context:", e);
      }
    },
    [
      commitHistory,
      historyGenerationRef,
      modelChoice,
      olderRequestRef,
      sessionIdRef,
      setLoadingOlder,
      setOlderOutline,
      updatePagingState,
    ],
  );

  const loadOlder = useCallback(
    async (purpose: OlderHistoryPurpose = "reading"): Promise<OlderHistoryOutcome> => {
      if (!readingVisibleRef.current) return "unavailable";
      const sid = sessionIdRef.current;
      const cursor = previousCursorRef.current;
      const revision = historyRevisionRef.current;
      if (!sid || !cursor || !revision || olderRequestRef.current === cursor) return "unavailable";
      const generation = historyGenerationRef.current;
      const startedAt = performance.now();
      let outcome = "ok";
      let result: OlderHistoryOutcome = "loaded";
      const scrollElement = scrollContainerRef.current;
      const previousScrollHeight = scrollElement?.scrollHeight ?? 0;
      const previousScrollTop = scrollElement?.scrollTop ?? 0;
      const contentAnchorAtRequest = purpose === "jump" ? null : captureReadingAnchor(scrollElement);
      let settled = false;
      let anchorRestoreQueued = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (generation === historyGenerationRef.current) setLoadingOlder(false);
      };
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
          result = "discarded";
          return result;
        }
        if (page.context.historyRevision !== revision) {
          outcome = "revision-reset";
          result = "reset";
          await loadSession(sid, false, false, true);
          return result;
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
          result = "reset";
          await loadSession(sid, false, false, true);
          return result;
        }
        const advanced =
          prepended.messages.length > loadedMessagesRef.current.length && (prepended.previousCursor ?? null) !== cursor;
        result = advanced ? "loaded" : "stalled";
        const contentAnchor =
          purpose === "jump" || !readingVisibleRef.current
            ? contentAnchorAtRequest
            : captureReadingAnchor(scrollElement);
        completionScrollAllowedRef.current = false;
        commitHistory(prepended.messages, prepended.entryIds);
        updatePagingState(revision, prepended.previousCursor ?? undefined);
        setOlderOutline((current) => outlineBeyondWindow(current, prepended.entryIds));
        if (scrollElement && purpose !== "jump") {
          anchorRestoreQueued = true;
          queueHistoryAnchor({
            element: scrollElement,
            previousScrollHeight,
            previousScrollTop,
            contentAnchor,
            generation,
            sessionId: sid,
            revision,
            onSettled: settle,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("STALE_CURSOR")) {
          outcome = "stale-reset";
          result = "reset";
          await loadSession(sid, false, false, true);
        } else {
          outcome = "error";
          result = "failed";
          console.error("Failed to load older session history:", error);
        }
      } finally {
        if (olderRequestRef.current === cursor) olderRequestRef.current = null;
        if (!anchorRestoreQueued) settle();
        logSessionPerformanceEvent("history-page", {
          outcome,
          totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
        });
      }
      return result;
    },
    [
      commitHistory,
      completionScrollAllowedRef,
      historyGenerationRef,
      historyRevisionRef,
      loadSession,
      loadedEntryIdsRef,
      loadedMessagesRef,
      olderRequestRef,
      previousCursorRef,
      scrollContainerRef,
      sessionIdRef,
      queueHistoryAnchor,
      readingVisibleRef,
      setLoadingOlder,
      setOlderOutline,
      updatePagingState,
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
  };
}
export type SessionHistory = ReturnType<typeof useSessionHistory>;
