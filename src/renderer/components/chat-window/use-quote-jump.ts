import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { QuoteReference } from "@shared/quote-tokens";
import type { ChatViewportController, ViewportLease } from "@/lib/chat-viewport";
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
  viewport,
}: {
  visible: boolean;
  sessionId: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  loadedEntryIds: readonly string[];
  hasOlder: boolean;
  turnJump: TurnJumpHandle;
  viewport: ChatViewportController;
}) {
  const { requestTurn, cancelJump, jumpTarget, arrivedTurn } = turnJump;
  const [pending, setPending] = useState<PendingQuote | null>(null);
  const pendingRef = useRef<PendingQuote | null>(null);
  const pendingLeaseRef = useRef<ViewportLease | null>(null);
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
    const lease = pendingLeaseRef.current;
    pendingLeaseRef.current = null;
    clearPending();
    if (lease?.isCurrent()) {
      cancelJump();
      lease.finish({ outcome: "aborted" });
    }
  }, [cancelJump, clearPending]);
  const detach = useCallback((target: PendingQuote) => {
    setDetachedQuoteKeys((current) => new Set([...current, target.key]));
    if (target.anchorEl?.isConnected) setDetachedPreview({ quote: target.quote, anchorEl: target.anchorEl });
  }, []);
  const reveal = useCallback(
    (lease: ViewportLease, quote: QuoteReference, preferSmooth: boolean) => {
      const container = scrollContainerRef.current;
      if (!container) return false;
      cancelFlash.current = revealQuoteTarget(container, quote, viewport, lease, preferSmooth);
      return cancelFlash.current !== null;
    },
    [scrollContainerRef, viewport],
  );

  const jumpToQuote = useCallback(
    (quote: QuoteReference, anchorEl?: HTMLElement, sourceMessageEntryId?: string) => {
      if (!visible) return;
      cancelFlash.current?.();
      cancelFlash.current = null;
      closeDetachedPreview();
      const target = { quote, key: quoteScopeKey(sourceMessageEntryId, quote.id), anchorEl: anchorEl ?? null };
      if (!quote.entryId || loadedEntryIds.includes(quote.entryId)) {
        const lease = viewport.claim("quote-jump", {
          blocksAutoOlder: true,
          releaseAutoFollow: true,
        });
        if (!reveal(lease, quote, true)) {
          lease.finish({ outcome: "missing" });
          detach(target);
        }
        return;
      }
      if (!hasOlder) {
        viewport
          .claim("quote-jump", { blocksAutoOlder: false, releaseAutoFollow: true })
          .finish({ outcome: "missing" });
        detach(target);
        return;
      }
      const lease = viewport.claim("quote-jump", {
        blocksAutoOlder: true,
        releaseAutoFollow: true,
      });
      pendingLeaseRef.current = lease;
      pendingRef.current = target;
      setPending(target);
      timer.current = setTimeout(() => {
        if (pendingRef.current === target) setJumpingQuoteKey(target.key);
      }, 150);
      lease.onAbort(() => {
        if (pendingLeaseRef.current === lease) pendingLeaseRef.current = null;
        clearPending();
        cancelJump();
      });
      requestTurn(quote.entryId);
    },
    [
      cancelJump,
      clearPending,
      closeDetachedPreview,
      detach,
      hasOlder,
      loadedEntryIds,
      requestTurn,
      reveal,
      viewport,
      visible,
    ],
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
      pendingLeaseRef.current = null;
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
      const lease = pendingLeaseRef.current;
      pendingLeaseRef.current = null;
      clearPending();
      cancelJump();
      if (!lease || !lease.isCurrent()) return;
      if (!reveal(lease, pending.quote, false)) {
        lease.finish({ outcome: "missing" });
        detach(pending);
      }
    } else if (!hasOlder) {
      const lease = pendingLeaseRef.current;
      pendingLeaseRef.current = null;
      clearPending();
      cancelJump();
      lease?.finish({ outcome: "missing" });
      detach(pending);
    } else if (jumpTarget !== entryId && arrivedTurn !== entryId) {
      const lease = pendingLeaseRef.current;
      pendingLeaseRef.current = null;
      clearPending();
      lease?.finish({ outcome: "aborted" });
    }
  }, [arrivedTurn, cancelJump, clearPending, detach, hasOlder, jumpTarget, loadedEntryIds, pending, reveal, visible]);

  return { jumpToQuote, jumpingQuoteKey, detachedQuoteKeys, detachedPreview, closeDetachedPreview };
}
