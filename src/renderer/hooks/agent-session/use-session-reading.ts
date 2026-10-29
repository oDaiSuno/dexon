import { useEffect } from "react";
import type { SessionScroll } from "./use-session-scroll";
import type { SessionState } from "./use-session-state";

/**
 * Reading-side wiring of the chat surface: user input listeners, geometry
 * observation, presence tracking and scroll-follow pacing. These effects own
 * how the chat reacts to what the user sees — they are exactly the parts that
 * must pause while the chat page is hidden (HC-7), while the runtime keeps
 * streaming. They receive visibility as a plain input and never duplicate
 * runtime state: every flag is a ref owned by the state owner or the scroll
 * policy.
 */
type Dependencies = Pick<
  SessionState,
  | "messages"
  | "loading"
  | "agentRunning"
  | "agentPhase"
  | "isAwayFromBottom"
  | "streamState"
  | "agentRunningRef"
  | "scrollContainerRef"
  | "liveContentEndRef"
  | "pendingScrollToUserRef"
  | "initialScrollDoneRef"
  | "completionScrollAllowedRef"
  | "externalTurnAutoFollowRef"
  | "autoFollowMagnetRef"
  | "userScrollIntentUntilRef"
  | "scrollbarHoldRef"
> &
  Pick<
    SessionScroll,
    | "markUserScrollIntent"
    | "endScrollbarHold"
    | "handleTouchStart"
    | "handleTouchMove"
    | "handleTouchEnd"
    | "handleScrollPositionChange"
    | "scrollUserMsgToTop"
    | "scrollToBottom"
    | "scrollLiveContentToBottom"
    | "updateScrollPresence"
    | "settleAtLatest"
  >;

export function useSessionReading(context: Dependencies, visible: boolean, restoreReadingPosition = false) {
  const {
    messages,
    loading,
    agentRunning,
    agentPhase,
    isAwayFromBottom,
    streamState,
    agentRunningRef,
    scrollContainerRef,
    liveContentEndRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    completionScrollAllowedRef,
    externalTurnAutoFollowRef,
    autoFollowMagnetRef,
    userScrollIntentUntilRef,
    scrollbarHoldRef,
    markUserScrollIntent,
    endScrollbarHold,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleScrollPositionChange,
    scrollUserMsgToTop,
    scrollToBottom,
    scrollLiveContentToBottom,
    updateScrollPresence,
    settleAtLatest,
  } = context;

  useEffect(() => {
    if (!visible) return;
    const holdOptions = { capture: true, passive: true } as const;
    window.addEventListener("keydown", markUserScrollIntent);
    window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    window.addEventListener("pointerup", endScrollbarHold, holdOptions);
    window.addEventListener("pointercancel", endScrollbarHold, holdOptions);
    return () => {
      window.removeEventListener("keydown", markUserScrollIntent);
      window.removeEventListener("pointerdown", markUserScrollIntent);
      window.removeEventListener("pointerup", endScrollbarHold, holdOptions);
      window.removeEventListener("pointercancel", endScrollbarHold, holdOptions);
    };
  }, [visible, markUserScrollIntent, endScrollbarHold]);

  useEffect(() => {
    if (!visible) return;
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
    visible,
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
    if (!visible) return;
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        pendingScrollToUserRef.current = false;
        initialScrollDoneRef.current = true;
        scrollUserMsgToTop();
      } else if (!initialScrollDoneRef.current) {
        initialScrollDoneRef.current = true;
        if (restoreReadingPosition) completionScrollAllowedRef.current = false;
        else settleAtLatest();
      } else if (!agentRunningRef.current && completionScrollAllowedRef.current) {
        scrollToBottom("smooth");
      }
    }
  }, [
    visible,
    messages.length,
    agentRunning,
    scrollToBottom,
    scrollUserMsgToTop,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    agentRunningRef,
    completionScrollAllowedRef,
    restoreReadingPosition,
    settleAtLatest,
  ]);

  useEffect(() => {
    if (!visible) return;
    if (!agentRunning || !completionScrollAllowedRef.current) return;
    if (!externalTurnAutoFollowRef.current && !autoFollowMagnetRef.current) return;
    if (typeof globalThis.requestAnimationFrame !== "function") return;
    let cancelled = false;
    const frame = globalThis.requestAnimationFrame(() => {
      if (cancelled || !visible) return;
      if (!completionScrollAllowedRef.current) return;
      if (!externalTurnAutoFollowRef.current && !autoFollowMagnetRef.current) return;
      if (scrollbarHoldRef.current) return;
      if (Date.now() <= userScrollIntentUntilRef.current) return;
      scrollLiveContentToBottom();
    });
    return () => {
      cancelled = true;
      globalThis.cancelAnimationFrame?.(frame);
    };
  }, [
    visible,
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
    scrollbarHoldRef,
  ]);

  // Keep "away from bottom" fresh when the viewport or message layout changes.
  useEffect(() => {
    if (!visible) return;
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
  }, [visible, liveContentEndRef, loading, messages.length, scrollContainerRef, updateScrollPresence]);

  // Content can grow without firing a scroll event (the streaming tail makes
  // the container taller while scrollTop stays put) — re-evaluate presence
  // after messages/streaming change.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(updateScrollPresence, 30);
    return () => clearTimeout(t);
  }, [visible, messages.length, streamState.isStreaming, streamState.streamingMessage, updateScrollPresence]);

  return {};
}
export type SessionReading = ReturnType<typeof useSessionReading>;
