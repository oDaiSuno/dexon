import { subscribeSessionsChanged } from "@/lib/api-client";
import { normalizeToolCalls } from "@/lib/normalize";
import { useEffect, type MutableRefObject } from "react";
import { EventStreamConnectionError, ThinkingLevelOption, normalizeQueuedMessages } from "./shared";
import type { SessionActions } from "./use-session-actions";
import type { SessionConnection } from "./use-session-connection";
import type { SessionEvents } from "./use-session-events";
import type { SessionHistory } from "./use-session-history";
import type { SessionState } from "./use-session-state";

/**
 * Runtime lifecycle of one mounted session: the mount-only subscription and
 * load, live-state restoration, and the outward state reports. Visual and
 * input wiring lives in use-session-reading so page visibility can pause the
 * reading branch without ever pausing this runtime.
 */
type Dependencies = Pick<
  SessionState,
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
  | "setThinkingLevel"
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
    setThinkingLevel,
    setExtensionStatuses,
    setExtensionWidgets,
    setQueuedMessages,
    eventConnectionManager,
    onSystemPromptChange,
    systemPrompt,
    onBranchDataChange,
    data,
    activeLeafId,
    unsavedMessages,
    handleLeafChangeFromUi,
    readingVisible,
    readingVisibleRef,
    visualFrameIdsRef,
  } = context;

  // Load session on mount
  useEffect(() => {
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

      // Subscribe even when the session is currently idle. IM turns can start
      // without a desktop prompt, so waiting for agentState.running would miss
      // the entire external turn until this component is remounted.
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
          if (agentState.state.thinkingLevel !== undefined)
            setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? null);
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
      for (const frameId of frameIds) cancelAnimationFrame(frameId);
      frameIds.clear();
      unsubscribeEvents?.();
      eventConnectionManager.invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session identity owns this lifecycle effect.
  }, []);

  const liveSessionId = session?.id ?? null;
  useEffect(() => {
    if (!liveSessionId) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeSessionsChanged((event) => {
      // includeState so externally-driven turns (messaging channels)
      // also refresh the context usage, not just the message list.
      if (!disposed && event.sessionId === liveSessionId) void loadSession(liveSessionId, false, true);
    })
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
  }, [liveSessionId, loadSession]);

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
