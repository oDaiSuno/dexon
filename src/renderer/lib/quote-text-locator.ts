import type { QuoteReference, QuoteSourceRole } from "../../shared/quote-tokens.ts";

export interface ExtractedMessageSelection {
  readonly text: string;
  readonly from: QuoteSourceRole;
  readonly entryId: string;
  readonly streaming: boolean;
  readonly prefix: string;
  readonly suffix: string;
  readonly anchorRect: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
}

function parentElement(node: Node): Element | null {
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

const excludedSelectionSelector =
  '[contenteditable="true"], input, textarea, button, [data-quote-ignore], [data-quote-popover]';
const excludedTextSelector =
  '[data-quote-ignore], [data-quote-popover], button, .token-chip-remove, [hidden], [aria-hidden="true"], script, style';

interface TextPosition {
  readonly node: Text;
  readonly offset: number;
}

interface TextIndex {
  readonly text: string;
  readonly positions: readonly TextPosition[];
}

function readTextIndex(elements: readonly HTMLElement[]): TextIndex {
  const parts: string[] = [];
  const positions: TextPosition[] = [];
  const seen = new Set<Node>();
  const excluded = new Map<Element, boolean>();
  function isExcluded(element: Element | null): boolean {
    if (!element) return false;
    const cached = excluded.get(element);
    if (cached !== undefined) return cached;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    const result =
      element.matches(excludedTextSelector) ||
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse" ||
      isExcluded(element.parentElement);
    excluded.set(element, result);
    return result;
  }
  for (const element of elements) {
    const walker = element.ownerDocument.createTreeWalker(element, 4, {
      acceptNode: (node) => (isExcluded(node.parentElement) ? 2 : 1),
    });
    let current: Node | null;
    while ((current = walker.nextNode())) {
      if (seen.has(current)) continue;
      seen.add(current);
      const node = current as Text;
      parts.push(node.data);
      for (let offset = 0; offset < node.length; offset++) positions.push({ node, offset });
    }
  }
  return { text: parts.join(""), positions };
}

function normalizeWhitespace(text: string, stripWhitespace = false): string {
  return text.replace(/\s+/g, stripWhitespace ? "" : " ");
}

function boundaryTextOffset(index: TextIndex, boundary: Range): number {
  const offset = index.positions.findIndex((position) => boundary.comparePoint(position.node, position.offset) >= 0);
  return offset < 0 ? index.text.length : offset;
}

export function extractMessageSelection(
  selection: Selection | null,
  chatRoot: HTMLElement | null,
): ExtractedMessageSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !chatRoot) return null;
  const range = selection.getRangeAt(0);
  if (!chatRoot.contains(range.startContainer) || !chatRoot.contains(range.endContainer)) return null;
  const startElement = parentElement(range.startContainer);
  const endElement = parentElement(range.endContainer);
  if (startElement?.closest(excludedSelectionSelector) || endElement?.closest(excludedSelectionSelector)) return null;
  const container = startElement?.closest<HTMLElement>("[data-quote-entry-id]");
  if (!container || container !== endElement?.closest("[data-quote-entry-id]")) return null;
  const role = container.getAttribute("data-quote-role");
  if (role !== "assistant" && role !== "user") return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const index = readTextIndex([container]);
  const start = range.cloneRange();
  start.collapse(true);
  const end = range.cloneRange();
  end.collapse(false);
  const prefix = normalizeWhitespace(index.text.slice(0, boundaryTextOffset(index, start))).slice(-24);
  const suffix = normalizeWhitespace(index.text.slice(boundaryTextOffset(index, end))).slice(0, 24);
  const rect =
    Array.from(range.getClientRects()).findLast((rect) => rect.width > 0 && rect.height > 0) ??
    range.getBoundingClientRect();
  return {
    text,
    from: role,
    entryId: container.getAttribute("data-quote-entry-id") ?? "",
    streaming: container.getAttribute("data-quote-streaming") === "true",
    prefix,
    suffix,
    anchorRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
  };
}

export interface PopoverRect {
  readonly top: number;
  readonly left: number;
  readonly placement: "above" | "below";
}

