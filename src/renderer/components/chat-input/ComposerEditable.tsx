import * as React from "react";
import { isImagePath, looksLikePath } from "@shared/attachment-tokens";
import { buildAtInsertText, extractAtQuery, type AtQueryMatch } from "@/lib/file-fuzzy";
import { scaledChatFont } from "@/lib/chat-appearance";
import {
  CHIP_SELECTOR,
  SKILL_ATTR,
  buildMaterializePlan,
  caretToEditorEnd as domCaretToEditorEnd,
  createSkillChip,
  createTokenChip,
  isChipEl,
  deleteRangeBeforeCaret,
  insertChipWithSpace,
  insertNodesAtCaret,
  insertSkillChipAtStart,
  isFlat,
  placeCaretByOffset,
  removeChipNode,
  segmentComposerText,
  serializeEditor,
  syncChipVisuals,
  syncEditorHeight,
  textBeforeCaret as domTextBeforeCaret,
  type MaterializePlanEntry,
  type PillVisual,
} from "./composer-dom";

/**
 * Native rich-text composer surface. The DOM is the source of truth: text
 * nodes plus atomic chips (attachment `@path`, skill `/skill:name`), all
 * serialized back to literal text so the rest of the app keeps working on
 * the string. Chips are atomic — the caret never enters them; Backspace at a
 * boundary removes the whole chip; the ✕ (hover) removes it; click reveals.
 */

export interface ComposerEditableHandle {
  getValue(): string;
  /** Replace the whole content (draft restore, programmatic text). */
  setValue(text: string): void;
  /** Insert plain text at the caret (glue-space before, like the TUI). */
  insertTextAtCaret(text: string): void;
  /** Insert a closed attachment chip at the caret (＋ menu, staged images). */
  insertTokenAtCaret(path: string): void;
  /**
   * Place (or replace) a skill chip at message start. Skill commands are
   * expanded by pi only at position 0, so picking a skill always targets
   * the start of the message, not the caret.
   */
  insertSkillAtStart(name: string): void;
  /** Replace the `@query` before the caret with a completed entry (AtMenu). */
  completeAtQuery(atQuery: AtQueryMatch, entryPath: string, isDir: boolean): void;
  textBeforeCaret(): string;
  focus(): void;
}

