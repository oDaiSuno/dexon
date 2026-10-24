import { useLayoutEffect, useRef, useState } from "react";

export function GlideHighlight({
  rowSelector,
  activeIndex,
  visible,
  layoutKey,
  insetX = 4,
  radius = "var(--radius-control)",
}: {
  rowSelector: string;
  activeIndex: number;
  visible: boolean;
  layoutKey?: unknown;
  insetX?: number;
  radius?: string;
}) {
  const selfRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ top: number; height: number; glide: boolean } | null>(null);

  useLayoutEffect(() => {
    const container = selfRef.current?.parentElement;
    if (!container) return;
    const target = container.querySelectorAll<HTMLElement>(rowSelector)[activeIndex];
    setBox((previous) =>
      target ? { top: target.offsetTop, height: target.offsetHeight, glide: previous !== null } : null,
    );
    target?.scrollIntoView?.({ block: "nearest" });
  }, [rowSelector, activeIndex, layoutKey]);

  const easing = "var(--ease-smooth-out, cubic-bezier(0.23, 1, 0.32, 1))";
  const glide = "var(--duration-glide, 220ms)";
  return (
    <span
      ref={selfRef}
      aria-hidden
      style={{
        position: "absolute",
        left: insetX,
        right: insetX,
        borderRadius: radius,
        background: "var(--fx-surface-raised-hover)",
        top: box?.top ?? 0,
        height: box?.height ?? 0,
        opacity: box && visible ? 1 : 0,
        transition: box?.glide
          ? `top ${glide} ${easing}, height ${glide} ${easing}, opacity 150ms ease`
          : "opacity 150ms ease",
        pointerEvents: "none",
      }}
    />
  );
}
