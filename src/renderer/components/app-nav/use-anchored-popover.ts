import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

const MARGIN = 8;
const GAP = 4;

const openPopovers = new Set<() => void>();

export function useAnchoredPopover(width: number) {
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const open = position !== null;
  const dismiss = useCallback(() => setPosition(null), []);

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    for (const dismissOther of [...openPopovers]) if (dismissOther !== dismiss) dismissOther();
    setPosition({
      top: rect.bottom + GAP,
      left: Math.max(MARGIN, Math.min(rect.right - width, window.innerWidth - width - MARGIN)),
    });
  };

  const close = () => {
    setPosition(null);
    triggerRef.current?.focus();
  };

  const choose = (run: () => void) => {
    close();
    run();
  };

  useEffect(() => {
    if (!open) return;
    openPopovers.add(dismiss);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setPosition(null);
    };
    const onDismiss = (event: Event) => {
      if (!popoverRef.current?.contains(event.target as Node)) setPosition(null);
    };
    const onResize = () => setPosition(null);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onResize);
    return () => {
      openPopovers.delete(dismiss);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, dismiss]);

  const closeOnEscapeOrTab = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    if (event.key !== "Escape" && event.key !== "Tab") return false;
    event.preventDefault();
    event.stopPropagation();
    close();
    return true;
  };

  return { position, open, triggerRef, popoverRef, show, close, choose, closeOnEscapeOrTab };
}
