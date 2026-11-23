import type { QuoteReference } from "@shared/quote-tokens";
import { flashQuoteTarget, locateQuoteRangeInElements } from "@/lib/quote-text-locator";
import { MESSAGE_TOP_GAP, alignReadingPosition } from "@/lib/reading-anchor";

const MAX_PREFERRED_OFFSET = 120;
const PREFERRED_OFFSET_RATIO = 0.25;

interface QuotePlacement {
  readonly spanTop: number;
  readonly target: number;
}

function readQuotePlacement(container: HTMLElement, message: HTMLElement, range: Range | null): QuotePlacement | null {
  if (!message.isConnected) return null;
  const containerTop = container.getBoundingClientRect().top;
  const messageRect = message.getBoundingClientRect();
  const rangeRect = range?.getBoundingClientRect?.();
  const messageTop = messageRect.top - containerTop;
  const spanTop = rangeRect && rangeRect.height > 0 ? rangeRect.top - containerTop : messageTop;
  const viewport = container.clientHeight;
  if (viewport <= 0) return { spanTop, target: MESSAGE_TOP_GAP };
  const preferred = Math.min(MAX_PREFERRED_OFFSET, Math.round(viewport * PREFERRED_OFFSET_RATIO));
  if (messageRect.height + MESSAGE_TOP_GAP * 2 > viewport) return { spanTop, target: preferred };
  const spanInMessage = spanTop - messageTop;
  const lowest = MESSAGE_TOP_GAP + spanInMessage;
  const highest = viewport - MESSAGE_TOP_GAP - messageRect.height + spanInMessage;
  return { spanTop, target: Math.min(Math.max(preferred, lowest), highest) };
}

export function findMessageElements(container: HTMLElement, entryId: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-quote-entry-id]")).filter(
    (element) => element.isConnected && element.getAttribute("data-quote-entry-id") === entryId,
  );
}

export function revealQuoteTarget(
  container: HTMLDivElement,
  quote: QuoteReference,
  stabilize = false,
): (() => void) | null {
  let elements = quote.entryId ? findMessageElements(container, quote.entryId) : [];
  let range: Range | null = null;
  if (!quote.entryId) {
    const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-quote-role]")).reverse();
    for (const element of candidates) {
      if (!element.isConnected || element.getAttribute("data-quote-role") !== quote.from) continue;
      range = locateQuoteRangeInElements([element], quote);
      if (range) {
        elements = [element];
        break;
      }
    }
  } else {
    range = locateQuoteRangeInElements(elements, quote);
  }
  const fallbackElement = elements[0];
  if (!fallbackElement) return null;
  const messageElement =
    elements.find((element) => range?.startContainer && element.contains(range.startContainer)) ?? fallbackElement;
  const placement = readQuotePlacement(container, messageElement, range);
  if (!placement) return null;
  const { target } = placement;
  const measure = () => readQuotePlacement(container, messageElement, range)?.spanTop ?? null;
  const top = Math.max(0, container.scrollTop + placement.spanTop - target);
  if (typeof container.scrollTo === "function") container.scrollTo({ top, behavior: stabilize ? "instant" : "smooth" });
  else container.scrollTop = top;
  const cancelAlignment = stabilize ? alignReadingPosition({ container, target, measure }) : null;
  const cancelFlash = flashQuoteTarget({ range, fallbackElement });
  return () => {
    cancelAlignment?.();
    cancelFlash();
  };
}
