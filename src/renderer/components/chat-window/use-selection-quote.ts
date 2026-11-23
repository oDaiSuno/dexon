import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ChatInputHandle } from "../ChatInput";
import { extractMessageSelection, type ExtractedMessageSelection } from "@/lib/quote-text-locator";

let localQuoteSequence = 0;

function createLocalQuoteId(): string {
  localQuoteSequence += 1;
  return `local-${Date.now().toString(36)}-${localQuoteSequence.toString(36)}`;
}

export function useSelectionQuote({
  visible,
  sessionId,
  scrollContainerRef,
  chatInputRef,
}: {
  visible: boolean;
  sessionId: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  chatInputRef: RefObject<ChatInputHandle | null>;
}) {
  const [selection, setSelection] = useState<ExtractedMessageSelection | null>(null);
  const cached = useRef<ExtractedMessageSelection | null>(null);
  const dismissed = useRef<Range | null>(null);
  const close = useCallback(() => {
    cached.current = null;
    const selection = scrollContainerRef.current?.ownerDocument.defaultView?.getSelection();
    dismissed.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    setSelection(null);
  }, [scrollContainerRef]);

  useEffect(() => {
    close();
    const container = scrollContainerRef.current;
    if (!visible || !container) return;
    const doc = container.ownerDocument;
    const update = (event: Event) => {
      if (event.type === "keyup" && (event as KeyboardEvent).key === "Escape") return;
      if ((event.target as HTMLElement | null)?.closest?.("[data-quote-popover]")) return;
      const current = doc.defaultView?.getSelection() ?? null;
      const range = current?.rangeCount ? current.getRangeAt(0) : null;
      const ignored = dismissed.current;
      if (
        event.type === "selectionchange" &&
        ignored &&
        range &&
        ignored.startContainer === range.startContainer &&
        ignored.startOffset === range.startOffset &&
        ignored.endContainer === range.endContainer &&
        ignored.endOffset === range.endOffset
      )
        return;
      const next = extractMessageSelection(current, container);
      dismissed.current = null;
      cached.current = next;
      setSelection(next);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const outside = (event: Event) => {
      if (!(event.target as HTMLElement | null)?.closest?.("[data-quote-popover]")) close();
    };
    const clickBlank = (event: Event) => {
      if (!(event.target as HTMLElement | null)?.closest?.("[data-quote-entry-id], [data-quote-popover]")) close();
    };
    doc.addEventListener("click", clickBlank);
    doc.addEventListener("mouseup", update);
    doc.addEventListener("keyup", update);
    doc.addEventListener("selectionchange", update);
    doc.addEventListener("keydown", escape);
    doc.addEventListener("pointerdown", outside);
    doc.addEventListener("mousedown", outside);
    container.addEventListener("scroll", close, { passive: true });
    return () => {
      doc.removeEventListener("click", clickBlank);
      doc.removeEventListener("mouseup", update);
      doc.removeEventListener("keyup", update);
      doc.removeEventListener("selectionchange", update);
      doc.removeEventListener("keydown", escape);
      doc.removeEventListener("pointerdown", outside);
      doc.removeEventListener("mousedown", outside);
      container.removeEventListener("scroll", close);
    };
  }, [close, scrollContainerRef, sessionId, visible]);

  const insert = useCallback(() => {
    const selected = cached.current;
    if (!selected || !visible) return;
    const quote = {
      id: createLocalQuoteId(),
      text: selected.text,
      from: selected.from,
      entryId: selected.streaming ? undefined : selected.entryId || undefined,
      prefix: selected.prefix || undefined,
      suffix: selected.suffix || undefined,
    };
    scrollContainerRef.current?.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
    close();
    chatInputRef.current?.insertQuoteAtCaret(quote);
    chatInputRef.current?.focus();
  }, [chatInputRef, close, scrollContainerRef, visible]);

  return { selection: visible ? selection : null, insert };
}
