import { useCallback, useRef, type KeyboardEvent, type MutableRefObject } from "react";
import { compositionEnterAction } from "./composition-guard";
import type { RecallDirection } from "./composer-buffer";
import type { CaretEdge, ComposerEditableHandle } from "./types";

export type HistoryIntent = "older" | "newer" | "caret-to-start" | "return";

export interface ComposerKeys {
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
}

export function historyIntent(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "metaKey" | "ctrlKey">,
  recalling: boolean,
  edge: () => CaretEdge | null,
): HistoryIntent | null {
  if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return null;
  if (event.key === "Escape") return recalling ? "return" : null;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return null;
  const caret = edge();
  if (!caret || caret.kind === "range") return null;
  if (event.key === "ArrowUp") {
    if (caret.atStart || (recalling && caret.onFirstRow)) return "older";
    return !recalling && caret.onFirstRow ? "caret-to-start" : null;
  }
  return recalling && caret.onLastRow ? "newer" : null;
}

export function useComposerKeys({
  menus,
  recall,
  editableRef,
  onEnter,
}: {
  menus: { handleMenuKey(event: KeyboardEvent<HTMLDivElement>): boolean };
  recall: {
    recalling: boolean;
    browse(direction: RecallDirection): boolean;
    returnToDraft(): boolean;
  };
  editableRef: MutableRefObject<ComposerEditableHandle | null>;
  onEnter: () => void;
}): ComposerKeys {
  const composingRef = useRef(false);
  const endedAtRef = useRef(0);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const native = event.nativeEvent;
      if (event.key === "Enter" && !event.shiftKey) {
        const action = compositionEnterAction(
          native,
          { composing: composingRef.current, endedAt: endedAtRef.current },
          Date.now(),
        );
        if (action !== "send") {
          if (action === "prevent") event.preventDefault();
          return;
        }
      }
      if (composingRef.current || native.isComposing === true || native.keyCode === 229) return;
      if (menus.handleMenuKey(event)) return;
      const intent = historyIntent(event, recall.recalling, () => editableRef.current?.caretEdge() ?? null);
      if (intent === "caret-to-start") {
        editableRef.current?.placeCaret("start");
        event.preventDefault();
        return;
      }
      if (intent === "older" || intent === "newer") {
        if (recall.browse(intent)) event.preventDefault();
        return;
      }
      if (intent === "return") {
        if (recall.returnToDraft()) event.preventDefault();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        onEnter();
      }
    },
    [editableRef, menus, onEnter, recall],
  );

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);
  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
    endedAtRef.current = Date.now();
  }, []);

  return { onKeyDown, onCompositionStart, onCompositionEnd };
}
