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

export interface ReadingAlignment {
  container: HTMLElement;
  target: number | (() => number);
  measure: () => number | null;
  shouldStop?: () => boolean;
  onSettled?: () => void;
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
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    globalThis.cancelAnimationFrame?.(frameId);
    onSettled?.();
  };

  const step = () => {
    if (finished) return;
    if (frames >= MAX_FRAMES || shouldStop?.()) return finish();
    frames += 1;
    const offset = measure();
    if (offset === null) return finish();
    const delta = offset - targetOf();
    if (Math.abs(delta) < 1) {
      stable += 1;
      if (stable >= STABLE_FRAMES) return finish();
    } else {
      stable = 0;
      container.scrollTop += delta;
    }
    frameId = globalThis.requestAnimationFrame?.(step) ?? 0;
  };

  step();
  return finish;
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