export function ComposerEditable({
  value,
  handleRef,
  placeholder,
  onValueChange,
  onSelectionChange,
  onKeyDown,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  previewsByPath,
  missingByPath,
  onRevealToken,
  onSkillReveal,
  removeLabel,
  skillDescriptions,
  skillRemoveLabel,
}: {
  value: string;
  handleRef: React.MutableRefObject<ComposerEditableHandle | null>;
  placeholder: string;
  onValueChange: (text: string) => void;
  onSelectionChange: (textBeforeCaret: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (e: React.CompositionEvent<HTMLDivElement>) => void;
  previewsByPath: ReadonlyMap<string, string | null>;
  missingByPath: ReadonlyMap<string, boolean>;
  onRevealToken: (path: string) => void;
  onSkillReveal: (name: string) => void;
  removeLabel: string;
  skillDescriptions: ReadonlyMap<string, string>;
  skillRemoveLabel: string;
}): React.ReactElement {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const lastSerializedRef = React.useRef(value);
  const isComposingRef = React.useRef(false);
  const propsRef = React.useRef({
    onValueChange,
    onSelectionChange,
    onRevealToken,
    onSkillReveal,
    previewsByPath,
    missingByPath,
    removeLabel,
    skillDescriptions,
    skillRemoveLabel,
  });
  propsRef.current = {
    onValueChange,
    onSelectionChange,
    onRevealToken,
    onSkillReveal,
    previewsByPath,
    missingByPath,
    removeLabel,
    skillDescriptions,
    skillRemoveLabel,
  };

  const getEditor = React.useCallback(() => editorRef.current, []);

  const visualFor = React.useCallback(
    (path: string): PillVisual => ({
      isImage: isImagePath(path),
      previewUrl: propsRef.current.previewsByPath.get(path) ?? null,
      missing: propsRef.current.missingByPath.get(path) ?? false,
      title: path,
      removeLabel: propsRef.current.removeLabel,
    }),
    [],
  );

  const createChip = React.useCallback(
    (path: string): HTMLElement => createTokenChip(path, visualFor(path)),
    [visualFor],
  );

  const createSkillChipFor = React.useCallback(
    (name: string): HTMLElement =>
      createSkillChip(name, {
        description: propsRef.current.skillDescriptions.get(name) ?? null,
        removeLabel: propsRef.current.skillRemoveLabel,
      }),
    [],
  );

  const textBeforeCaret = React.useCallback((): string => domTextBeforeCaret(getEditor()), [getEditor]);

  const emit = React.useCallback(() => {
    const el = getEditor();
    if (!el) return;
    const text = serializeEditor(el);
    lastSerializedRef.current = text;
    propsRef.current.onValueChange(text);
  }, [getEditor]);

  const notifySelection = React.useCallback(() => {
    propsRef.current.onSelectionChange(textBeforeCaret());
  }, [textBeforeCaret]);

  /** Rebuild the DOM from a serialized value; caret ends up at the end. */
  const rebuild = React.useCallback(
    (text: string) => {
      const el = getEditor();
      if (!el) return;
      el.textContent = "";
      for (const segment of segmentComposerText(text)) {
        if (segment.type === "text") {
          if (segment.text) el.appendChild(document.createTextNode(segment.text));
        } else if (segment.type === "skill") {
          el.appendChild(createSkillChipFor(segment.name));
        } else {
          el.appendChild(createChip(segment.path));
        }
      }
      lastSerializedRef.current = text;
      domCaretToEditorEnd(el);
      syncEditorHeight(el);
    },
    [createChip, createSkillChipFor, getEditor],
  );

  /** One rewrite target: replace the [start,end) text range with this chip. */
  interface ChipPlanEntry {
    start: number;
    end: number;
    chip: HTMLElement;
  }

  /** Rebuild the flat DOM from `text`, restoring the caret by serialized offset.
   *  `plan` selects which text ranges become chips; open queries stay literal
   *  text so AtMenu/slash completion keep working. */
  const rewritePreservingCaret = React.useCallback(
    (text: string, caretOffset: number, plan: readonly ChipPlanEntry[]) => {
      const el = getEditor();
      if (!el) return;
      el.textContent = "";
      let cursor = 0;
      for (const entry of plan) {
        if (entry.start > cursor) el.appendChild(document.createTextNode(text.slice(cursor, entry.start)));
        el.appendChild(entry.chip);
        cursor = entry.end;
      }
      if (cursor < text.length) el.appendChild(document.createTextNode(text.slice(cursor)));
      lastSerializedRef.current = text;
      placeCaretByOffset(el, caretOffset);
    },
    [getEditor],
  );

  /** Materialization plan for the current flat DOM (chips created fresh). */
  const planFor = React.useCallback(
    (text: string, el: HTMLElement): MaterializePlanEntry[] =>
      buildMaterializePlan(
        text,
        el,
        (path) => createChip(path),
        (name) => createSkillChipFor(name),
      ),
    [createChip, createSkillChipFor],
  );

  /**
   * Turn closed @tokens and the leading closed /skill command that are still
   * plain text into chips. Open trailing queries stay text for completion.
   */
  const materializeTokens = React.useCallback(() => {
    const el = getEditor();
    if (!el) return;
    const text = serializeEditor(el);
    const plan = planFor(text, el);
    if (plan.length === 0) return;
    rewritePreservingCaret(text, textBeforeCaret().length, plan);
  }, [getEditor, planFor, rewritePreservingCaret, textBeforeCaret]);

  /** Flatten stray blocks/BRs left by default browser edits; keep the caret. */
  const normalize = React.useCallback(() => {
    const el = getEditor();
    if (!el || isFlat(el)) return;
    const text = serializeEditor(el);
    rewritePreservingCaret(text, textBeforeCaret().length, planFor(text, el));
  }, [getEditor, planFor, rewritePreservingCaret, textBeforeCaret]);

  const removeChip = React.useCallback(
    (chip: HTMLElement) => {
      const el = getEditor();
      if (!el) return;
      removeChipNode(el, chip);
      emit();
      syncEditorHeight(el);
      notifySelection();
    },
    [emit, getEditor, notifySelection],
  );

  /** Insert nodes at the caret (or editor end); caret collapses after `caretNode`. */
  const insertAtCaret = React.useCallback(
    (nodes: Node[], caretNode: Node | null, caretOffset: number) => {
      const el = getEditor();
      if (!el) return;
      insertNodesAtCaret(el, nodes, caretNode, caretOffset);
      emit();
      materializeTokens();
      syncEditorHeight(el);
      notifySelection();
    },
    [emit, getEditor, materializeTokens, notifySelection],
  );

  const handle = React.useMemo<ComposerEditableHandle>(
    () => ({
      getValue: () => {
        const el = getEditor();
        return el ? serializeEditor(el) : "";
      },
      setValue: (text: string) => {
        rebuild(text);
        propsRef.current.onValueChange(text);
      },
      insertTextAtCaret: (text: string) => {
        const node = document.createTextNode(text);
        insertAtCaret([node], node, text.length);
      },
      insertTokenAtCaret: (path: string) => {
        const chip = createChip(path);
        const space = document.createTextNode(" ");
        insertAtCaret([chip, space], space, 1);
      },
      insertSkillAtStart: (name: string) => {
        const el = getEditor();
        if (!el) return;
        el.focus();
        insertSkillChipAtStart(el, createSkillChipFor(name));
        emit();
        syncEditorHeight(el);
        notifySelection();
      },
      completeAtQuery: (atQuery: AtQueryMatch, entryPath: string, isDir: boolean) => {
        const el = getEditor();
        const sel = window.getSelection();
        if (!el || !sel) return;
        const prefixLength = atQuery.quoted ? atQuery.query.length + 2 : atQuery.query.length + 1;
        // Quoted completion carries its own closing quote — swallow the old one.
        const deleteRange = deleteRangeBeforeCaret(prefixLength, atQuery.quoted);
        if (!deleteRange) return;
        deleteRange.deleteContents();
        if (isDir) {
          const insertion = buildAtInsertText(entryPath, true, atQuery.quoted);
          const node = document.createTextNode(insertion.text);
          deleteRange.insertNode(node);
          const after = document.createRange();
          after.setStart(node, Math.min(insertion.cursorOffset, insertion.text.length));
          after.collapse(true);
          sel.removeAllRanges();
          sel.addRange(after);
        } else {
          insertChipWithSpace(deleteRange, createChip(entryPath));
        }
        emit();
        syncEditorHeight(el);
        notifySelection();
      },
      textBeforeCaret: () => textBeforeCaret(),
      focus: () => getEditor()?.focus(),
    }),
    [createChip, createSkillChipFor, emit, getEditor, insertAtCaret, notifySelection, rebuild, textBeforeCaret],
  );

  React.useEffect(() => {
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, handle]);

  React.useEffect(() => {
    if (value !== lastSerializedRef.current) rebuild(value);
  }, [rebuild, value]);

  React.useEffect(() => {
    // Sync chip visuals when previews/missing state resolve asynchronously.
    const el = getEditor();
    if (el) syncChipVisuals(el, visualFor, previewsByPath, missingByPath);
  }, [getEditor, missingByPath, previewsByPath, visualFor]);

  React.useEffect(() => {
    const el = getEditor();
    if (!el) return;
    const listener = () => {
      if (document.activeElement === el || el.contains(document.activeElement)) notifySelection();
    };
    document.addEventListener("selectionchange", listener);
    return () => document.removeEventListener("selectionchange", listener);
  }, [getEditor, notifySelection]);

  /** Close an in-progress `@query` as a chip (a space was typed after it). */
  const closeQueryAsChip = React.useCallback(
    (query: AtQueryMatch) => {
      const el = getEditor();
      const sel = window.getSelection();
      if (!el || !sel) return;
      const prefixLength = query.quoted ? query.query.length + 2 : query.query.length + 1;
      // The drill-down completion may leave the closing quote after the caret.
      const deleteRange = deleteRangeBeforeCaret(prefixLength, query.quoted);
      if (!deleteRange) return;
      deleteRange.deleteContents();
      insertChipWithSpace(deleteRange, createChip(query.query));
      emit();
      syncEditorHeight(el);
      notifySelection();
    },
    [createChip, emit, getEditor, notifySelection],
  );

  const handleBeforeInputNative = React.useCallback(
    (native: InputEvent) => {
      const el = getEditor();
      const sel = window.getSelection();
      if (!el || !sel || !sel.rangeCount) return;
      if (native.inputType === "insertText" && native.data === " ") {
        // A space typed right after an @path query closes it into a chip,
        // mirroring the TUI where whitespace ends the token reference.
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
        // Keep the DOM flat: a literal "\n" text node renders via pre-wrap.
        native.preventDefault();
        const node = document.createTextNode("\n");
        insertAtCaret([node], node, 1);
        return;
      }
      if (native.inputType !== "deleteContentBackward" && native.inputType !== "deleteContentForward") return;
      if (!sel.isCollapsed) return; // selection deletes are handled by the browser
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
    [closeQueryAsChip, getEditor, insertAtCaret, removeChip, textBeforeCaret],
  );

  React.useEffect(() => {
    const el = getEditor();
    if (!el) return;
    const listener = (event: Event) => handleBeforeInputNative(event as InputEvent);
    el.addEventListener("beforeinput", listener);
    return () => el.removeEventListener("beforeinput", listener);
  }, [getEditor, handleBeforeInputNative]);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => onKeyDown(e);

  const handleEditorMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Keep the caret out of chips: they stay atomic (only remove / reveal).
    if ((e.target as HTMLElement).closest?.(CHIP_SELECTOR)) e.preventDefault();
  };

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const chip = target.closest?.<HTMLElement>(CHIP_SELECTOR);
    if (!chip) return;
    if (target.closest?.("[data-chip-remove]")) {
      e.preventDefault();
      e.stopPropagation();
      removeChip(chip);
      return;
    }
    if (chip.hasAttribute(SKILL_ATTR)) {
      const name = chip.dataset.skillName ?? "";
      if (name) onSkillReveal(name);
      return;
    }
    const path = chip.dataset.path ?? "";
    if (path) onRevealToken(path);
  };

  return (
    <div
      ref={editorRef}
      className="composer-editor"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      style={{ flex: 1, minWidth: 0, fontSize: scaledChatFont(14), lineHeight: 1.6 }}
      onInput={(e) => {
        if (!isComposingRef.current) normalize();
        emit();
        if (!isComposingRef.current) materializeTokens();
        syncEditorHeight(e.currentTarget);
        notifySelection();
      }}
      onKeyDown={handleEditorKeyDown}
      onPaste={onPaste}
      onMouseDown={handleEditorMouseDown}
      onClick={handleEditorClick}
      onCompositionStart={() => {
        isComposingRef.current = true;
        onCompositionStart();
      }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false;
        normalize();
        emit();
        materializeTokens();
        onCompositionEnd(e);
        notifySelection();
      }}
    />
  );
}
