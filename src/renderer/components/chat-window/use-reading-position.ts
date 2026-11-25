import type { ChatViewportController, ViewportLease } from "@/lib/chat-viewport";
import {
  READING_ANCHOR_ATTRIBUTE,
  captureReadingAnchor,
  clampedReadingOffset,
  readReadingAnchorHeight,
  readReadingAnchorOffset,
} from "@/lib/reading-anchor";
import type { ReadingPosition, ReadingPositionRegistry } from "@/lib/reading-position-store";
import type { AgentMessage } from "@/lib/types";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const PERSISTED_KEY = /^entry:.+?:(?=message|process|answer|failure|turn)/;

function persistedAnchor(container: HTMLElement | null): ReadingPosition | null {
  const anchor = captureReadingAnchor(container);
  return anchor && PERSISTED_KEY.test(anchor.key) ? anchor : null;
}

function messageOffset(container: HTMLElement, key: string): number | null {
  const exact = readReadingAnchorOffset(container, key);
  if (exact !== null) return exact;
  const message = PERSISTED_KEY.exec(key)?.[0];
  return message ? prefixOffset(container, message) : null;
}

function prefixOffset(container: HTMLElement, prefix: string): number | null {
  for (const element of container.querySelectorAll<HTMLElement>(`[${READING_ANCHOR_ATTRIBUTE}]`)) {
    if (!element.getAttribute(READING_ANCHOR_ATTRIBUTE)?.startsWith(prefix)) continue;
    return element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  }
  return null;
}

function messagePresent(container: HTMLElement, key: string): boolean {
  const message = PERSISTED_KEY.exec(key)?.[0];
  return message ? prefixOffset(container, message) !== null : readReadingAnchorOffset(container, key) !== null;
}

