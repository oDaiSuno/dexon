import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The PlusMenu gliding highlight, shared: one background pill that floats
 * between the rows of a flat menu (＋ menu, skill picker) instead of per-row
 * background toggling. Measures the active row via `rowSelector` inside
 * `containerRef` and transitions top/height with the glide easing; fades in
 * only while `visible` (hover/keyboard engagement).
 */
export function GlideHighlight({
  containerRef,
  rowSelector,
  activeIndex,
  visible,
  insetX = 4,
}: {
  containerRef: RefObject<HTMLElement | null>;
  rowSelector: string;
  activeIndex: number;
  visible: boolean;
  /** Horizontal inset from the container edge; 0 when the rows live in a
   *  scroll container that is itself already inset by the panel padding. */
  insetX?: number;
}) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>(rowSelector));
    const target = rows[activeIndex];
    setBox(target ? { top: target.offsetTop, height: target.offsetHeight } : null);
    // Keyboard navigation keeps the active row in view.
    target?.scrollIntoView?.({ block: "nearest" });
  }, [containerRef, rowSelector, activeIndex]);

  const easing = "var(--ease-smooth-out, cubic-bezier(0.23, 1, 0.32, 1))";
  const glide = "var(--duration-glide, 220ms)";
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: insetX,
        right: insetX,
        borderRadius: 6,
        background: "var(--bg-hover)",
        top: box?.top ?? 0,
        height: box?.height ?? 0,
        opacity: box && visible ? 1 : 0,
        transition: `top ${glide} ${easing}, height ${glide} ${easing}, opacity 150ms ease`,
        pointerEvents: "none",
      }}
    />
  );
}
