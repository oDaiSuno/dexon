export type HistoryContentAnchor = {
  element: HTMLDivElement;
  offsetTop: number;
};

export type HistoryMessageRefs = {
  current: (HTMLDivElement | null)[];
};

/** Capture a visible message position without reading hidden layout. */
export function captureHistoryContentAnchor(
  scrollElement: HTMLDivElement | null,
  messageRefs: HistoryMessageRefs | undefined,
): HistoryContentAnchor | null {
  if (!scrollElement || !messageRefs) return null;
  const containerTop = scrollElement.getBoundingClientRect().top;
  for (const element of messageRefs.current) {
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (rect.bottom > containerTop) return { element, offsetTop: rect.top - containerTop };
  }
  return null;
}
