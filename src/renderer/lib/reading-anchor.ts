export const READING_ANCHOR_ATTRIBUTE = "data-reading-anchor";

export const MESSAGE_TOP_GAP = 16;

const STABLE_FRAMES = 3;
const MAX_FRAMES = 90;

export function readingAnchorAttributes(key: string): Record<string, string> {
  return { [READING_ANCHOR_ATTRIBUTE]: key };
}

export interface ReadingAnchor {
  key: string;
  offsetTop: number;
}

export type ReadingAlignmentOutcome = "settled" | "clamped" | "aborted" | "missing" | "max-frames";

export interface ReadingAlignment {
  container: HTMLElement;
  target: number | (() => number);
  measure: () => number | null;
  shouldStop?: () => boolean;
  onSettled?: (outcome: ReadingAlignmentOutcome) => void;
}

export function captureReadingAnchor(container: HTMLElement | null): ReadingAnchor | null {
  if (!container) return null;
  const containerTop = container.getBoundingClientRect().top;
  for (const element of container.querySelectorAll<HTMLElement>(`[${READING_ANCHOR_ATTRIBUTE}]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= containerTop) continue;
    const key = element.getAttribute(READING_ANCHOR_ATTRIBUTE);
    return key === null ? null : { key, offsetTop: rect.top - containerTop };
  }
  return null;
}

export function readReadingAnchorOffset(container: HTMLElement, key: string): number | null {
  const element = findReadingAnchor(container, key);
  if (!element) return null;
  return element.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

export function readReadingAnchorHeight(container: HTMLElement, key: string): number | null {
  const element = findReadingAnchor(container, key);
  if (!element) return null;
  return element.getBoundingClientRect().height;
}

export function clampedReadingOffset(offsetTop: number, height: number | null): number {
  return height !== null && height > 0 && offsetTop < -height ? MESSAGE_TOP_GAP : offsetTop;
}

export function alignReadingPosition({ container, target, measure, shouldStop, onSettled }: ReadingAlignment) {
  const targetOf = typeof target === "function" ? target : () => target;
  let frameId = 0;
  let frames = 0;
  let stable = 0;
  let previousHeight: number | null = null;
  let expectedScrollTop: number | null = null;
  let expectedScrollHeight: number | null = null;
  let finished = false;

  const finish = (outcome: ReadingAlignmentOutcome = "aborted") => {
    if (finished) return;
    finished = true;
    globalThis.cancelAnimationFrame?.(frameId);
    onSettled?.(outcome);
  };

  const step = () => {
    if (finished) return;
    if (shouldStop?.()) return finish("aborted");
    if (expectedScrollTop !== null && expectedScrollHeight !== null) {
      const externalScrollDelta = Math.abs(container.scrollTop - expectedScrollTop);
      const heightDelta = Math.abs(container.scrollHeight - expectedScrollHeight);
      if (externalScrollDelta > heightDelta + 2) return finish("aborted");
    }
    if (frames >= MAX_FRAMES) return finish("max-frames");
    frames += 1;
    const offset = measure();
    if (offset === null) return finish("missing");
    const delta = offset - targetOf();
    if (Math.abs(delta) < 1) {
      stable += 1;
      previousHeight = container.scrollHeight;
      if (stable >= STABLE_FRAMES) return finish("settled");
    } else {
      const before = container.scrollTop;
      const beforeHeight = container.scrollHeight;
      container.scrollTop = Math.max(0, before + delta);
      const moved = Math.abs(container.scrollTop - before);
      if (moved < 0.5 && previousHeight === beforeHeight) {
        stable += 1;
        if (stable >= STABLE_FRAMES) return finish("clamped");
      } else {
        stable = 0;
      }
      previousHeight = beforeHeight;
    }
    expectedScrollTop = container.scrollTop;
    expectedScrollHeight = container.scrollHeight;
    frameId = globalThis.requestAnimationFrame?.(step) ?? 0;
  };

  step();
  return () => finish("aborted");
}

function findReadingAnchor(container: HTMLElement, key: string): HTMLElement | null {
  const escape = globalThis.CSS?.escape?.bind(globalThis.CSS);
  if (typeof escape === "function") {
    return container.querySelector<HTMLElement>(`[${READING_ANCHOR_ATTRIBUTE}="${escape(key)}"]`);
  }
  for (const element of container.querySelectorAll<HTMLElement>(`[${READING_ANCHOR_ATTRIBUTE}]`)) {
    if (element.getAttribute(READING_ANCHOR_ATTRIBUTE) === key) return element;
  }
  return null;
}
