import type { ChatViewportController } from "@/lib/chat-viewport";
import { alignReadingPosition, readReadingAnchorOffset, type ReadingAnchor } from "@/lib/reading-anchor";
import type { AgentMessage } from "@/lib/types";
import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";

type HistoryAnchor = {
  element: HTMLDivElement;
  previousScrollHeight: number;
  previousScrollTop: number;
  contentAnchor: ReadingAnchor | null;
  generation: number;
  sessionId: string;
  revision: string;
  onSettled?: () => void;
};

type Options = {
  readingVisible: boolean;
  messages: AgentMessage[];
  historyGenerationRef: MutableRefObject<number>;
  sessionIdRef: MutableRefObject<string | null>;
  historyRevisionRef: MutableRefObject<string | null>;
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  userScrollIntentUntilRef: MutableRefObject<number>;
  viewport?: ChatViewportController;
};

/** Owns reading-side animation frames and deferred history anchor restoration. */
export function useSessionHistoryVisuals({
  readingVisible,
  messages,
  historyGenerationRef,
  sessionIdRef,
  historyRevisionRef,
  scrollContainerRef,
  userScrollIntentUntilRef,
  viewport,
}: Options) {
  const readingVisibleRef = useRef(readingVisible);
  readingVisibleRef.current = readingVisible;
  const mountedRef = useRef(true);
  const frameIdsRef = useRef<Set<number>>(new Set());
  const pendingAnchorRef = useRef<HistoryAnchor | null>(null);
  const commitAnchorRef = useRef<HistoryAnchor | null>(null);
  const cancelAlignmentRef = useRef<(() => void) | null>(null);

  const cancelFrames = useCallback(() => {
    for (const frameId of frameIdsRef.current) globalThis.cancelAnimationFrame?.(frameId);
    frameIdsRef.current.clear();
  }, []);

  useEffect(() => {
    if (readingVisible) return;
    cancelFrames();
  }, [cancelFrames, readingVisible]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelFrames();
      cancelAlignmentRef.current?.();
      cancelAlignmentRef.current = null;
    };
  }, [cancelFrames]);

  const scheduleVisualFrame = useCallback((callback: () => void): number | null => {
    if (!mountedRef.current || !readingVisibleRef.current || typeof globalThis.requestAnimationFrame !== "function") {
      return null;
    }
    let frameId = 0;
    let callbackRan = false;
    frameId = globalThis.requestAnimationFrame(() => {
      callbackRan = true;
      frameIdsRef.current.delete(frameId);
      if (mountedRef.current && readingVisibleRef.current) callback();
    });
    if (!callbackRan && mountedRef.current && readingVisibleRef.current) frameIdsRef.current.add(frameId);
    return frameId;
  }, []);

  const settle = useCallback((anchor: HistoryAnchor) => {
    anchor.onSettled?.();
  }, []);

  const fallBackToHeightDelta = useCallback((anchor: HistoryAnchor) => {
    const container = anchor.element;
    container.scrollTop = anchor.previousScrollTop + (container.scrollHeight - anchor.previousScrollHeight);
  }, []);

  const restorePendingAnchor = useCallback(() => {
    const anchor = pendingAnchorRef.current;
    if (!anchor || !mountedRef.current) return;
    if (
      anchor.generation !== historyGenerationRef.current ||
      anchor.sessionId !== sessionIdRef.current ||
      anchor.revision !== historyRevisionRef.current ||
      scrollContainerRef.current !== anchor.element
    ) {
      pendingAnchorRef.current = null;
      settle(anchor);
      return;
    }
    if (!readingVisibleRef.current) {
      settle(anchor);
      return;
    }
    pendingAnchorRef.current = null;
    if (viewport?.isNavigationActive()) {
      settle(anchor);
      return;
    }
    const container = anchor.element;
    const contentAnchor = anchor.contentAnchor;
    if (!contentAnchor || readReadingAnchorOffset(container, contentAnchor.key) === null) {
      fallBackToHeightDelta(anchor);
      settle(anchor);
      return;
    }
    const intentBaseline = userScrollIntentUntilRef.current;
    const lease = viewport?.claim("history-anchor");
    cancelAlignmentRef.current?.();
    const cancel = alignReadingPosition({
      container,
      target: contentAnchor.offsetTop,
      measure: () => readReadingAnchorOffset(container, contentAnchor.key),
      shouldStop: () =>
        !mountedRef.current ||
        !readingVisibleRef.current ||
        anchor.generation !== historyGenerationRef.current ||
        anchor.sessionId !== sessionIdRef.current ||
        anchor.revision !== historyRevisionRef.current ||
        (lease ? !lease.isCurrent() : userScrollIntentUntilRef.current > intentBaseline),
      onSettled: (outcome) => {
        cancelAlignmentRef.current = null;
        lease?.finish({ outcome });
        settle(anchor);
      },
    });
    cancelAlignmentRef.current = cancel;
    lease?.onAbort(cancel);
  }, [
    fallBackToHeightDelta,
    historyGenerationRef,
    historyRevisionRef,
    scrollContainerRef,
    sessionIdRef,
    settle,
    userScrollIntentUntilRef,
    viewport,
  ]);

  const queueHistoryAnchor = useCallback(
    (anchor: HistoryAnchor, afterCommit = false) => {
      cancelAlignmentRef.current?.();
      cancelAlignmentRef.current = null;
      if (!readingVisibleRef.current) {
        commitAnchorRef.current = null;
        pendingAnchorRef.current = anchor;
        settle(anchor);
        return;
      }
      if (afterCommit) {
        pendingAnchorRef.current = null;
        commitAnchorRef.current = anchor;
        return;
      }
      commitAnchorRef.current = null;
      pendingAnchorRef.current = anchor;
      scheduleVisualFrame(restorePendingAnchor);
    },
    [restorePendingAnchor, scheduleVisualFrame, settle],
  );

  useLayoutEffect(() => {
    const anchor = commitAnchorRef.current;
    if (!anchor) return;
    commitAnchorRef.current = null;
    pendingAnchorRef.current = anchor;
    if (!readingVisibleRef.current) {
      settle(anchor);
      return;
    }
    scheduleVisualFrame(restorePendingAnchor);
  }, [messages, restorePendingAnchor, scheduleVisualFrame, settle]);

  useEffect(() => {
    if (readingVisible && pendingAnchorRef.current) scheduleVisualFrame(restorePendingAnchor);
  }, [readingVisible, restorePendingAnchor, scheduleVisualFrame]);

  return { readingVisibleRef, scheduleVisualFrame, queueHistoryAnchor };
}
