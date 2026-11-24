import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { QuoteReference } from "@shared/quote-tokens";
import { QuotePreviewCard } from "./quote-preview-card";

const activeAnchors = new WeakSet<HTMLElement>();

interface Preview {
  quote: QuoteReference;
  anchor: HTMLElement;
  detached: boolean;
  pinned: boolean;
}

export function useQuotePreview() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    cancel();
    setPreview(null);
  }, [cancel]);
  const leave = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => setPreview((current) => (current?.pinned ? current : null)), 100);
  }, [cancel]);
  const hover = useCallback(
    (quote: QuoteReference, anchor: HTMLElement, detached = false) => {
      cancel();
      timer.current = setTimeout(() => {
        if (anchor.isConnected && !activeAnchors.has(anchor))
          setPreview((current) => (current?.pinned ? current : { quote, anchor, detached, pinned: false }));
      }, 250);
    },
    [cancel],
  );
  const toggle = useCallback(
    (quote: QuoteReference, anchor: HTMLElement, detached = false) => {
      cancel();
      setPreview((current) =>
        current?.anchor === anchor && current.pinned ? null : { quote, anchor, detached, pinned: true },
      );
    },
    [cancel],
  );
  useEffect(() => cancel, [cancel]);
  return {
    hover,
    leave,
    close,
    toggle,
    portal: preview ? (
      <FloatingQuotePreview preview={preview} onClose={close} onEnter={cancel} onLeave={leave} />
    ) : null,
  };
}

export function FloatingQuotePreview({
  preview,
  onClose,
  onEnter,
  onLeave,
  dismissOnScroll = false,
}: {
  preview: Preview;
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
  dismissOnScroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const doc = preview.anchor.ownerDocument;
  useLayoutEffect(() => {
    activeAnchors.add(preview.anchor);
    return () => {
      activeAnchors.delete(preview.anchor);
    };
  }, [preview.anchor]);
  useLayoutEffect(() => {
    const card = ref.current;
    const win = doc.defaultView;
    if (!card || !win) return;
    const update = () => {
      if (!preview.anchor.isConnected) return onClose();
      const anchor = preview.anchor.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      const below = win.innerHeight - anchor.bottom;
      const above = anchor.top;
      const available = Math.max(0, Math.max(above, below) - 16);
      card.style.maxHeight = `${Math.min(win.innerHeight - 16, available)}px`;
      const height = Math.min(rect.height, available);
      const top = above >= height + 8 || above > below ? anchor.top - height - 8 : anchor.bottom + 8;
      setPosition({
        left: Math.max(8, Math.min(anchor.left, win.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(top, win.innerHeight - height - 8)),
      });
    };
    update();
    win.addEventListener("resize", update);
    const onScroll = dismissOnScroll ? onClose : update;
    doc.addEventListener("scroll", onScroll, true);
    return () => {
      win.removeEventListener("resize", update);
      doc.removeEventListener("scroll", onScroll, true);
    };
  }, [dismissOnScroll, doc, onClose, preview]);
  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !preview.anchor.contains(target)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    doc.addEventListener("pointerdown", outside);
    doc.addEventListener("click", outside);
    doc.addEventListener("keydown", escape, true);
    return () => {
      doc.removeEventListener("pointerdown", outside);
      doc.removeEventListener("click", outside);
      doc.removeEventListener("keydown", escape, true);
    };
  }, [doc, onClose, preview.anchor]);
  return createPortal(
    <div
      ref={ref}
      className="quote-preview-floating"
      style={position}
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <QuotePreviewCard quote={preview.quote} detached={preview.detached} />
    </div>,
    doc.body,
  );
}
