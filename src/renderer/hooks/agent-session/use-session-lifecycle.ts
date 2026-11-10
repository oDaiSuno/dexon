import { getEnvironmentApiClient } from "@/lib/api-client";
import { normalizeToolCalls } from "@/lib/normalize";
import { useEffect, useRef, type MutableRefObject } from "react";
import { EventStreamConnectionError, normalizeQueuedMessages } from "./shared";
import type { SessionActions } from "./use-session-actions";
import type { SessionConnection } from "./use-session-connection";
import type { SessionEvents } from "./use-session-events";
import type { SessionHistory } from "./use-session-history";
import type { SessionState } from "./use-session-state";

type Dependencies = Pick<
  SessionState,
  | "environmentId"
  | "eventUnsubRef"
  | "historyGenerationRef"
  | "historyRevisionRef"
  | "previousCursorRef"
  | "olderRequestRef"
  | "deferredContentCacheRef"
  | "deferredContentRequestRef"
  | "setHistoryRevision"
  | "setPreviousCursor"
  | "setLoadingOlder"
  | "setOlderOutline"
  | "session"
  | "sessionChangeIgnoreScrollUntilRef"
  | "sessionIdRef"
  | "agentRunningRef"
  | "setAgentRunning"
  | "setAgentPhase"
  | "dispatch"
  | "setIsCompacting"
  | "setContextUsage"
  | "setSystemPrompt"
  | "modelChoice"
  | "snapshotOrder"
  | "setExtensionStatuses"
  | "setExtensionWidgets"
  | "setQueuedMessages"
  | "eventConnectionManager"
  | "onSystemPromptChange"
  | "systemPrompt"
  | "onBranchDataChange"
  | "data"
  | "activeLeafId"
  | "unsavedMessages"
> &
  Pick<SessionHistory, "commitHistory" | "loadSession"> &
  Pick<SessionConnection, "connectEvents"> &
  Pick<SessionEvents, "waitForPromptSettlement"> &
  Pick<SessionActions, "handleLeafChangeFromUi"> & {
    readingVisible: boolean;
    readingVisibleRef: MutableRefObject<boolean>;
    visualFrameIdsRef: MutableRefObject<Set<number>>;
  };

export function useSessionLifecycle(context: Dependencies) {
  const mountContext = useRef(context);
  const {
    environmentId,
    eventUnsubRef,
    agentRunningRef,
    session,
    loadSession,
    onSystemPromptChange,
    systemPrompt,
    onBranchDataChange,
    data,
    activeLeafId,
    handleLeafChangeFromUi,
    readingVisible,
    readingVisibleRef,
    visualFrameIdsRef,
  } = context;

  useEffect(() => {
    const {
      historyGenerationRef,
      historyRevisionRef,
      previousCursorRef,
      commitHistory,
      olderRequestRef,
      deferredContentCacheRef,
      deferredContentRequestRef,
      setHistoryRevision,
      setPreviousCursor,
      setLoadingOlder,
      setOlderOutline,
      session,
      sessionChangeIgnoreScrollUntilRef,
      sessionIdRef,
      connectEvents,
      loadSession,
      agentRunningRef,
      setAgentRunning,
      setAgentPhase,
      dispatch,
      waitForPromptSettlement,
      setIsCompacting,
      setContextUsage,
      setSystemPrompt,
      modelChoice,
      snapshotOrder,
      setExtensionStatuses,
      setExtensionWidgets,
      setQueuedMessages,
      eventConnectionManager,
      unsavedMessages,
      visualFrameIdsRef,
    } = mountContext.current;
    let disposed = false;
    let unsubscribeEvents: (() => void) | undefined;
    const frameIds = visualFrameIdsRef.current;
    historyGenerationRef.current += 1;
    historyRevisionRef.current = null;
    previousCursorRef.current = null;
    commitHistory([], []);
    olderRequestRef.current = null;
    deferredContentCacheRef.current.clear();
    deferredContentRequestRef.current.clear();
    setHistoryRevision(null);
    setPreviousCursor(null);
    setLoadingOlder(false);
    setOlderOutline([]);
    if (session) {
      sessionChangeIgnoreScrollUntilRef.current = Date.now() + 1500;
      sessionIdRef.current = session.id;
      void connectEvents(session.id)
        .then((result) => {
          if (result.status !== "connected") throw new EventStreamConnectionError(result.status);
          if (disposed) result.unsubscribe();
          else unsubscribeEvents = result.unsubscribe;
        })
        .catch((cause) => {
          if (!disposed) console.error("Failed to subscribe to active session updates:", cause);
        });

      void loadSession(session.id, true, true, true).then((agentState) => {
        if (disposed) return;
        if (agentState?.running) {
          if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
            agentRunningRef.current = true;
            setAgentRunning(true);
            setAgentPhase(agentState.state.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" });
            const partialReply = agentState.state.streamingMessage;
            dispatch(
              partialReply
                ? {
                    type: "update",
                    message: normalizeToolCalls(partialReply),
                    entryId: unsavedMessages.resumeStreaming(partialReply.timestamp),
                  }
                : { type: "start" },
            );
            if (!agentState.state.isStreaming && agentState.state.isPromptRunning) {
              void waitForPromptSettlement(session.id);
            }
          }
        }
        if (agentState?.state) {
          if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
          if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
          if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
          if (agentState.state.extensionStatuses !== undefined)
            setExtensionStatuses(agentState.state.extensionStatuses ?? []);
          if (agentState.state.extensionWidgets !== undefined)
            setExtensionWidgets(agentState.state.extensionWidgets ?? []);
          if (agentState.state.queuedMessages !== undefined)
            setQueuedMessages(normalizeQueuedMessages(agentState.state.queuedMessages));
        }
      });
    }
    return () => {
      disposed = true;
      historyGenerationRef.current += 1;
      modelChoice.reset();
      snapshotOrder.reset();
      for (const frameId of frameIds) cancelAnimationFrame(frameId);
      frameIds.clear();
      unsubscribeEvents?.();
      eventConnectionManager.invalidate();
    };
  }, []);

  const liveSessionId = session?.id ?? null;
  useEffect(() => {
    if (!liveSessionId) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const reload = () => {
      if (!disposed) void loadSession(liveSessionId, false, true);
    };
    void getEnvironmentApiClient(environmentId)
      .subscribeSessionsChanged((event) => {
        if (event.sessionId !== liveSessionId) return;
        const eventsAttached = eventUnsubRef.current !== null;
        if (event.cause === "live-append" && agentRunningRef.current && eventsAttached) return;
        reload();
      }, reload)
      .then((off) => {
        if (disposed) off();
        else unsubscribe = off;
      })
      .catch((cause) => {
        if (!disposed) console.error("Failed to subscribe to active session updates:", cause);
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [environmentId, liveSessionId, loadSession, agentRunningRef, eventUnsubRef]);

  useEffect(() => {
    readingVisibleRef.current = readingVisible;
    if (readingVisible) return;
    const frameIds = visualFrameIdsRef.current;
    for (const frameId of frameIds) cancelAnimationFrame(frameId);
    frameIds.clear();
  }, [readingVisible, readingVisibleRef, visualFrameIdsRef]);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChangeFromUi);
  }, [data?.tree, activeLeafId, handleLeafChangeFromUi, onBranchDataChange]);

  return {};
}
export type SessionLifecycle = ReturnType<typeof useSessionLifecycle>;
