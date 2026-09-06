import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Observe only the current question, so the first paint never measures all pages. */
export function AutoHeight({ children }: { children: ReactNode }) {
  const shell = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
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
  }, []);
  return (
    <div ref={shell} className="t-resize tool-height">
      <div ref={content} className="tool-body-scroll">
        {children}
      </div>
    </div>
  );
}