export function useReadingPosition({
  visible,
  sessionId,
  readingPositions,
  restoreReadingPosition,
  messages,
  scrollContainerRef,
  previousCursor,
  loading,
  hasOlder,
  loadingOlder,
  olderHistoryFailed,
  olderHistoryHalted,
  continueOlderHistory,
  settleAtLatest,
  viewport,
}: {
  visible: boolean;
  sessionId: string | null;
  readingPositions?: ReadingPositionRegistry;
  restoreReadingPosition: boolean;
  messages: AgentMessage[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  previousCursor: string | null;
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderHistoryFailed: boolean;
  olderHistoryHalted: boolean;
  continueOlderHistory: () => Promise<unknown>;
  settleAtLatest: () => void;
  viewport: ChatViewportController;
}) {
  const [requested, setRequested] = useState(0);
  const pendingRef = useRef<ReadingPosition | null>(null);
  const positionedRef = useRef(false);
  const restoreStartedRef = useRef(false);
  const restoreLeaseRef = useRef<ViewportLease | null>(null);
  const alignStartedLeaseRef = useRef<ViewportLease | null>(null);
  const frameIdsRef = useRef<Set<number>>(new Set());
  const scrollQueuedRef = useRef(false);
  const lastRequestRef = useRef<{ cursor: string | null; length: number } | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const loadingOlderRef = useRef(loadingOlder);
  loadingOlderRef.current = loadingOlder;

  const cancelFrames = useCallback(() => {
    for (const frameId of frameIdsRef.current) globalThis.cancelAnimationFrame?.(frameId);
    frameIdsRef.current.clear();
    scrollQueuedRef.current = false;
  }, []);

  const scheduleFrame = useCallback((callback: () => void) => {
    if (typeof globalThis.requestAnimationFrame !== "function") return;
    let frameId = 0;
    let callbackRan = false;
    frameId = globalThis.requestAnimationFrame(() => {
      callbackRan = true;
      frameIdsRef.current.delete(frameId);
      if (visibleRef.current) callback();
    });
    if (!callbackRan) frameIdsRef.current.add(frameId);
  }, []);

  useEffect(() => {
    if (!visible) cancelFrames();
  }, [cancelFrames, visible]);

  useEffect(() => {
    return () => {
      cancelFrames();
    };
  }, [cancelFrames]);

  const record = useCallback(() => {
    if (!visibleRef.current || !positionedRef.current || !sessionId || !readingPositions) return;
    if (viewport.isNavigationActive()) return;
    const anchor = persistedAnchor(scrollContainerRef.current);
    if (anchor) readingPositions.set(sessionId, anchor);
  }, [readingPositions, scrollContainerRef, sessionId, viewport]);

  const finish = useCallback(() => {
    if (!pendingRef.current || loadingOlderRef.current) return;
    pendingRef.current = null;
    positionedRef.current = true;
    record();
  }, [record]);

  const ensureRestoreLease = useCallback(() => {
    const existing = restoreLeaseRef.current;
    if (existing && existing.isCurrent()) return existing;
    const lease = viewport.claim("reading-restore", {
      blocksAutoOlder: true,
      releaseAutoFollow: false,
    });
    restoreLeaseRef.current = lease;
    alignStartedLeaseRef.current = null;
    lease.onAbort((byReason) => {
      if (restoreLeaseRef.current === lease) restoreLeaseRef.current = null;
      if (alignStartedLeaseRef.current === lease) alignStartedLeaseRef.current = null;
      if (byReason !== "hidden") {
        pendingRef.current = null;
        positionedRef.current = true;
      }
    });
    return lease;
  }, [viewport]);

  useEffect(() => {
    if (restoreStartedRef.current || positionedRef.current) return;
    const stored = restoreReadingPosition && readingPositions && sessionId ? readingPositions.get(sessionId) : null;
    if (!stored) {
      positionedRef.current = true;
      return;
    }
    if (!visible) return;
    restoreStartedRef.current = true;
    pendingRef.current = { key: stored.key, offsetTop: stored.offsetTop };
    ensureRestoreLease();
    setRequested((count) => count + 1);
  }, [ensureRestoreLease, readingPositions, restoreReadingPosition, sessionId, visible]);

  useEffect(() => {
    const target = pendingRef.current;
    const container = scrollContainerRef.current;
    if (!visible || !target || loading || !container) return;
    const lease = ensureRestoreLease();
    if (messagePresent(container, target.key)) {
      if (loadingOlder || alignStartedLeaseRef.current === lease) return;
      alignStartedLeaseRef.current = lease;
      viewport.navigateLease(lease, {
        container,
        targetOffset: () => clampedReadingOffset(target.offsetTop, readReadingAnchorHeight(container, target.key)),
        measure: () => messageOffset(container, target.key),
        preferSmooth: false,
        onSettled: (outcome) => {
          if (restoreLeaseRef.current === lease) restoreLeaseRef.current = null;
          if (alignStartedLeaseRef.current === lease) alignStartedLeaseRef.current = null;
          if (
            (outcome === "settled" || outcome === "clamped") &&
            visibleRef.current &&
            messageOffset(container, target.key) !== null
          ) {
            finish();
          }
        },
      });
      return;
    }
    if (loadingOlder || olderHistoryFailed) return;
    if (!hasOlder || olderHistoryHalted) {
      restoreLeaseRef.current = null;
      alignStartedLeaseRef.current = null;
      pendingRef.current = null;
      positionedRef.current = true;
      lease.finish({ outcome: "missing" });
      settleAtLatest();
      record();
      return;
    }
    const lastRequest = lastRequestRef.current;
    if (lastRequest && lastRequest.cursor === previousCursor && lastRequest.length === messages.length) return;
    lastRequestRef.current = { cursor: previousCursor, length: messages.length };
    void continueOlderHistory();
  }, [
    continueOlderHistory,
    ensureRestoreLease,
    finish,
    hasOlder,
    loading,
    loadingOlder,
    messages,
    olderHistoryFailed,
    olderHistoryHalted,
    previousCursor,
    record,
    requested,
    scrollContainerRef,
    settleAtLatest,
    viewport,
    visible,
  ]);

  useEffect(() => {
    let wasNavigating = viewport.isNavigationActive();
    return viewport.subscribe(() => {
      const navigating = viewport.isNavigationActive();
      if (wasNavigating && !navigating && positionedRef.current && visibleRef.current) {
        scheduleFrame(record);
      }
      wasNavigating = navigating;
    });
  }, [record, scheduleFrame, viewport]);

  useEffect(() => {
    if (!visible) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      if (scrollQueuedRef.current) return;
      scrollQueuedRef.current = true;
      scheduleFrame(() => {
        scrollQueuedRef.current = false;
        if (!pendingRef.current) {
          record();
        }
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [loading, messages.length, record, scheduleFrame, scrollContainerRef, visible]);
}
