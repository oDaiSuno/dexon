import * as React from "react";
import { isImagePath } from "@shared/attachment-tokens";
import type { AtQueryMatch } from "@/lib/file-fuzzy";
import type { CaretEdge, CaretPlacement, ComposerChange, ComposerChangeCause, ComposerEditableHandle } from "./types";
import {
  createSkillChip,
  createTokenChip,
  insertSerializedAttachment,
  insertSerializedText,
  syncChipVisuals,
  syncEditorHeight,
  type PillVisual,
} from "./composer-dom";
import {
  applyComposerEdit,
  planCompleteQuery,
  planInsertAttachment,
  planInsertText,
  planReplaceAll,
  planFillCommandSlot,
  resetComposerContent,
  type ChipFactory,
  type ComposerEdit,
} from "./composer-edit";
import {
  caretEdge,
  placeCaret,
  readSnapshot,
  readComposerText,
  selectionInComposer,
  type ComposerSelection,
  type ComposerTextMap,
} from "./composer-text-map";
import { useComposerEditorEvents } from "./use-composer-editor-events";
import { fillSerializedCommandSlot, type SlashCompletion } from "./command-slot";

/**
 * Native rich-text composer surface. The DOM is the source of truth: text
 * nodes plus atomic chips (attachment `@path`, skill `/skill:name`), all
 * serialized back to literal text so the rest of the app keeps working on
 * the string. Chips are atomic — the caret never enters them; Backspace at a
 * boundary removes the whole chip; the ✕ (hover) removes it; click reveals.
 */
