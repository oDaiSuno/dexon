import * as React from "react";
import { isImagePath } from "@shared/attachment-tokens";
import type { AtQueryMatch } from "@/lib/file-fuzzy";
import { scaledChatFont } from "@/lib/chat-appearance";
import type { ComposerEditableHandle } from "./types";
import {
  createSkillChip,
  createTokenChip,
  insertSerializedAttachment,
  insertSerializedSkill,
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
  planSkillAtStart,
  resetComposerContent,
  type ChipFactory,
  type ComposerEdit,
} from "./composer-edit";
import {
  readComposerText,
  selectOffsets,
  selectionInComposer,
  type ComposerSelection,
  type ComposerTextMap,
} from "./composer-text-map";
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
  ariaLabel,
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
  ariaLabel?: string;
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
  const lastSelectionRef = React.useRef<ComposerSelection | null>(null);
  const domMaterializedRef = React.useRef(false);
  const isComposingRef = React.useRef(false);
  const deferredEditsRef = React.useRef<Array<() => void>>([]);
  const propsRef = React.useRef({
    onValueChange,
    onSelectionChange,
    previewsByPath,
    missingByPath,
    removeLabel,
    skillDescriptions,
    skillRemoveLabel,
  });
  propsRef.current = {
    onValueChange,
    onSelectionChange,
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

  const publishSerializedValue = React.useCallback((text: string) => {
    lastSerializedRef.current = text;
    propsRef.current.onValueChange(text);
  }, []);
  const serializedValue = React.useCallback(() => {
    const el = getEditor();
    return visibleRef.current && el ? readComposerText(el).text : lastSerializedRef.current;
  }, [getEditor]);
  const emit = React.useCallback(() => {
    publishSerializedValue(serializedValue());
  }, [publishSerializedValue, serializedValue]);
  const notifySelection = React.useCallback(() => {
    const el = getEditor();
    if (!el) return;
    const map = readComposerText(el);
    const selection = selectionInComposer(el, map);
    if (selection) lastSelectionRef.current = selection;
    const collapsed = selection !== null && selection.start === selection.end;
    propsRef.current.onSelectionChange(collapsed ? map.masked.slice(0, selection.start) : "");
  }, [getEditor]);

  const resetContent = React.useCallback(
    (text: string) => {
      const el = getEditor();
      if (!el) return;
      const hadFocus = el.ownerDocument.activeElement === el;
      resetComposerContent(el, text, chips);
      lastSerializedRef.current = text;
      lastSelectionRef.current = null;
      if (!visibleRef.current) return;
      if (hadFocus) el.focus({ preventScroll: true });
      const map = readComposerText(el);
      selectOffsets(el, map, map.text.length, map.text.length);
      syncEditorHeight(el);
    },
    [chips, getEditor],
  );
  const replaceInBackground = React.useCallback(
    (text: string) => {
      resetContent(text);
      publishSerializedValue(text);
    },
    [publishSerializedValue, resetContent],
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
      emit();
      syncEditorHeight(el);
      notifySelection();
      return true;
    },
    [chips, emit, getEditor, notifySelection],
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
      getValue: () => serializedValue(),
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
      insertSkillAtStart: (name: string) =>
        whenNotComposing(() => {
          if (visibleRef.current) edit((map) => planSkillAtStart(map, name));
          else replaceInBackground(insertSerializedSkill(lastSerializedRef.current, name));
        }),
      completeAtQuery: (atQuery: AtQueryMatch, entryPath: string, isDir: boolean) => {
        edit((map, selection) => planCompleteQuery(map, selection, atQuery, entryPath, isDir));
      },
      focus: () => {
        if (visibleRef.current) getEditor()?.focus();
      },
    }),
    [edit, getEditor, replaceInBackground, serializedValue, whenNotComposing],
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
      resetContent(value);
    }
    if (visible) syncEditorHeight(el);
  }, [getEditor, resetContent, value, visible]);

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
      if (document.activeElement === el || el.contains(document.activeElement)) notifySelection();
    };
    document.addEventListener("selectionchange", listener);
    return () => document.removeEventListener("selectionchange", listener);
  }, [getEditor, notifySelection, visible]);

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
      className="composer-editor"
      contentEditable={visible}
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      data-placeholder={placeholder}
      data-empty={value === "" ? "" : undefined}
      style={{ flex: 1, minWidth: 0, fontSize: scaledChatFont(14), lineHeight: 1.6 }}
      onInput={(e) => {
        if (!visible) return;
        emit();
        syncEditorHeight(e.currentTarget);
        notifySelection();
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
        if (visible) emit();
        onCompositionEnd();
        if (visible) notifySelection();
        flushDeferredEdits();
      }}
    />
  );
}
