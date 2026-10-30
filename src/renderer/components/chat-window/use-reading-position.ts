import { SCROLL_KEYS } from "@/hooks/agent-session/shared";
import { marksChatScrollIntent } from "@/hooks/chat-scroll-policy";
import {
  READING_ANCHOR_ATTRIBUTE,
  alignReadingPosition,
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

function isReaderScrollInput(event: Event): boolean {
  if (event instanceof KeyboardEvent) return marksChatScrollIntent(event, SCROLL_KEYS);
  if (event.type === "pointerdown") return event.target === event.currentTarget;
  return true;
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
}) {
  const [requested, setRequested] = useState(0);
  const pendingRef = useRef<ReadingPosition | null>(null);
  const positionedRef = useRef(false);
  const restoreStartedRef = useRef(false);
  const readerMovedRef = useRef(false);
  const gestureRef = useRef(0);
  const alignRunRef = useRef(0);
  const mountedRef = useRef(true);
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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      alignRunRef.current += 1;
      cancelFrames();
    };
  }, [cancelFrames]);

  const record = useCallback(() => {
    if (!visibleRef.current || !positionedRef.current || !sessionId || !readingPositions) return;
    const anchor = persistedAnchor(scrollContainerRef.current);
    if (anchor) readingPositions.set(sessionId, anchor);
  }, [readingPositions, scrollContainerRef, sessionId]);

  const finish = useCallback(() => {
    if (!pendingRef.current || loadingOlderRef.current) return;
    pendingRef.current = null;
    positionedRef.current = true;
    record();
  }, [record]);

  const align = useCallback(
    (container: HTMLElement, target: ReadingPosition) => {
      const run = ++alignRunRef.current;
      const gesture = gestureRef.current;
      const current = () => mountedRef.current && alignRunRef.current === run && gestureRef.current === gesture;
      alignReadingPosition({
        container,
        target: () => clampedReadingOffset(target.offsetTop, readReadingAnchorHeight(container, target.key)),
        measure: () => messageOffset(container, target.key),
        shouldStop: () => !visibleRef.current || !current(),
        onSettled: () => {
          if (current() && visibleRef.current && messageOffset(container, target.key) !== null) finish();
        },
      });
    },
    [finish],
  );

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
    setRequested((count) => count + 1);
  }, [readingPositions, restoreReadingPosition, sessionId, visible]);

  useEffect(() => {
    const target = pendingRef.current;
    const container = scrollContainerRef.current;
    if (!visible || !target || loading || !container) return;
    if (messagePresent(container, target.key)) {
      align(container, target);
      return;
    }
    if (loadingOlder || olderHistoryFailed) return;
    if (!hasOlder || olderHistoryHalted) {
      pendingRef.current = null;
      positionedRef.current = true;
      settleAtLatest();
      record();
      return;
    }
    const lastRequest = lastRequestRef.current;
    if (lastRequest && lastRequest.cursor === previousCursor && lastRequest.length === messages.length) return;
    lastRequestRef.current = { cursor: previousCursor, length: messages.length };
    void continueOlderHistory();
  }, [
    align,
    continueOlderHistory,
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
    visible,
  ]);

  const adoptReaderPosition = useCallback(() => {
    const anchor = persistedAnchor(scrollContainerRef.current);
    if (!anchor) {
      pendingRef.current = null;
      positionedRef.current = true;
      return;
    }
    pendingRef.current = anchor;
    setRequested((count) => count + 1);
  }, [scrollContainerRef]);

  useEffect(() => {
    if (!visible) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const onReaderInput = (event: Event) => {
      if (!pendingRef.current || !isReaderScrollInput(event)) return;
      readerMovedRef.current = true;
      gestureRef.current += 1;
      cancelFrames();
    };
    container.addEventListener("wheel", onReaderInput, { passive: true });
    container.addEventListener("touchmove", onReaderInput, { passive: true });
    container.addEventListener("pointerdown", onReaderInput);
    window.addEventListener("keydown", onReaderInput);
    return () => {
      container.removeEventListener("wheel", onReaderInput);
      container.removeEventListener("touchmove", onReaderInput);
      container.removeEventListener("pointerdown", onReaderInput);
      window.removeEventListener("keydown", onReaderInput);
    };
  }, [cancelFrames, loading, messages.length, scrollContainerRef, visible]);

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
          return;
        }
        if (readerMovedRef.current) adoptReaderPosition();
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [adoptReaderPosition, loading, messages.length, record, scheduleFrame, scrollContainerRef, visible]);
}
