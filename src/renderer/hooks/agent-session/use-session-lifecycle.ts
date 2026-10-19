import { subscribeSessionsChanged } from "@/lib/api-client";
import { normalizeToolCalls } from "@/lib/normalize";
import { useEffect, type MutableRefObject } from "react";
import { subscribeActiveSessionLiveSync } from "../active-session-live-sync";
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
  | "session"
  | "sessionChangeIgnoreScrollUntilRef"
  | "sessionIdRef"
  | "autoFollowMagnetRef"
  | "agentRunningRef"
  | "liveContentEndRef"
  | "messagesEndRef"
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
    session,
    sessionChangeIgnoreScrollUntilRef,
    sessionIdRef,
    connectEvents,
    loadSession,
    autoFollowMagnetRef,
    agentRunningRef,
    liveContentEndRef,
    messagesEndRef,
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
    handleLeafChangeFromUi,
    readingVisible,
    readingVisibleRef,
    visualFrameIdsRef,
  } = context;

  // Load session on mount
  useEffect(() => {
    let disposed = false;
    let unsubscribeLiveSync: (() => void) | undefined;
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
    if (session) {
      sessionChangeIgnoreScrollUntilRef.current = Date.now() + 1500;
      sessionIdRef.current = session.id;

      // Subscribe even when the session is currently idle. IM turns can start
      // without a desktop prompt, so waiting for agentState.running would miss
      // the entire external turn until this component is remounted.
      void subscribeActiveSessionLiveSync({
        sessionId: session.id,
        connectAgentEvents: async (sessionId) => {
          const result = await connectEvents(sessionId);
          if (result.status !== "connected") throw new EventStreamConnectionError(result.status);
          return result.unsubscribe;
        },
        subscribeSessionChanges: subscribeSessionsChanged,
        onSessionChanged: () => {
          // includeState so externally-driven turns (messaging channels)
          // also refresh the context usage, not just the message list.
          if (!disposed) void loadSession(session.id, false, true);
        },
      })
        .then((unsubscribe) => {
          if (disposed) unsubscribe();
          else unsubscribeLiveSync = unsubscribe;
        })
        .catch((cause) => {
          if (!disposed) console.error("Failed to subscribe to active session updates:", cause);
        });

      void loadSession(session.id, true, true, true).then((agentState) => {
        if (disposed) return;
        // When the magnet was engaged before switching sessions, scroll to
        // the very last message after messages load; otherwise the viewport
        // may show empty footer space while the real content sits above.
        // Defer via rAF and re-check: the message list can render in multiple
        // frames, so scroll target should be the live-content end (not the
        // spacer after it).
        if (autoFollowMagnetRef.current && readingVisibleRef.current) {
          const trySnap = () => {
            if (!readingVisibleRef.current) return;
            const el = agentRunningRef.current ? liveContentEndRef.current : messagesEndRef.current;
            if (el) el.scrollIntoView({ behavior: "auto", block: "end" });
          };
          const scheduleVisualFrame = (callback: () => void) => {
            if (!readingVisibleRef.current || typeof globalThis.requestAnimationFrame !== "function") return;
            let frameId = 0;
            let callbackRan = false;
            frameId = globalThis.requestAnimationFrame(() => {
              callbackRan = true;
              visualFrameIdsRef.current.delete(frameId);
              if (readingVisibleRef.current && !disposed) callback();
            });
            if (!callbackRan) visualFrameIdsRef.current.add(frameId);
          };
          scheduleVisualFrame(trySnap);
          scheduleVisualFrame(() => scheduleVisualFrame(trySnap));
        }
        if (agentState?.running) {
          if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
            agentRunningRef.current = true;
            setAgentRunning(true);
            setAgentPhase(agentState.state.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" });
            const partialReply = agentState.state.streamingMessage;
            dispatch(partialReply ? { type: "update", message: normalizeToolCalls(partialReply) } : { type: "start" });
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
            setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
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
      unsubscribeLiveSync?.();
      eventConnectionManager.invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session identity owns this lifecycle effect.
  }, []);

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
