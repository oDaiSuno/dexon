import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { QuoteReference } from "@shared/quote-tokens";
import { SCROLL_KEYS } from "@/hooks/agent-session/shared";
import { marksChatScrollIntent } from "@/hooks/chat-scroll-policy";
import type { TurnJumpHandle } from "./use-older-history";
import { revealQuoteTarget } from "./quote-jump-target";
import { quoteScopeKey } from "../messages/quote-interaction";

interface PendingQuote {
  quote: QuoteReference;
  key: string;
  anchorEl: HTMLElement | null;
}

export interface DetachedQuotePreview {
  quote: QuoteReference;
  anchorEl: HTMLElement;
}

export function useQuoteJump({
  visible,
  sessionId,
  scrollContainerRef,
  loadedEntryIds,
  hasOlder,
  turnJump,
  disengageAutoFollow,
}: {
  visible: boolean;
  sessionId: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  loadedEntryIds: readonly string[];
  hasOlder: boolean;
  turnJump: TurnJumpHandle;
  disengageAutoFollow: () => void;
}) {
  const { requestTurn, cancelJump, jumpTarget, arrivedTurn } = turnJump;
  const [pending, setPending] = useState<PendingQuote | null>(null);
  const pendingRef = useRef<PendingQuote | null>(null);
  const [jumpingQuoteKey, setJumpingQuoteKey] = useState<string | null>(null);
  const [detachedQuoteKeys, setDetachedQuoteKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [detachedPreview, setDetachedPreview] = useState<DetachedQuotePreview | null>(null);
  const cancelFlash = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousIds = useRef(loadedEntryIds);
  const closeDetachedPreview = useCallback(() => setDetachedPreview(null), []);
  const clearPending = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pendingRef.current = null;
    setPending(null);
    setJumpingQuoteKey(null);
  }, []);
  const stop = useCallback(() => {
    cancelFlash.current?.();
    cancelFlash.current = null;
    clearPending();
    cancelJump();
  }, [cancelJump, clearPending]);
  const detach = useCallback((target: PendingQuote) => {
    setDetachedQuoteKeys((current) => new Set([...current, target.key]));
    if (target.anchorEl?.isConnected) setDetachedPreview({ quote: target.quote, anchorEl: target.anchorEl });
  }, []);
  const reveal = useCallback(
    (quote: QuoteReference, stabilize = false) => {
      const container = scrollContainerRef.current;
      if (!container) return false;
      cancelFlash.current = revealQuoteTarget(container, quote, stabilize);
      return cancelFlash.current !== null;
    },
    [scrollContainerRef],
  );

  const jumpToQuote = useCallback(
    (quote: QuoteReference, anchorEl?: HTMLElement, sourceMessageEntryId?: string) => {
      if (!visible) return;
      stop();
      closeDetachedPreview();
      disengageAutoFollow();
      const target = { quote, key: quoteScopeKey(sourceMessageEntryId, quote.id), anchorEl: anchorEl ?? null };
      if (!quote.entryId || loadedEntryIds.includes(quote.entryId)) {
        if (!reveal(quote)) detach(target);
        return;
      }
      if (!hasOlder) {
        detach(target);
        return;
      }
      pendingRef.current = target;
      setPending(target);
      timer.current = setTimeout(() => {
        if (pendingRef.current === target) setJumpingQuoteKey(target.key);
      }, 150);
      requestTurn(quote.entryId);
    },
    [closeDetachedPreview, detach, disengageAutoFollow, hasOlder, loadedEntryIds, requestTurn, reveal, stop, visible],
  );

  useLayoutEffect(() => {
    if (previousIds.current.some((id) => id && !loadedEntryIds.includes(id))) {
      setDetachedQuoteKeys(new Set());
      closeDetachedPreview();
      cancelFlash.current?.();
    }
    previousIds.current = loadedEntryIds;
  }, [closeDetachedPreview, loadedEntryIds]);

  useEffect(() => {
    stop();
    setDetachedQuoteKeys(new Set());
    closeDetachedPreview();
    return () => {
      cancelFlash.current?.();
      if (timer.current !== null) clearTimeout(timer.current);
      if (pendingRef.current) cancelJump();
      pendingRef.current = null;
    };
  }, [cancelJump, closeDetachedPreview, sessionId, stop]);

  useEffect(() => {
    if (visible) return;
    stop();
    closeDetachedPreview();
  }, [closeDetachedPreview, stop, visible]);

  useEffect(() => {
    if (!visible || !pending) return;
    const entryId = pending.quote.entryId;
    if (entryId && loadedEntryIds.includes(entryId)) {
      clearPending();
      cancelJump();
      if (!reveal(pending.quote, true)) detach(pending);
    } else if (!hasOlder) {
      clearPending();
      cancelJump();
      detach(pending);
    } else if (jumpTarget !== entryId && arrivedTurn !== entryId) {
      clearPending();
    }
  }, [arrivedTurn, cancelJump, clearPending, detach, hasOlder, jumpTarget, loadedEntryIds, pending, reveal, visible]);

  useEffect(() => {
    if (!visible || !pending) return;
    const container = scrollContainerRef.current;
    const win = container?.ownerDocument.defaultView;
    let pointerHeld = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (marksChatScrollIntent(event, SCROLL_KEYS)) stop();
    };
    const onPointerDown = () => {
      pointerHeld = true;
    };
    const onPointerUp = () => {
      pointerHeld = false;
    };
    const onScroll = () => {
      if (pointerHeld) stop();
    };
    container?.addEventListener("wheel", stop, { passive: true });
    container?.addEventListener("touchmove", stop, { passive: true });
    container?.addEventListener("pointerdown", onPointerDown, { passive: true });
    container?.addEventListener("scroll", onScroll, { passive: true });
    win?.addEventListener("keydown", onKeyDown);
    win?.addEventListener("pointerup", onPointerUp);
    win?.addEventListener("pointercancel", onPointerUp);
    return () => {
      container?.removeEventListener("wheel", stop);
      container?.removeEventListener("touchmove", stop);
      container?.removeEventListener("pointerdown", onPointerDown);
      container?.removeEventListener("scroll", onScroll);
      win?.removeEventListener("keydown", onKeyDown);
      win?.removeEventListener("pointerup", onPointerUp);
      win?.removeEventListener("pointercancel", onPointerUp);
    };
  }, [pending, scrollContainerRef, stop, visible]);

  return { jumpToQuote, jumpingQuoteKey, detachedQuoteKeys, detachedPreview, closeDetachedPreview };
}
