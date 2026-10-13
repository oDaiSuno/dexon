import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Observe only the current question, so the first paint never measures all pages. */
export function AutoHeight({ children, visible = true }: { children: ReactNode; visible?: boolean }) {
  const shell = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!visible) return;
    const outer = shell.current;
    const inner = content.current;
    if (!outer || !inner || typeof ResizeObserver === "undefined") return;
    let initialized = false;
    const measure = () => {
      if (!initialized) outer.style.transition = "none";
      outer.style.height = `${inner.getBoundingClientRect().height}px`;
      if (!initialized) {
        void outer.offsetHeight;
        outer.style.transition = "";
        initialized = true;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <div ref={shell} className="t-resize tool-height">
      <div ref={content} className="tool-body-scroll">
        {children}
      </div>
    </div>
  );
}
