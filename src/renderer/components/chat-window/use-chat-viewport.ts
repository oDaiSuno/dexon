import { SCROLL_KEYS } from "@/hooks/agent-session/shared";
import {
  isScrollbarPointerDown,
  isUpwardScrollKey,
  isUpwardTouchGesture,
  marksChatScrollIntent,
} from "@/hooks/chat-scroll-policy";
import { ChatViewportController } from "@/lib/chat-viewport";
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

interface Options {
  viewport: ChatViewportController;
  visible: boolean;
  sessionId: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onReleaseAutoFollow: () => void;
  containerWatchKey: number;
}

export function useChatViewport({
  viewport,
  visible,
  sessionId,
  scrollContainerRef,
  onReleaseAutoFollow,
  containerWatchKey,
}: Options) {
  const prevSessionIdRef = useRef(sessionId);

  useEffect(() => {
    viewport.setReleaseAutoFollow(onReleaseAutoFollow);
    return () => viewport.setReleaseAutoFollow(null);
  }, [onReleaseAutoFollow, viewport]);

  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      viewport.reset("session-reset");
    }
  }, [sessionId, viewport]);

  useEffect(() => {
    if (!visible) viewport.reset("hidden");
  }, [viewport, visible]);

  useEffect(() => () => viewport.reset("hidden"), [viewport]);

  useEffect(() => {
    if (!visible) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const win = container.ownerDocument.defaultView ?? window;
    let pointerHeld = false;
    let scrollbarHeld = false;
    let touchStartY: number | null = null;
    let lastScrollTop = container.scrollTop;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      viewport.onUserGesture(event.deltaY < 0);
    };

    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      const upward = currentY !== undefined && isUpwardTouchGesture(touchStartY, currentY);
      if (currentY !== undefined && upward) touchStartY = currentY;
      viewport.onUserGesture(upward);
    };

    const onTouchEnd = () => {
      touchStartY = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!marksChatScrollIntent(event, SCROLL_KEYS)) return;
      viewport.onUserGesture(isUpwardScrollKey(event.key));
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerHeld = true;
      lastScrollTop = container.scrollTop;
      if (isScrollbarPointerDown(event, container)) {
        scrollbarHeld = true;
        viewport.onUserGesture(container.scrollTop <= 1);
      }
    };

    const onPointerUp = () => {
      pointerHeld = false;
      scrollbarHeld = false;
    };

    const onScroll = () => {
      const current = container.scrollTop;
      const upward = current < lastScrollTop || (scrollbarHeld && current <= 1);
      lastScrollTop = current;
      if (pointerHeld || scrollbarHeld) {
        viewport.onUserGesture(upward);
      }
    };

    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });
    container.addEventListener("pointerdown", onPointerDown, { passive: true });
    container.addEventListener("scroll", onScroll, { passive: true });
    win.addEventListener("keydown", onKeyDown);
    win.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
    win.addEventListener("pointercancel", onPointerUp, { capture: true, passive: true });

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("scroll", onScroll);
      win.removeEventListener("keydown", onKeyDown);
      win.removeEventListener("pointerup", onPointerUp, { capture: true });
      win.removeEventListener("pointercancel", onPointerUp, { capture: true });
    };
  }, [containerWatchKey, scrollContainerRef, viewport, visible]);

  const autoOlderBlocked = useSyncExternalStore(
    (listener) => viewport.subscribe(listener),
    () => viewport.isAutoOlderBlocked(),
    () => false,
  );

  return { autoOlderBlocked };
}
