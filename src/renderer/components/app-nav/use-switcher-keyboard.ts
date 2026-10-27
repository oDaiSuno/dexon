import { useEffect, useRef } from "react";

function insideMenu(node: Node | null): boolean {
  for (let current = node as HTMLElement | null; current; current = current.parentElement) {
    if (current.getAttribute("role") === "menu") return true;
  }
  return false;
}

export function useSwitcherKeyboard(runKey: (key: string) => boolean): void {
  const runKeyRef = useRef(runKey);
  useEffect(() => {
    runKeyRef.current = runKey;
  });

  useEffect(() => {
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || insideMenu(event.target as Node | null)) return;
      if (!runKeyRef.current(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, []);
}
