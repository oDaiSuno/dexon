import { useCallback, useEffect, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { CHIP_SELECTOR } from "./composer-dom";
import { insertNativeLineBreak, planCloseTypedReference, planRemoveChip, type ComposerEdit } from "./composer-edit";
import {
  readComposerText,
  selectionInComposer,
  type ComposerSelection,
  type ComposerTextMap,
} from "./composer-text-map";

interface Options {
  visible: boolean;
  getEditor: () => HTMLDivElement | null;
  edit: (plan: (map: ComposerTextMap, selection: ComposerSelection) => ComposerEdit | null) => boolean;
  isComposing: () => boolean;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onRevealToken: (path: string) => void;
  onSkillReveal: (name: string) => void;
}

export function useComposerEditorEvents({
  visible,
  getEditor,
  edit,
  isComposing,
  onKeyDown,
  onRevealToken,
  onSkillReveal,
}: Options) {
  const handleBeforeInputNative = useCallback(
    (native: InputEvent) => {
      if (!visible || isComposing()) return;
      const el = getEditor();
      if (!el) return;
      if (native.inputType === "insertText" && native.data === " ") {
        if (edit(planCloseTypedReference)) native.preventDefault();
        return;
      }
      if (native.inputType === "insertParagraph" && insertNativeLineBreak(el)) native.preventDefault();
    },
    [edit, getEditor, isComposing, visible],
  );

  useEffect(() => {
    if (!visible) return;
    const el = getEditor();
    if (!el) return;
    const listener = (event: Event) => handleBeforeInputNative(event as InputEvent);
    el.addEventListener("beforeinput", listener);
    return () => el.removeEventListener("beforeinput", listener);
  }, [getEditor, handleBeforeInputNative, visible]);

  const copySelection = useCallback(
    (event: ClipboardEvent<HTMLDivElement>): ComposerSelection | null => {
      const el = getEditor();
      if (!visible || !el) return null;
      const map = readComposerText(el);
      const selection = selectionInComposer(el, map);
      if (!selection || selection.start === selection.end) return null;
      event.preventDefault();
      event.clipboardData.setData("text/plain", map.text.slice(selection.start, selection.end));
      return selection;
    },
    [getEditor, visible],
  );

  const handleCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      copySelection(event);
    },
    [copySelection],
  );

  const handleCut = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const selection = copySelection(event);
      if (selection) edit(() => ({ start: selection.start, end: selection.end, content: [] }));
    },
    [copySelection, edit],
  );

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (visible) onKeyDown(event);
    },
    [onKeyDown, visible],
  );

  const handleEditorMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest?.(CHIP_SELECTOR)) event.preventDefault();
  }, []);

  const handleEditorClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!visible) return;
      const target = event.target as HTMLElement;
      const chip = target.closest?.<HTMLElement>(CHIP_SELECTOR);
      if (!chip) return;
      if (target.closest?.("[data-chip-remove]")) {
        event.preventDefault();
        event.stopPropagation();
        edit((map) => planRemoveChip(map, chip));
        return;
      }
      if (chip.dataset.skillToken !== undefined) {
        const name = chip.dataset.skillName ?? "";
        if (name) onSkillReveal(name);
        return;
      }
      const path = chip.dataset.path ?? "";
      if (path) onRevealToken(path);
    },
    [edit, onRevealToken, onSkillReveal, visible],
  );

  return { handleEditorKeyDown, handleEditorMouseDown, handleEditorClick, handleCopy, handleCut };
}

export type ComposerEditorEventsHandle = ReturnType<typeof useComposerEditorEvents>;
