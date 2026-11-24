import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { computeSelectionPopoverPosition, type ExtractedMessageSelection } from "@/lib/quote-text-locator";

export function SelectionQuotePopover({
  selection,
  scrollContainerRef,
  onInsert,
}: {
  selection: ExtractedMessageSelection | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onInsert: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!selection || !container) return;
    const pill = ref.current?.getBoundingClientRect();
    setPosition(
      computeSelectionPopoverPosition({
        anchorRect: selection.anchorRect,
        viewportRect: container.getBoundingClientRect(),
        popoverWidth: pill?.width || 148,
        popoverHeight: pill?.height || 30,
      }),
    );
  }, [scrollContainerRef, selection]);
  const doc = scrollContainerRef.current?.ownerDocument;
  if (!selection || !doc) return null;
  return createPortal(
    <button
      ref={ref}
      type="button"
      role="button"
      className="selection-quote-pill type-label-medium"
      data-quote-popover=""
      style={{ position: "fixed", zIndex: 1000, ...position }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onInsert}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
        <path d="M8 8h2v3H8V8Zm6 0h2v3h-2V8ZM10 11c0 2-1 3-2 3m8-3c0 2-1 3-2 3" />
      </svg>
      {t("askDexonSelection", "Ask Dexon")}
    </button>,
    doc.body,
  );
}
