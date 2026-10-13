import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { HistoryContentAnchor } from "./use-session-history-anchors";

type HistoryAnchor = {
  element: HTMLDivElement;
  previousScrollHeight: number;
  previousScrollTop: number;
  contentAnchor: HistoryContentAnchor | null;
  generation: number;
  sessionId: string;
  revision: string;
};

type Options = {
  readingVisible: boolean;
  historyGenerationRef: MutableRefObject<number>;
  sessionIdRef: MutableRefObject<string | null>;
  historyRevisionRef: MutableRefObject<string | null>;
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
};

/** Owns reading-side animation frames and deferred history anchor restoration. */
export function useSessionHistoryVisuals({
  readingVisible,
  historyGenerationRef,
  sessionIdRef,
  historyRevisionRef,
  scrollContainerRef,
}: Options) {
  const readingVisibleRef = useRef(readingVisible);
  readingVisibleRef.current = readingVisible;
  const mountedRef = useRef(true);
  const frameIdsRef = useRef<Set<number>>(new Set());
  const pendingAnchorRef = useRef<HistoryAnchor | null>(null);

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

  const restorePendingAnchor = useCallback(() => {
    const anchor = pendingAnchorRef.current;
    if (!anchor || !mountedRef.current || !readingVisibleRef.current) return;
    if (
      anchor.generation !== historyGenerationRef.current ||
      anchor.sessionId !== sessionIdRef.current ||
      anchor.revision !== historyRevisionRef.current
    ) {
      pendingAnchorRef.current = null;
      return;
    }
    const current = scrollContainerRef.current;
    if (!current || current !== anchor.element) {
      pendingAnchorRef.current = null;
      return;
    }
    pendingAnchorRef.current = null;
    if (anchor.contentAnchor) {
      const currentRect = current.getBoundingClientRect();
      const anchorRect = anchor.contentAnchor.element.getBoundingClientRect();
      if (anchor.contentAnchor.element.isConnected !== false && Number.isFinite(anchorRect.top)) {
        current.scrollTop += anchorRect.top - currentRect.top - anchor.contentAnchor.offsetTop;
        return;
      }
    }
    current.scrollTop = anchor.previousScrollTop + (current.scrollHeight - anchor.previousScrollHeight);
  }, [historyGenerationRef, historyRevisionRef, scrollContainerRef, sessionIdRef]);

  const queueHistoryAnchor = useCallback(
    (anchor: HistoryAnchor) => {
      pendingAnchorRef.current = anchor;
      scheduleVisualFrame(restorePendingAnchor);
    },
    [restorePendingAnchor, scheduleVisualFrame],
  );

  useEffect(() => {
    if (readingVisible && pendingAnchorRef.current) scheduleVisualFrame(restorePendingAnchor);
  }, [readingVisible, restorePendingAnchor, scheduleVisualFrame]);

  return { readingVisibleRef, scheduleVisualFrame, queueHistoryAnchor };
}
