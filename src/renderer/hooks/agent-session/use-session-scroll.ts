import { useCallback } from "react";
import {
  isUpwardScrollKey,
  isUpwardTouchGesture,
  shouldDisengageScrollMagnet,
  shouldStopChatAutoFollow,
} from "../chat-scroll-policy";
import {
  PROGRAMMATIC_SCROLL_IGNORE_MS,
  SCROLL_KEYS,
  USER_SCROLL_INTENT_MS,
  isNearBottomExcludingSpacer,
  setScrollMagnetEngaged,
} from "./shared";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  | "ignoreProgrammaticScrollUntilRef"
  | "agentRunningRef"
  | "liveContentEndRef"
  | "messagesEndRef"
  | "scrollContainerRef"
  | "lastUserMsgRef"
  | "setIsAwayFromBottom"
  | "completionScrollAllowedRef"
  | "externalTurnAutoFollowRef"
  | "autoFollowMagnetRef"
  | "pendingScrollToUserRef"
  | "initialScrollDoneRef"
  | "userScrollIntentUntilRef"
  | "lastScrollTopRef"
  | "touchStartClientYRef"
  | "sessionChangeIgnoreScrollUntilRef"
>;
export function useSessionScroll(context: Dependencies) {
  const {
    ignoreProgrammaticScrollUntilRef,
    agentRunningRef,
    liveContentEndRef,
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    setIsAwayFromBottom,
    completionScrollAllowedRef,
    externalTurnAutoFollowRef,
    autoFollowMagnetRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    userScrollIntentUntilRef,
    lastScrollTopRef,
    touchStartClientYRef,
    sessionChangeIgnoreScrollUntilRef,
  } = context;

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
      // Prefer the live-content end anchor. When the agent is running there is
      // a full-viewport spacer below it (see ChatWindow), and messagesEndRef
      // sits AFTER that spacer — scrolling to it lands in blank footer space
      // with the real content still above the fold.
      const el = agentRunningRef.current ? liveContentEndRef.current : messagesEndRef.current;
      el?.scrollIntoView({ behavior, block: "end" });
    },
    [agentRunningRef, ignoreProgrammaticScrollUntilRef, liveContentEndRef, messagesEndRef],
  );

  const scrollLiveContentToBottom = useCallback(() => {
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    liveContentEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [ignoreProgrammaticScrollUntilRef, liveContentEndRef]);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, [ignoreProgrammaticScrollUntilRef, lastUserMsgRef, scrollContainerRef]);

  const updateScrollPresence = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const nearBottom = isNearBottomExcludingSpacer(container);
    // Bail out of re-renders when the value is unchanged.
    setIsAwayFromBottom((prev) => (prev === !nearBottom ? prev : !nearBottom));
  }, [scrollContainerRef, setIsAwayFromBottom]);

  // "Scroll to bottom": snap to the end and re-magnet the viewport so the next
  // streaming ticks keep following until the user scrolls away again.
  const reattachAutoFollow = useCallback(() => {
    completionScrollAllowedRef.current = true;
    externalTurnAutoFollowRef.current = false;
    autoFollowMagnetRef.current = true;
    setScrollMagnetEngaged(true);
    pendingScrollToUserRef.current = false;
    initialScrollDoneRef.current = true;
    userScrollIntentUntilRef.current = 0;
    scrollToBottom("auto");
  }, [
    autoFollowMagnetRef,
    completionScrollAllowedRef,
    externalTurnAutoFollowRef,
    initialScrollDoneRef,
    pendingScrollToUserRef,
    scrollToBottom,
    userScrollIntentUntilRef,
  ]);

  const disengageAutoFollowForExplicitUpwardGesture = useCallback(() => {
    completionScrollAllowedRef.current = false;
    externalTurnAutoFollowRef.current = false;
    autoFollowMagnetRef.current = false;
    setScrollMagnetEngaged(false);
  }, [autoFollowMagnetRef, completionScrollAllowedRef, externalTurnAutoFollowRef]);

  const markUserScrollIntent = useCallback(
    (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (!SCROLL_KEYS.has(event.key)) return;
        if (
          event.target instanceof Element &&
          event.target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")
        )
          return;
      }
      const container = scrollContainerRef.current;
      if (container) lastScrollTopRef.current = container.scrollTop;
      userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;

      // Explicit upward gestures release the follow magnet immediately. Waiting
      // for scroll-position deltas loses during streaming: every follow frame
      // refreshes the programmatic-scroll guard, so a small user scroll-up gets
      // swallowed and the view snaps back down.
      const isUpwardGesture =
        (event instanceof WheelEvent && event.deltaY < 0 && !event.ctrlKey) || // ctrl+wheel = pinch-zoom, not scroll
        (event instanceof KeyboardEvent && isUpwardScrollKey(event.key));
      if (isUpwardGesture) disengageAutoFollowForExplicitUpwardGesture();
    },
    [disengageAutoFollowForExplicitUpwardGesture, lastScrollTopRef, scrollContainerRef, userScrollIntentUntilRef],
  );

  const handleTouchStart = useCallback(
    (event: TouchEvent) => {
      touchStartClientYRef.current = event.touches[0]?.clientY ?? null;
      markUserScrollIntent(event);
    },
    [markUserScrollIntent, touchStartClientYRef],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      const currentClientY = event.touches[0]?.clientY;
      if (currentClientY === undefined || !isUpwardTouchGesture(touchStartClientYRef.current, currentClientY)) return;
      markUserScrollIntent(event);
      disengageAutoFollowForExplicitUpwardGesture();
      touchStartClientYRef.current = currentClientY;
    },
    [disengageAutoFollowForExplicitUpwardGesture, markUserScrollIntent, touchStartClientYRef],
  );

  const handleTouchEnd = useCallback(() => {
    touchStartClientYRef.current = null;
  }, [touchStartClientYRef]);

  const handleScrollPositionChange = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const previousScrollTop = lastScrollTopRef.current;
    const currentScrollTop = container.scrollTop;
    lastScrollTopRef.current = currentScrollTop;
    updateScrollPresence();
    if (!agentRunningRef.current) {
      // Idle upward movement normally disengages the magnet so the next run
      // does not unexpectedly resume auto-follow. During session transitions,
      // the policy filters synthetic movement but still accepts explicit user
      // input. Scrolling back to the bottom re-engages the magnet.
      const now = Date.now();
      if (
        shouldDisengageScrollMagnet({
          previousScrollTop,
          currentScrollTop,
          now,
          userIntentUntil: userScrollIntentUntilRef.current,
          sessionChangeIgnoreUntil: sessionChangeIgnoreScrollUntilRef.current,
        })
      ) {
        autoFollowMagnetRef.current = false;
        setScrollMagnetEngaged(false);
      } else if (now >= sessionChangeIgnoreScrollUntilRef.current && isNearBottomExcludingSpacer(container)) {
        autoFollowMagnetRef.current = true;
        setScrollMagnetEngaged(true);
      }
      return;
    }
    const now = Date.now();
    // Local prompts deliberately move the user's message to the top; retain
    // the old programmatic-scroll guard for that path. During external
    // auto-follow, explicit upward input must win even while follow frames are
    // producing their own scroll events.
    if (
      shouldStopChatAutoFollow({
        previousScrollTop,
        currentScrollTop,
        now,
        userIntentUntil: userScrollIntentUntilRef.current,
        programmaticScrollUntil: ignoreProgrammaticScrollUntilRef.current,
        externalAutoFollow: externalTurnAutoFollowRef.current,
      })
    ) {
      completionScrollAllowedRef.current = false;
      externalTurnAutoFollowRef.current = false;
      // shouldStopChatAutoFollow only accepts explicit user intent, so it must
      // win even while a session-transition guard is active.
      autoFollowMagnetRef.current = false;
      setScrollMagnetEngaged(false);
    }
  }, [
    agentRunningRef,
    autoFollowMagnetRef,
    completionScrollAllowedRef,
    externalTurnAutoFollowRef,
    ignoreProgrammaticScrollUntilRef,
    lastScrollTopRef,
    scrollContainerRef,
    sessionChangeIgnoreScrollUntilRef,
    updateScrollPresence,
    userScrollIntentUntilRef,
  ]);
  return {
    markUserScrollIntent,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleScrollPositionChange,
    scrollUserMsgToTop,
    scrollToBottom,
    scrollLiveContentToBottom,
    updateScrollPresence,
    reattachAutoFollow,
  };
}
export type SessionScroll = ReturnType<typeof useSessionScroll>;
