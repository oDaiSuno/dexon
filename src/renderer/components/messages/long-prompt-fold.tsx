import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { useI18n } from "@/i18n";
import { Icon } from "../chat-input/icons";
import { useReaderAction } from "../chat-window/reader-action";

const FOLD_AFTER_LINES = 12;
const BUBBLE_TOP_GAP = 16;
const ANCHOR_HOLD_MARGIN_MS = 80;

function lineTops(element: HTMLElement): number[] {
  const range = element.ownerDocument.createRange();
  if (typeof range.getClientRects !== "function") return [];
  const tops: number[] = [];
  const visit = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.textContent?.trim()) continue;
        range.selectNodeContents(child);
        for (const rect of range.getClientRects()) if (rect.width > 0) tops.push(rect.top);
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) visit(child);
    }
  };
  visit(element);
  return tops;
}

function linePitch(element: HTMLElement): number {
  const view = element.ownerDocument.defaultView;
  if (!view) return 0;
  const style = view.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize : 0;
}

function renderedLines(element: HTMLElement): number {
  const tops = lineTops(element).sort((left, right) => left - right);
  if (tops.length === 0) return 0;
  const sameLine = linePitch(element) / 2;
  let lines = 1;
  let lineTop = tops[0];
  for (const top of tops) {
    if (top - lineTop <= sameLine) continue;
    lines += 1;
    lineTop = top;
  }
  return lines;
}

function nearestScroller(element: HTMLElement): HTMLElement | null {
  const view = element.ownerDocument.defaultView;
  if (typeof view?.getComputedStyle !== "function") return null;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = view.getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

function transitionMs(element: HTMLElement): number {
  const view = element.ownerDocument.defaultView;
  const duration = Number.parseFloat(view?.getComputedStyle(element).transitionDuration ?? "0");
  return Number.isFinite(duration) ? duration * 1000 : 0;
}

export function LongPromptFold({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const regionId = useId();
  const regionRef = useRef<HTMLDivElement>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [foldable, setFoldable] = useState(false);
  const [open, setOpen] = useState(false);
  const [animated, setAnimated] = useState(false);
  const noteReaderAction = useReaderAction();

  const measure = useCallback(() => {
    const region = regionRef.current;
    if (!region) return;
    const lines = renderedLines(region);
    if (lines === 0) return;
    const long = lines > FOLD_AFTER_LINES;
    setFoldable(long);
    if (!long) setOpen(false);
  }, []);

  useLayoutEffect(measure, [measure, children]);

  useEffect(() => {
    const region = regionRef.current;
    if (!region || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(
    () => () => {
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current);
    },
    [],
  );

  const collapsed = foldable && !open;

  const keepBubbleTopInView = () => {
    const region = regionRef.current;
    if (!region) return;
    const scroller = nearestScroller(region);
    if (!scroller) return;
    const bubble = region.closest("[data-message-source]") ?? region;
    const top = bubble.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (top < BUBBLE_TOP_GAP) scroller.scrollTop += top - BUBBLE_TOP_GAP;
  };

  const stopAnchorCorrection = () => {
    const region = regionRef.current;
    const scroller = region ? nearestScroller(region) : null;
    if (!region || !scroller) return;
    scroller.style.overflowAnchor = "none";
    if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = setTimeout(
      () => {
        releaseTimerRef.current = null;
        scroller.style.overflowAnchor = "";
      },
      transitionMs(region) + ANCHOR_HOLD_MARGIN_MS,
    );
  };

  const setReading = (next: boolean) => {
    noteReaderAction();
    stopAnchorCorrection();
    if (!next) keepBubbleTopInView();
    setAnimated(true);
    setOpen(next);
  };

  const toggle = () => setReading(collapsed);

  const revealFocusedContent = (event: FocusEvent<HTMLDivElement>) => {
    const region = regionRef.current;
    const target = event.target;
    if (!region || !(target instanceof HTMLElement) || target === region) return;
    if (target.getBoundingClientRect().bottom > region.getBoundingClientRect().bottom + 1) setReading(true);
  };

  return (
    <>
      <div
        ref={regionRef}
        id={regionId}
        className="long-prompt-region"
        data-collapsed={collapsed ? "true" : undefined}
        data-animated={animated ? "true" : undefined}
        onFocus={revealFocusedContent}
      >
        {children}
      </div>
      {foldable && (
        <div className="long-prompt-bar type-body-default">
          {collapsed && <span className="long-prompt-bar-label">{t("longPromptCollapsed", "Collapsed")}</span>}
          <button
            type="button"
            className="long-prompt-bar-toggle"
            aria-expanded={!collapsed}
            aria-controls={regionId}
            onClick={toggle}
          >
            {collapsed ? t("longPromptExpand", "Show full prompt") : t("longPromptCollapse", "Collapse prompt")}
            <Icon size={11} strokeWidth={2}>
              <path d={collapsed ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} />
            </Icon>
          </button>
        </div>
      )}
    </>
  );
}