export function ComposerEditable({
  value,
  restoreCaret = "end",
  visible = true,
  handleRef,
  placeholder,
  ariaLabel,
  onChange,
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
  restoreCaret?: CaretPlacement;
  visible?: boolean;
  handleRef: React.MutableRefObject<ComposerEditableHandle | null>;
  placeholder: string;
  ariaLabel?: string;
  onChange: (change: ComposerChange) => void;
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
  const restoreCaretRef = React.useRef(restoreCaret);
  restoreCaretRef.current = restoreCaret;
  const lastSerializedRef = React.useRef(value);
  const previousRestoreRef = React.useRef({ value, restoreCaret });
  const lastSelectionRef = React.useRef<ComposerSelection | null>(null);
  const domMaterializedRef = React.useRef(false);
  const isComposingRef = React.useRef(false);
  const deferredEditsRef = React.useRef<Array<() => void>>([]);
  const propsRef = React.useRef({
    value,
    onChange,
    previewsByPath,
    missingByPath,
    removeLabel,
    skillDescriptions,
    skillRemoveLabel,
  });
  propsRef.current = {
    value,
    onChange,
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

  const chips = React.useMemo<ChipFactory>(
    () => ({
      attachment: (path) => createTokenChip(path, visualFor(path)),
      skill: (name) =>
        createSkillChip(name, {
          description: propsRef.current.skillDescriptions.get(name) ?? null,
          removeLabel: propsRef.current.skillRemoveLabel,
        }),
    }),
    [visualFor],
  );

  const publish = React.useCallback(
    (cause: ComposerChangeCause) => {
      const el = getEditor();
      if (!el) return;
      const snapshot = visibleRef.current
        ? readSnapshot(el)
        : { text: lastSerializedRef.current, masked: lastSerializedRef.current, caret: { kind: "outside" as const } };
      lastSerializedRef.current = snapshot.text;
      if (snapshot.caret.kind === "caret") {
        lastSelectionRef.current = { start: snapshot.caret.offset, end: snapshot.caret.offset };
      } else if (snapshot.caret.kind === "range") {
        lastSelectionRef.current = { start: snapshot.caret.start, end: snapshot.caret.end };
      }
      const effective = cause === "edit" && snapshot.text === propsRef.current.value ? "caret" : cause;
      propsRef.current.onChange({ cause: effective, snapshot });
    },
    [getEditor],
  );

  const resetDom = React.useCallback(
    (text: string, placement: CaretPlacement) => {
      const el = getEditor();
      if (!el) return;
      const hadFocus = el.ownerDocument.activeElement === el;
      resetComposerContent(el, text, chips);
      lastSerializedRef.current = text;
      lastSelectionRef.current = null;
      if (!visibleRef.current) return;
      if (hadFocus) el.focus({ preventScroll: true });
      placeCaret(el, placement);
      syncEditorHeight(el);
    },
    [chips, getEditor],
  );
  const restore = React.useCallback(
    (text: string) => {
      resetDom(text, restoreCaretRef.current);
      publish("restore");
    },
    [publish, resetDom],
  );
  const replaceInBackground = React.useCallback(
    (text: string) => {
      resetDom(text, "end");
      publish("edit");
    },
    [publish, resetDom],
  );

  const edit = React.useCallback(
    (plan: (map: ComposerTextMap, selection: ComposerSelection) => ComposerEdit | null): boolean => {
      const el = getEditor();
      if (!el || !visibleRef.current) return false;
      const map = readComposerText(el);
      const saved = lastSelectionRef.current;
      const end = map.text.length;
      const selection =
        selectionInComposer(el, map) ??
        (saved ? { start: Math.min(saved.start, end), end: Math.min(saved.end, end) } : { start: end, end });
      const request = plan(map, selection);
      if (!request) return false;
      el.focus({ preventScroll: true });
      if (!applyComposerEdit(el, request, chips)) return false;
      syncEditorHeight(el);
      publish("edit");
      return true;
    },
    [chips, getEditor, publish],
  );

  const whenNotComposing = React.useCallback((run: () => void) => {
    if (isComposingRef.current && visibleRef.current) deferredEditsRef.current.push(run);
    else run();
  }, []);
  const flushDeferredEdits = React.useCallback(() => {
    for (const run of deferredEditsRef.current.splice(0)) run();
  }, []);

  const handle = React.useMemo<ComposerEditableHandle>(
    () => ({
      getValue: () => {
        const el = getEditor();
        return visibleRef.current && el ? readComposerText(el).text : lastSerializedRef.current;
      },
      replaceAll: (text: string) =>
        whenNotComposing(() => {
          if (visibleRef.current) edit((map) => planReplaceAll(map, text));
          else replaceInBackground(text);
        }),
      insertTextAtCaret: (text: string) =>
        whenNotComposing(() => {
          if (visibleRef.current) edit((map, selection) => planInsertText(map, selection, text, true));
          else replaceInBackground(insertSerializedText(lastSerializedRef.current, text));
        }),
      pasteTextAtCaret: (text: string) =>
        whenNotComposing(() => {
          edit((map, selection) => planInsertText(map, selection, text, false));
        }),
      insertTokenAtCaret: (path: string) =>
        whenNotComposing(() => {
          if (visibleRef.current) edit((map, selection) => planInsertAttachment(map, selection, path));
          else replaceInBackground(insertSerializedAttachment(lastSerializedRef.current, path));
        }),
      fillCommandSlot: (completion: SlashCompletion) =>
        whenNotComposing(() => {
          if (visibleRef.current) edit((map) => planFillCommandSlot(map, completion));
          else replaceInBackground(fillSerializedCommandSlot(lastSerializedRef.current, completion));
        }),
      completeAtQuery: (atQuery: AtQueryMatch, entryPath: string, isDir: boolean) => {
        edit((map, selection) => planCompleteQuery(map, selection, atQuery, entryPath, isDir));
      },
      focus: () => {
        if (visibleRef.current) getEditor()?.focus();
      },
      caretEdge: (): CaretEdge | null => {
        const el = getEditor();
        return visibleRef.current && el ? caretEdge(el) : null;
      },
      placeCaret: (placement: CaretPlacement) => {
        const el = getEditor();
        if (visibleRef.current && el) placeCaret(el, placement);
      },
    }),
    [edit, getEditor, replaceInBackground, whenNotComposing],
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
    const previous = previousRestoreRef.current;
    previousRestoreRef.current = { value, restoreCaret };
    if (!domMaterializedRef.current || value !== lastSerializedRef.current) {
      domMaterializedRef.current = true;
      restore(value);
    } else if (visible && previous.value === value && previous.restoreCaret !== restoreCaret) {
      placeCaret(el, restoreCaret);
      publish("restore");
    }
    if (visible) syncEditorHeight(el);
  }, [getEditor, publish, restore, restoreCaret, value, visible]);

  React.useEffect(() => {
    if (visible || !isComposingRef.current) return;
    isComposingRef.current = false;
    onCompositionEnd();
    flushDeferredEdits();
  }, [flushDeferredEdits, onCompositionEnd, visible]);

  React.useEffect(() => {
    const el = getEditor();
    if (el) syncChipVisuals(el, visualFor, previewsByPath, missingByPath);
  }, [getEditor, missingByPath, previewsByPath, visualFor]);

  React.useEffect(() => {
    if (!visible) return;
    const el = getEditor();
    if (!el) return;
    const listener = () => {
      if (document.activeElement === el || el.contains(document.activeElement)) publish("caret");
    };
    document.addEventListener("selectionchange", listener);
    return () => document.removeEventListener("selectionchange", listener);
  }, [getEditor, publish, visible]);

  const editorEvents = useComposerEditorEvents({
    visible,
    getEditor,
    edit,
    isComposing: () => isComposingRef.current,
    onKeyDown,
    onRevealToken,
    onSkillReveal,
  });

  return (
    <div
      ref={editorRef}
      className="composer-editor type-chat-input"
      contentEditable={visible}
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      data-placeholder={placeholder}
      data-empty={value === "" ? "" : undefined}
      onInput={(e) => {
        if (!visible) return;
        syncEditorHeight(e.currentTarget);
        publish("edit");
      }}
      onKeyDown={editorEvents.handleEditorKeyDown}
      onPaste={(e) => {
        if (visible) onPaste(e);
      }}
      onCopy={editorEvents.handleCopy}
      onCut={editorEvents.handleCut}
      onMouseDown={editorEvents.handleEditorMouseDown}
      onClick={editorEvents.handleEditorClick}
      onCompositionStart={() => {
        if (!visible) return;
        isComposingRef.current = true;
        onCompositionStart();
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
        if (visible) publish("edit");
        onCompositionEnd();
        flushDeferredEdits();
      }}
    />
  );
}
