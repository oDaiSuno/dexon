import { alignReadingPosition, readReadingAnchorOffset, type ReadingAnchor } from "@/lib/reading-anchor";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

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
  historyGenerationRef: MutableRefObject<number>;
  sessionIdRef: MutableRefObject<string | null>;
  historyRevisionRef: MutableRefObject<string | null>;
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  userScrollIntentUntilRef: MutableRefObject<number>;
};

/** Owns reading-side animation frames and deferred history anchor restoration. */
export function useSessionHistoryVisuals({
  readingVisible,
  historyGenerationRef,
  sessionIdRef,
  historyRevisionRef,
  scrollContainerRef,
  userScrollIntentUntilRef,
}: Options) {
  const readingVisibleRef = useRef(readingVisible);
  readingVisibleRef.current = readingVisible;
  const mountedRef = useRef(true);
  const frameIdsRef = useRef<Set<number>>(new Set());
  const pendingAnchorRef = useRef<HistoryAnchor | null>(null);
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
    const container = anchor.element;
    const contentAnchor = anchor.contentAnchor;
    if (!contentAnchor || readReadingAnchorOffset(container, contentAnchor.key) === null) {
      fallBackToHeightDelta(anchor);
      settle(anchor);
      return;
    }
    const intentBaseline = userScrollIntentUntilRef.current;
    cancelAlignmentRef.current?.();
    cancelAlignmentRef.current = alignReadingPosition({
      container,
      target: contentAnchor.offsetTop,
      measure: () => readReadingAnchorOffset(container, contentAnchor.key),
      shouldStop: () =>
        !mountedRef.current ||
        !readingVisibleRef.current ||
        anchor.generation !== historyGenerationRef.current ||
        anchor.sessionId !== sessionIdRef.current ||
        anchor.revision !== historyRevisionRef.current ||
        userScrollIntentUntilRef.current > intentBaseline,
      onSettled: () => {
        cancelAlignmentRef.current = null;
        settle(anchor);
      },
    });
  }, [
    fallBackToHeightDelta,
    historyGenerationRef,
    historyRevisionRef,
    scrollContainerRef,
    sessionIdRef,
    settle,
    userScrollIntentUntilRef,
  ]);

  const queueHistoryAnchor = useCallback(
    (anchor: HistoryAnchor) => {
      cancelAlignmentRef.current?.();
      cancelAlignmentRef.current = null;
      pendingAnchorRef.current = anchor;
      if (!readingVisibleRef.current) {
        settle(anchor);
        return;
      }
      scheduleVisualFrame(restorePendingAnchor);
    },
    [restorePendingAnchor, scheduleVisualFrame, settle],
  );

  useEffect(() => {
    if (readingVisible && pendingAnchorRef.current) scheduleVisualFrame(restorePendingAnchor);
  }, [readingVisible, restorePendingAnchor, scheduleVisualFrame]);

  return { readingVisibleRef, scheduleVisualFrame, queueHistoryAnchor };
}
