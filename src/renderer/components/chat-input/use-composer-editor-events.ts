import { useCallback, useEffect, type KeyboardEvent, type MouseEvent } from "react";
import { extractAtQuery, type AtQueryMatch } from "@/lib/file-fuzzy";
import { looksLikePath } from "@shared/attachment-tokens";
import { CHIP_SELECTOR, deleteRangeBeforeCaret, insertChipWithSpace, isChipEl } from "./composer-dom";

interface Options {
  visible: boolean;
  getEditor: () => HTMLDivElement | null;
  textBeforeCaret: () => string;
  createChip: (path: string) => HTMLElement;
  emit: () => void;
  syncEditorHeight: (editor: HTMLElement) => void;
  notifySelection: () => void;
  insertAtCaret: (nodes: Node[], caretNode: Node | null, caretOffset: number) => void;
  removeChip: (chip: HTMLElement) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onRevealToken: (path: string) => void;
  onSkillReveal: (name: string) => void;
}

export function useComposerEditorEvents({
  visible,
  getEditor,
  textBeforeCaret,
  createChip,
  emit,
  syncEditorHeight,
  notifySelection,
  insertAtCaret,
  removeChip,
  onKeyDown,
  onRevealToken,
  onSkillReveal,
}: Options) {
  const closeQueryAsChip = useCallback(
    (query: AtQueryMatch) => {
      if (!visible) return;
      const el = getEditor();
      const sel = window.getSelection();
      if (!el || !sel) return;
      const prefixLength = query.quoted ? query.query.length + 2 : query.query.length + 1;
      const deleteRange = deleteRangeBeforeCaret(prefixLength, query.quoted);
      if (!deleteRange) return;
      deleteRange.deleteContents();
      insertChipWithSpace(deleteRange, createChip(query.query));
      emit();
      syncEditorHeight(el);
      notifySelection();
    },
    [createChip, emit, getEditor, notifySelection, syncEditorHeight, visible],
  );

  const handleBeforeInputNative = useCallback(
    (native: InputEvent) => {
      if (!visible) return;
      const el = getEditor();
      const sel = window.getSelection();
      if (!el || !sel || !sel.rangeCount) return;
      if (native.inputType === "insertText" && native.data === " ") {
        const query = extractAtQuery(textBeforeCaret());
        if (query && query.query.length > 0 && looksLikePath(query.query)) {
          const prefixLength = query.quoted ? query.query.length + 2 : query.query.length + 1;
          if (deleteRangeBeforeCaret(prefixLength, false)) {
            native.preventDefault();
            closeQueryAsChip(query);
            return;
          }
        }
      }
      if (native.inputType === "insertParagraph" || native.inputType === "insertLineBreak") {
        native.preventDefault();
        const node = document.createTextNode("\n");
        insertAtCaret([node], node, 1);
        return;
      }
      if (native.inputType !== "deleteContentBackward" && native.inputType !== "deleteContentForward") return;
      if (!sel.isCollapsed) return;
      const { anchorNode, anchorOffset } = sel;
      if (!anchorNode) return;
      const neighbor =
        native.inputType === "deleteContentBackward"
          ? anchorNode === el
            ? (el.childNodes[anchorOffset - 1] ?? null)
            : (anchorNode.previousSibling ??
              (anchorNode.parentNode !== el ? (anchorNode.parentNode?.previousSibling ?? null) : null))
          : anchorNode === el
            ? (el.childNodes[anchorOffset] ?? null)
            : (anchorNode.nextSibling ??
              (anchorNode.parentNode !== el ? (anchorNode.parentNode?.nextSibling ?? null) : null));
      if (!(neighbor instanceof HTMLElement) || !isChipEl(neighbor)) return;
      native.preventDefault();
      removeChip(neighbor);
    },
    [closeQueryAsChip, getEditor, insertAtCaret, removeChip, textBeforeCaret, visible],
  );

  useEffect(() => {
    if (!visible) return;
    const el = getEditor();
    if (!el) return;
    const listener = (event: Event) => handleBeforeInputNative(event as InputEvent);
    el.addEventListener("beforeinput", listener);
    return () => el.removeEventListener("beforeinput", listener);
  }, [getEditor, handleBeforeInputNative, visible]);

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
        removeChip(chip);
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
    [onRevealToken, onSkillReveal, removeChip, visible],
  );

  return { handleEditorKeyDown, handleEditorMouseDown, handleEditorClick };
}

export type ComposerEditorEventsHandle = ReturnType<typeof useComposerEditorEvents>;
