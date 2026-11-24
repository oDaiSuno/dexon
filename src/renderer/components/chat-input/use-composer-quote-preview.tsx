import { useEffect, type MouseEvent, type RefObject } from "react";
import { decodeComposerQuoteToken } from "@shared/quote-tokens";
import { useQuotePreview } from "../messages/quote-preview";
import type { QuoteInteractionProps } from "../messages/quote-chip";
import { QUOTE_ATTR } from "./composer-dom";

export function useComposerQuotePreview(
  visible: boolean,
  value: string,
  editorRef: RefObject<HTMLDivElement | null>,
  { jumpingQuoteKey, detachedQuoteKeys }: QuoteInteractionProps,
) {
  const preview = useQuotePreview();
  const close = preview.close;
  useEffect(() => close(), [close, value, visible]);
  useEffect(() => {
    for (const chip of editorRef.current?.querySelectorAll<HTMLElement>(`[${QUOTE_ATTR}]`) ?? []) {
      const quote = decodeComposerQuoteToken(chip.dataset.quotePayload ?? "");
      const jumping = quote?.id === jumpingQuoteKey;
      chip.classList.toggle("quote-chip-jumping", jumping);
      chip.classList.toggle("quote-chip-detached", !!quote && !!detachedQuoteKeys?.has(quote.id));
      if (jumping) chip.setAttribute("aria-busy", "true");
      else chip.removeAttribute("aria-busy");
    }
  }, [detachedQuoteKeys, editorRef, jumpingQuoteKey, value]);
  return {
    close,
    portal: preview.portal,
    onMouseOver: (event: MouseEvent<HTMLDivElement>) => {
      if (!visible) return;
      const chip = (event.target as HTMLElement).closest?.<HTMLElement>(`[${QUOTE_ATTR}]`);
      if (!chip || (event.relatedTarget instanceof Node && chip.contains(event.relatedTarget))) return;
      const quote = decodeComposerQuoteToken(chip.dataset.quotePayload ?? "");
      if (quote) preview.hover(quote, chip, detachedQuoteKeys?.has(quote.id));
    },
    onMouseOut: (event: MouseEvent<HTMLDivElement>) => {
      const chip = (event.target as HTMLElement).closest?.<HTMLElement>(`[${QUOTE_ATTR}]`);
      if (chip && !(event.relatedTarget instanceof Node && chip.contains(event.relatedTarget))) preview.leave();
    },
  };
}
