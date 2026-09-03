import * as React from "react";
import {
  attachmentTokenText,
  findAttachmentTokens,
  isImagePath,
  looksLikePath,
  segmentByAttachmentTokens,
  type AttachmentToken,
} from "@shared/attachment-tokens";
import { buildAtInsertText, extractAtQuery, type AtQueryMatch } from "@/lib/file-fuzzy";
import { scaledChatFont } from "@/lib/chat-appearance";
import { TOKEN_ATTR, createTokenChip, fillChipContent, isFlat, serializeEditor, type PillVisual } from "./composer-dom";

/**
 * Native rich-text composer surface. The DOM is the source of truth: plain
 * text nodes plus atomic attachment chips (`contenteditable="false"`).
 * Serialization maps chips back to literal `@path` tokens, so the rest of the
 * app (send pipeline, drafts, menus, transcript parsing) keeps working on the
 * serialized string.
 *
 * Reference behavior (Cursor-style): chips are atomic — the caret can never
 * enter them, Backspace/Delete at a boundary removes the whole chip, clicking
 * a chip reveals the file in the OS file manager, and the ✕ button (revealed
 * on hover) removes it.
 */

export interface ComposerEditableHandle {
  getValue(): string;
  /** Replace the whole content (draft restore, programmatic text). */
  setValue(text: string): void;
  /** Insert plain text at the caret (glue-space before, like the TUI). */
  insertTextAtCaret(text: string): void;
  /** Insert a closed attachment chip at the caret (＋ menu, staged images). */
  insertTokenAtCaret(path: string): void;
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
  removeLabel,
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
  removeLabel: string;
}): React.ReactElement {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const lastSerializedRef = React.useRef(value);
  const isComposingRef = React.useRef(false);
  const propsRef = React.useRef({
    onValueChange,
    onSelectionChange,
    onRevealToken,
    previewsByPath,
    missingByPath,
    removeLabel,
  });
  propsRef.current = { onValueChange, onSelectionChange, onRevealToken, previewsByPath, missingByPath, removeLabel };

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

  const textBeforeCaret = React.useCallback((): string => {
    const el = getEditor();
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return "";
    const anchor = sel.anchorNode;
    if (!anchor) return "";
    const range = document.createRange();
    range.selectNodeContents(el);
    range.setEnd(anchor, sel.anchorOffset);
    return range.toString();
  }, [getEditor]);

  const caretToEditorEnd = React.useCallback(() => {
    const el = getEditor();
    const sel = window.getSelection();
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }, [getEditor]);

  const syncHeight = React.useCallback(() => {
    const el = getEditor();
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [getEditor]);

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
      for (const segment of segmentByAttachmentTokens(text)) {
        if (segment.type === "text") {
          if (segment.text) el.appendChild(document.createTextNode(segment.text));
        } else {
          el.appendChild(createChip(segment.token.path));
        }
      }
      lastSerializedRef.current = text;
      caretToEditorEnd();
      syncHeight();
    },
    [createChip, caretToEditorEnd, getEditor, syncHeight],
  );

  /** Rebuild the flat DOM from `text`, restoring the caret by serialized offset.
   *  `chipTokens` selects which token ranges become chips; open queries stay
   *  literal text so AtMenu completion keeps working. */
  const rewritePreservingCaret = React.useCallback(
    (text: string, caretOffset: number, chipTokens: readonly AttachmentToken[]) => {
      const el = getEditor();
      if (!el) return;
      el.textContent = "";
      let cursor = 0;
      for (const token of chipTokens) {
        if (token.start > cursor) el.appendChild(document.createTextNode(text.slice(cursor, token.start)));
        el.appendChild(createChip(token.path));
        cursor = token.end;
      }
      if (cursor < text.length) el.appendChild(document.createTextNode(text.slice(cursor)));
      lastSerializedRef.current = text;
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        let remaining = caretOffset;
        let placed = false;
        const children = Array.from(el.childNodes);
        for (let index = 0; index < children.length; index++) {
          const child = children[index];
          const size =
            child.nodeType === Node.TEXT_NODE
              ? (child.textContent ?? "").length
              : attachmentTokenText((child as HTMLElement).dataset.path ?? "").length;
          if (remaining <= size) {
            range.setStart(
              child.nodeType === Node.TEXT_NODE ? child : el,
              child.nodeType === Node.TEXT_NODE ? remaining : index,
            );
            range.collapse(true);
            placed = true;
            break;
          }
          remaining -= size;
        }
        if (!placed) {
          range.selectNodeContents(el);
          range.collapse(false);
        }
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
    [createChip, getEditor],
  );

  /**
   * Turn closed @tokens that are still plain text into chips. A token is
   * closed when a separator space follows it; an open trailing query (AtMenu
   * drill-down, mid-typing) stays plain text so completion can keep
   * replacing it.
   */
  const materializeTokens = React.useCallback(() => {
    const el = getEditor();
    if (!el) return;
    const text = serializeEditor(el);
    const tokens = findAttachmentTokens(text);
    const closed = tokens.filter((token) => /\s/.test(text[token.end] ?? ""));
    if (closed.length === 0) return;
    let offset = 0;
    let hasPlainTextToken = false;
    for (const child of Array.from(el.childNodes)) {
      const size =
        child.nodeType === Node.TEXT_NODE
          ? (child.textContent ?? "").length
          : attachmentTokenText((child as HTMLElement).dataset.path ?? "").length;
      if (child.nodeType === Node.TEXT_NODE) {
        const nodeStart = offset;
        const nodeEnd = offset + size;
        if (closed.some((token) => token.start < nodeEnd && token.end > nodeStart)) {
          hasPlainTextToken = true;
          break;
        }
      }
      offset += size;
    }
    if (!hasPlainTextToken) return;
    rewritePreservingCaret(text, textBeforeCaret().length, closed);
  }, [getEditor, rewritePreservingCaret, textBeforeCaret]);

  /** Flatten stray blocks/BRs left by default browser edits; keep the caret. */
  const normalize = React.useCallback(() => {
    const el = getEditor();
    if (!el || isFlat(el)) return;
    const text = serializeEditor(el);
    const closed = findAttachmentTokens(text).filter((token) => /\s/.test(text[token.end] ?? ""));
    rewritePreservingCaret(text, textBeforeCaret().length, closed);
  }, [getEditor, rewritePreservingCaret, textBeforeCaret]);

  const removeChip = React.useCallback(
    (chip: HTMLElement) => {
      const el = getEditor();
      if (!el) return;
      const next = chip.nextSibling;
      const prev = chip.previousSibling;
      // Collapse one adjacent separator space to avoid double gaps.
      if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith(" ")) {
        next.textContent = next.textContent.slice(1);
      } else if (prev?.nodeType === Node.TEXT_NODE && prev.textContent?.endsWith(" ")) {
        prev.textContent = prev.textContent.slice(0, -1);
      }
      const index = Array.from(el.childNodes).indexOf(chip);
      chip.remove();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.setStart(el, Math.max(0, Math.min(index, el.childNodes.length)));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      emit();
      syncHeight();
      notifySelection();
    },
    [emit, getEditor, notifySelection, syncHeight],
  );

  /** Insert nodes at the caret (or editor end); caret collapses after `caretNode`. */
  const insertAtCaret = React.useCallback(
    (nodes: Node[], caretNode: Node | null, caretOffset: number) => {
      const el = getEditor();
      const sel = window.getSelection();
      if (!el || !sel) return;
      el.focus();
      let range = sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
      if (!range) {
        caretToEditorEnd();
        range = sel.getRangeAt(0);
      }
      if (!range.collapsed) range.collapse(false);
      // Glue a space when the character before the caret is not whitespace.
      const glueNeeded = (() => {
        const { startContainer, startOffset } = range;
        if (startContainer.nodeType === Node.TEXT_NODE) {
          return startOffset > 0 && !/\s/.test(startContainer.textContent?.[startOffset - 1] ?? " ");
        }
        const prev = startContainer.childNodes[startOffset - 1] ?? null;
        return prev !== null && !(prev.nodeType === Node.TEXT_NODE && /\s$/.test(prev.textContent ?? ""));
      })();
      const frag = document.createDocumentFragment();
      if (glueNeeded) frag.append(document.createTextNode(" "));
      frag.append(...nodes);
      range.insertNode(frag);
      if (caretNode) {
        const after = document.createRange();
        try {
          after.setStart(caretNode, caretOffset);
          after.collapse(true);
          sel.removeAllRanges();
          sel.addRange(after);
        } catch {
          caretToEditorEnd();
        }
      }
      emit();
      materializeTokens();
      syncHeight();
      notifySelection();
    },
    [caretToEditorEnd, emit, getEditor, materializeTokens, notifySelection, syncHeight],
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
      completeAtQuery: (atQuery: AtQueryMatch, entryPath: string, isDir: boolean) => {
        const el = getEditor();
        const sel = window.getSelection();
        if (!el || !sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) return;
        const prefixLength = atQuery.quoted ? atQuery.query.length + 2 : atQuery.query.length + 1;
        if (range.startContainer.nodeType !== Node.TEXT_NODE || range.startOffset < prefixLength) return;
        const deleteRange = range.cloneRange();
        deleteRange.setStart(range.startContainer, range.startOffset - prefixLength);
        // Quoted completion carries its own closing quote — swallow the old one.
        if (atQuery.quoted && range.startContainer.textContent?.[range.startOffset] === '"') {
          deleteRange.setEnd(range.startContainer, range.startOffset + 1);
        }
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
          const chip = createChip(entryPath);
          const space = document.createTextNode(" ");
          const frag = document.createDocumentFragment();
          frag.append(chip, space);
          deleteRange.insertNode(frag);
          const after = document.createRange();
          after.setStart(space, 1);
          after.collapse(true);
          sel.removeAllRanges();
          sel.addRange(after);
        }
        emit();
        syncHeight();
        notifySelection();
      },
      textBeforeCaret: () => textBeforeCaret(),
      focus: () => getEditor()?.focus(),
    }),
    [createChip, emit, getEditor, insertAtCaret, notifySelection, rebuild, syncHeight, textBeforeCaret],
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
    if (!el) return;
    for (const chip of Array.from(el.querySelectorAll<HTMLElement>(`[${TOKEN_ATTR}]`))) {
      const path = chip.dataset.path ?? "";
      const preview = propsRef.current.previewsByPath.get(path) ?? null;
      const missing = propsRef.current.missingByPath.get(path) ?? false;
      if ((chip.dataset.previewKey ?? "") === (preview ?? "") && chip.dataset.missingKey === (missing ? "1" : "0")) {
        continue;
      }
      chip.dataset.previewKey = preview ?? "";
      chip.dataset.missingKey = missing ? "1" : "0";
      fillChipContent(chip, path, visualFor(path));
    }
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
      if (!el || !sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const prefixLength = query.quoted ? query.query.length + 2 : query.query.length + 1;
      if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE || range.startOffset < prefixLength) {
        return;
      }
      const deleteRange = range.cloneRange();
      deleteRange.setStart(range.startContainer, range.startOffset - prefixLength);
      if (query.quoted && range.startContainer.textContent?.[range.startOffset] === '"') {
        // The drill-down completion leaves the closing quote after the caret.
        deleteRange.setEnd(range.startContainer, range.startOffset + 1);
      }
      deleteRange.deleteContents();
      const chip = createChip(query.query);
      const space = document.createTextNode(" ");
      const frag = document.createDocumentFragment();
      frag.append(chip, space);
      deleteRange.insertNode(frag);
      const after = document.createRange();
      after.setStart(space, 1);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      emit();
      syncHeight();
      notifySelection();
    },
    [createChip, emit, getEditor, notifySelection, syncHeight],
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
          const caretRange = sel.getRangeAt(0);
          const prefixLength = query.quoted ? query.query.length + 2 : query.query.length + 1;
          if (
            caretRange.collapsed &&
            caretRange.startContainer.nodeType === Node.TEXT_NODE &&
            caretRange.startOffset >= prefixLength
          ) {
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
      if (!(neighbor instanceof HTMLElement) || !neighbor.hasAttribute(TOKEN_ATTR)) return;
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
    if ((e.target as HTMLElement).closest?.(`[${TOKEN_ATTR}]`)) e.preventDefault();
  };

  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const chip = target.closest?.<HTMLElement>(`[${TOKEN_ATTR}]`);
    if (!chip) return;
    if (target.closest?.("[data-chip-remove]")) {
      e.preventDefault();
      e.stopPropagation();
      removeChip(chip);
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
      onInput={() => {
        if (!isComposingRef.current) normalize();
        emit();
        if (!isComposingRef.current) materializeTokens();
        syncHeight();
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