export function computeSelectionPopoverPosition(params: {
  anchorRect: { top: number; bottom: number; left: number; right: number };
  viewportRect: { top: number; bottom: number; left: number; right: number };
  popoverWidth: number;
  popoverHeight: number;
  gap?: number;
  margin?: number;
}): PopoverRect {
  const { anchorRect, viewportRect, popoverWidth, popoverHeight, gap = 8, margin = 12 } = params;
  const minTop = viewportRect.top + margin;
  let top = anchorRect.top - popoverHeight - gap;
  let placement: PopoverRect["placement"] = "above";
  if (top < minTop) {
    top = anchorRect.bottom + gap;
    placement = "below";
  }
  const left = Math.max(
    viewportRect.left + margin,
    Math.min(anchorRect.right - popoverWidth / 2, viewportRect.right - popoverWidth - margin),
  );
  top = Math.max(minTop, Math.min(top, viewportRect.bottom - popoverHeight - margin));
  return { top, left, placement };
}

interface NormalizedText {
  readonly text: string;
  readonly spans: readonly { start: number; end: number }[];
}

function normalizeTextIndex(text: string, stripWhitespace: boolean): NormalizedText {
  const characters: string[] = [];
  const spans: { start: number; end: number }[] = [];
  for (let offset = 0; offset < text.length; offset++) {
    const character = normalizeWhitespace(text[offset], stripWhitespace);
    if (!character) continue;
    if (character === " " && characters.at(-1) === " ") {
      spans[spans.length - 1].end = offset + 1;
    } else {
      characters.push(character);
      spans.push({ start: offset, end: offset + 1 });
    }
  }
  return { text: characters.join(""), spans };
}

function bestContextMatch(text: string, needle: string, prefix: string, suffix: string): number {
  let bestMatch = -1;
  let bestScore = -1;
  for (let match = text.indexOf(needle); match >= 0; match = text.indexOf(needle, match + 1)) {
    let before = 0;
    while (before < prefix.length && before < match && prefix[prefix.length - before - 1] === text[match - before - 1])
      before++;
    let after = 0;
    const end = match + needle.length;
    while (after < suffix.length && suffix[after] === text[end + after]) after++;
    const score = before + after;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = match;
    }
  }
  return bestMatch;
}

export function locateQuoteRangeInElements(
  elements: readonly HTMLElement[],
  quote: Pick<QuoteReference, "text" | "prefix" | "suffix">,
): Range | null {
  if (!quote.text.trim()) return null;
  try {
    const index = readTextIndex(elements);
    for (const stripWhitespace of [false, true]) {
      const text = normalizeWhitespace(quote.text, stripWhitespace).trim();
      const normalized = normalizeTextIndex(index.text, stripWhitespace);
      const match = bestContextMatch(
        normalized.text,
        text,
        normalizeWhitespace(quote.prefix ?? "", stripWhitespace),
        normalizeWhitespace(quote.suffix ?? "", stripWhitespace),
      );
      if (match < 0) continue;
      const start = index.positions[normalized.spans[match].start];
      const end = index.positions[normalized.spans[match + text.length - 1].end - 1];
      const range = start.node.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset + 1);
      return range.collapsed ? null : range;
    }
    return null;
  } catch {
    return null;
  }
}

let cancelActiveFlash: (() => void) | null = null;

export function flashQuoteTarget(options: {
  range: Range | null;
  fallbackElement: HTMLElement | null;
  durationMs?: number;
}): () => void {
  cancelActiveFlash?.();
  const { range, fallbackElement, durationMs } = options;
  let clearFlash: () => void;
  let defaultDuration = 1500;
  if (range && typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined") {
    const registry = CSS.highlights;
    const highlight = new Highlight(range);
    const ancestor = parentElement(range.commonAncestorContainer);
    registry.set("dexon-quote-target", highlight);
    ancestor?.setAttribute("data-quote-flash", "span");
    defaultDuration = 1800;
    clearFlash = () => {
      if (registry.get("dexon-quote-target") === highlight) registry.delete("dexon-quote-target");
      ancestor?.removeAttribute("data-quote-flash");
    };
  } else if (fallbackElement) {
    fallbackElement.classList.add("quote-target-message-flash");
    fallbackElement.setAttribute("data-quote-flash", "message");
    clearFlash = () => {
      fallbackElement.classList.remove("quote-target-message-flash");
      fallbackElement.removeAttribute("data-quote-flash");
    };
  } else {
    return () => {};
  }
  let active = true;
  const cancel = () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    clearFlash();
    if (cancelActiveFlash === cancel) cancelActiveFlash = null;
  };
  const timer = setTimeout(cancel, durationMs ?? defaultDuration);
  cancelActiveFlash = cancel;
  return cancel;
}
