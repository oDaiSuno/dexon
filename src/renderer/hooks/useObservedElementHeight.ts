import { useLayoutEffect, useRef, useState, type RefObject } from "react";

type ResizeObserverFactory = new (callback: ResizeObserverCallback) => Pick<ResizeObserver, "observe" | "disconnect">;

export function observedElementHeight(element: Pick<HTMLElement, "clientHeight">): number {
  return Math.max(0, Math.round(element.clientHeight));
}

export function observeElementHeight(
  element: HTMLElement,
  onHeight: (height: number) => void,
  Observer: ResizeObserverFactory | undefined = globalThis.ResizeObserver,
  enabled = true,
): () => void {
  if (!enabled) return () => {};
  const publish = () => onHeight(observedElementHeight(element));
  publish();
  if (!Observer) return () => {};
  const observer = new Observer(publish);
  observer.observe(element);
  return () => observer.disconnect();
}

export function useObservedElementHeight(ref: RefObject<HTMLElement | null>, fallback = 0, enabled = true): number {
  const [height, setHeight] = useState(fallback);
  const observedElementRef = useRef<HTMLElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const previousFallbackRef = useRef(fallback);
  const previousEnabledRef = useRef(enabled);
  const reconcileRef = useRef<() => void>(() => {});
  reconcileRef.current = () => {
    const element = enabled ? ref.current : null;
    const configurationChanged = fallback !== previousFallbackRef.current || enabled !== previousEnabledRef.current;
    previousFallbackRef.current = fallback;
    previousEnabledRef.current = enabled;
    if (element === observedElementRef.current && !configurationChanged) return;

    cleanupRef.current?.();
    cleanupRef.current = null;
    observedElementRef.current = element;
    if (!element) {
      setHeight(fallback);
      return;
    }
    cleanupRef.current = observeElementHeight(element, setHeight, undefined, enabled);
  };

  // Ref objects do not change identity when React attaches a conditionally
  // rendered element. Reconcile after every render so loading/empty → content
  // transitions attach the observer without requiring a visibility toggle.
  useLayoutEffect(() => {
    reconcileRef.current();
  });

  useLayoutEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      observedElementRef.current = null;
    },
    [],
  );

  return height;
}
