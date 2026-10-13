import * as React from "react";
import { isImagePath } from "@shared/attachment-tokens";
import { buildAtInsertText, type AtQueryMatch } from "@/lib/file-fuzzy";
import { scaledChatFont } from "@/lib/chat-appearance";
import type { ComposerEditableHandle } from "./types";
import {
  buildMaterializePlan,
  caretToEditorEnd as domCaretToEditorEnd,
  createSkillChip,
  createTokenChip,
  deleteRangeBeforeCaret,
  insertChipWithSpace,
  insertNodesAtCaret,
  insertSerializedAttachment,
  insertSerializedSkill,
  insertSerializedText,
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
import { useComposerEditorEvents } from "./use-composer-editor-events";
/**
 * Native rich-text composer surface. The DOM is the source of truth: text
 * nodes plus atomic chips (attachment `@path`, skill `/skill:name`), all
 * serialized back to literal text so the rest of the app keeps working on
 * the string. Chips are atomic — the caret never enters them; Backspace at a
 * boundary removes the whole chip; the ✕ (hover) removes it; click reveals.
 */
export function ComposerEditable({
  value,
  visible = true,
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
  visible?: boolean;
  handleRef: React.MutableRefObject<ComposerEditableHandle | null>;
  placeholder: string;
  onValueChange: (text: string) => void;
  onSelectionChange: (textBeforeCaret: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (e?: React.CompositionEvent<HTMLDivElement>) => void;
  previewsByPath: ReadonlyMap<string, string | null>;
  missingByPath: ReadonlyMap<string, boolean>;
  onRevealToken: (path: string) => void;
  onSkillReveal: (name: string) => void;
  removeLabel: string;
  skillDescriptions: ReadonlyMap<string, string>;
  skillRemoveLabel: string;
}): React.ReactElement {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const visibleRef = React.useRef(visible);
  visibleRef.current = visible;
  const lastSerializedRef = React.useRef(value);
  const domMaterializedRef = React.useRef(false);
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

  const publishSerializedValue = React.useCallback((text: string) => {
    lastSerializedRef.current = text;
    propsRef.current.onValueChange(text);
  }, []);
  const serializedValue = React.useCallback(() => {
    const el = getEditor();
    return visibleRef.current && el ? serializeEditor(el) : lastSerializedRef.current;
  }, [getEditor]);
  const emit = React.useCallback(() => {
    const text = serializedValue();
    publishSerializedValue(text);
  }, [publishSerializedValue, serializedValue]);
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
      if (visibleRef.current) {
        domCaretToEditorEnd(el);
        syncEditorHeight(el);
      }
    },
    [createChip, createSkillChipFor, getEditor],
  );
  const applySerializedValue = React.useCallback(
    (text: string) => {
      rebuild(text);
      publishSerializedValue(text);
    },
    [publishSerializedValue, rebuild],
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
      if (!visibleRef.current) return;
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
      if (!visibleRef.current) return;
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
      getValue: () => serializedValue(),
      setValue: (text: string) => {
        applySerializedValue(text);
      },
      insertTextAtCaret: (text: string) => {
        if (!visibleRef.current) {
          applySerializedValue(insertSerializedText(lastSerializedRef.current, text));
          return;
        }
        const node = document.createTextNode(text);
        insertAtCaret([node], node, text.length);
      },
      insertTokenAtCaret: (path: string) => {
        if (!visibleRef.current) {
          applySerializedValue(insertSerializedAttachment(lastSerializedRef.current, path));
          return;
        }
        const chip = createChip(path);
        const space = document.createTextNode(" ");
        insertAtCaret([chip, space], space, 1);
      },
      insertSkillAtStart: (name: string) => {
        if (!visibleRef.current) {
          applySerializedValue(insertSerializedSkill(lastSerializedRef.current, name));
          return;
        }
        const el = getEditor();
        if (!el) return;
        el.focus();
        insertSkillChipAtStart(el, createSkillChipFor(name));
        emit();
        syncEditorHeight(el);
        notifySelection();
      },
      completeAtQuery: (atQuery: AtQueryMatch, entryPath: string, isDir: boolean) => {
        if (!visibleRef.current) return;
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
      focus: () => {
        if (visibleRef.current) getEditor()?.focus();
      },
    }),
    [
      createChip,
      applySerializedValue,
      createSkillChipFor,
      emit,
      getEditor,
      insertAtCaret,
      notifySelection,
      serializedValue,
      textBeforeCaret,
    ],
  );

  React.useEffect(() => {
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, handle]);

  React.useLayoutEffect(() => {
    const el = getEditor();
    if (!el) return;
    if (!domMaterializedRef.current || value !== lastSerializedRef.current) {
      domMaterializedRef.current = true;
      rebuild(value);
    }
    if (visible) syncEditorHeight(el);
  }, [getEditor, rebuild, value, visible]);

  React.useEffect(() => {
    if (visible || !isComposingRef.current) return;
    isComposingRef.current = false;
    onCompositionEnd();
  }, [onCompositionEnd, visible]);

  React.useEffect(() => {
    // Sync chip visuals when previews/missing state resolve asynchronously.
    const el = getEditor();
    if (el) syncChipVisuals(el, visualFor, previewsByPath, missingByPath);
  }, [getEditor, missingByPath, previewsByPath, visualFor]);

  React.useEffect(() => {
    if (!visible) return;
    const el = getEditor();
    if (!el) return;
    const listener = () => {
      if (document.activeElement === el || el.contains(document.activeElement)) notifySelection();
    };
    document.addEventListener("selectionchange", listener);
    return () => document.removeEventListener("selectionchange", listener);
  }, [getEditor, notifySelection, visible]);

  const editorEvents = useComposerEditorEvents({
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
  });

  return (
    <div
      ref={editorRef}
      className="composer-editor"
      contentEditable={visible}
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      style={{ flex: 1, minWidth: 0, fontSize: scaledChatFont(14), lineHeight: 1.6 }}
      onInput={(e) => {
        if (!visible) return;
        if (!isComposingRef.current) normalize();
        emit();
        if (!isComposingRef.current) materializeTokens();
        syncEditorHeight(e.currentTarget);
        notifySelection();
      }}
      onKeyDown={editorEvents.handleEditorKeyDown}
      onPaste={(e) => {
        if (visible) onPaste(e);
      }}
      onMouseDown={editorEvents.handleEditorMouseDown}
      onClick={editorEvents.handleEditorClick}
      onCompositionStart={() => {
        if (!visible) return;
        isComposingRef.current = true;
        onCompositionStart();
      }}
      onCompositionEnd={() => {
        if (!visible) {
          isComposingRef.current = false;
          onCompositionEnd();
          return;
        }
        isComposingRef.current = false;
        normalize();
        emit();
        materializeTokens();
        onCompositionEnd();
        notifySelection();
      }}
    />
  );
}
