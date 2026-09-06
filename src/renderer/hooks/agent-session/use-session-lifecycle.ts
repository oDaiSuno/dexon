import { subscribeSessionsChanged } from "@/lib/api-client";
import { useEffect } from "react";
import { subscribeActiveSessionLiveSync } from "../active-session-live-sync";
import { EventStreamConnectionError, ThinkingLevelOption, normalizeQueuedMessages } from "./shared";
import type { SessionActions } from "./use-session-actions";
import type { SessionConnection } from "./use-session-connection";
import type { SessionEvents } from "./use-session-events";
import type { SessionHistory } from "./use-session-history";
import type { SessionScroll } from "./use-session-scroll";
import type { SessionState } from "./use-session-state";
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
  | "scrollContainerRef"
  | "messages"
  | "loading"
  | "pendingScrollToUserRef"
  | "initialScrollDoneRef"
  | "completionScrollAllowedRef"
  | "agentRunning"
  | "externalTurnAutoFollowRef"
  | "userScrollIntentUntilRef"
  | "agentPhase"
  | "isAwayFromBottom"
  | "streamState"
> &
  Pick<SessionHistory, "commitHistory" | "loadSession"> &
  Pick<SessionConnection, "connectEvents"> &
  Pick<SessionEvents, "waitForPromptSettlement"> &
  Pick<SessionActions, "handleLeafChangeFromUi"> &
  Pick<
    SessionScroll,
    | "markUserScrollIntent"
    | "handleTouchStart"
    | "handleTouchMove"
    | "handleTouchEnd"
    | "handleScrollPositionChange"
    | "scrollUserMsgToTop"
    | "scrollToBottom"
    | "scrollLiveContentToBottom"
    | "updateScrollPresence"
  >;
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
    markUserScrollIntent,
    scrollContainerRef,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleScrollPositionChange,
    messages,
    loading,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    scrollUserMsgToTop,
    scrollToBottom,
    completionScrollAllowedRef,
    agentRunning,
    externalTurnAutoFollowRef,
    userScrollIntentUntilRef,
    scrollLiveContentToBottom,
    agentPhase,
    isAwayFromBottom,
    streamState,
    updateScrollPresence,
  } = context;

  // Load session on mount
  useEffect(() => {
    let disposed = false;
    let unsubscribeLiveSync: (() => void) | undefined;
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
        if (autoFollowMagnetRef.current) {
          const trySnap = () => {
            const el = agentRunningRef.current ? liveContentEndRef.current : messagesEndRef.current;
            if (el) el.scrollIntoView({ behavior: "auto", block: "end" });
          };
          requestAnimationFrame(trySnap);
          requestAnimationFrame(() => requestAnimationFrame(trySnap));
        }
        if (agentState?.running) {
          if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
            agentRunningRef.current = true;
            setAgentRunning(true);
            setAgentPhase(agentState.state.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" });
            dispatch({ type: "start" });
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
      unsubscribeLiveSync?.();
      eventConnectionManager.invalidate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session identity owns this lifecycle effect.
  }, []);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChangeFromUi);
  }, [data?.tree, activeLeafId, handleLeafChangeFromUi, onBranchDataChange]);

  useEffect(() => {
    window.addEventListener("keydown", markUserScrollIntent);
    window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    return () => {
      window.removeEventListener("keydown", markUserScrollIntent);
      window.removeEventListener("pointerdown", markUserScrollIntent);
    };
  }, [markUserScrollIntent]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("wheel", markUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    container.addEventListener("scroll", handleScrollPositionChange, { passive: true });
    return () => {
      container.removeEventListener("wheel", markUserScrollIntent);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
      container.removeEventListener("scroll", handleScrollPositionChange);
    };
  }, [
    messages.length,
    loading,
    handleScrollPositionChange,
    markUserScrollIntent,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    scrollContainerRef,
  ]);

  useEffect(() => {
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        pendingScrollToUserRef.current = false;
        initialScrollDoneRef.current = true;
        scrollUserMsgToTop();
      } else if (!initialScrollDoneRef.current) {
        initialScrollDoneRef.current = true;
        scrollToBottom("instant");
      } else if (!agentRunningRef.current && completionScrollAllowedRef.current) {
        scrollToBottom("smooth");
      }
    }
  }, [
    messages.length,
    agentRunning,
    scrollToBottom,
    scrollUserMsgToTop,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    agentRunningRef,
    completionScrollAllowedRef,
  ]);

  useEffect(() => {
    if (!agentRunning || !completionScrollAllowedRef.current) return;
    if (!externalTurnAutoFollowRef.current && !autoFollowMagnetRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (!completionScrollAllowedRef.current) return;
      if (!externalTurnAutoFollowRef.current && !autoFollowMagnetRef.current) return;
      if (Date.now() <= userScrollIntentUntilRef.current) return;
      scrollLiveContentToBottom();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    agentRunning,
    agentPhase,
    messages.length,
    isAwayFromBottom,
    scrollLiveContentToBottom,
    streamState.streamingMessage,
    completionScrollAllowedRef,
    externalTurnAutoFollowRef,
    autoFollowMagnetRef,
    userScrollIntentUntilRef,
  ]);

  // Keep "away from bottom" fresh when the viewport or message layout changes.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => updateScrollPresence());
    ro.observe(container);
    // scrollHeight can change without resizing the viewport (for example when
    // an image loads or process details expand), so observe the content too.
    const content = liveContentEndRef.current?.parentElement;
    if (content) ro.observe(content);
    updateScrollPresence();
    return () => ro.disconnect();
  }, [liveContentEndRef, loading, messages.length, scrollContainerRef, updateScrollPresence]);

  // Content can grow without firing a scroll event (the streaming tail makes
  // the container taller while scrollTop stays put) — re-evaluate presence
  // after messages/streaming change.
  useEffect(() => {
    const t = setTimeout(updateScrollPresence, 30);
    return () => clearTimeout(t);
  }, [messages.length, streamState.isStreaming, streamState.streamingMessage, updateScrollPresence]);
  return {};
}
export type SessionLifecycle = ReturnType<typeof useSessionLifecycle>;
