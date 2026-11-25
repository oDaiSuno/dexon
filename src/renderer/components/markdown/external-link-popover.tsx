import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { useI18n } from "@/i18n";
import { normalizeExternalHref } from "@shared/external-links";

export interface ExternalLinkRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface ExternalLinkPoint {
  readonly x: number;
  readonly y: number;
}

export interface ActiveExternalLink {
  readonly href: string;
  readonly anchor: HTMLAnchorElement;
  readonly anchorRect: ExternalLinkRect;
  readonly keyboardTriggered: boolean;
}

export interface ExternalLinkPopoverPosition {
  readonly top: number;
  readonly left: number;
  readonly placement: "above" | "below";
}

let activeExternalLink: ActiveExternalLink | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function rectFromDomRect(rect: DOMRect): ExternalLinkRect {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
  };
}

function distanceToRect(point: ExternalLinkPoint, rect: DOMRect): number {
  const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
  const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
  return dx * dx + dy * dy;
}

function pickAnchorRect(anchor: HTMLAnchorElement, clickPoint?: ExternalLinkPoint): ExternalLinkRect {
  const rects = Array.from(anchor.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) return rectFromDomRect(anchor.getBoundingClientRect());
  if (!clickPoint) return rectFromDomRect(rects[0]);
  let best = rects[0];
  let bestDistance = distanceToRect(clickPoint, best);
  for (let index = 1; index < rects.length; index++) {
    const distance = distanceToRect(clickPoint, rects[index]);
    if (distance < bestDistance) {
      best = rects[index];
      bestDistance = distance;
    }
  }
  return rectFromDomRect(best);
}

export function computeExternalLinkPopoverPosition(params: {
  anchorRect: ExternalLinkRect;
  viewportWidth: number;
  viewportHeight: number;
  popoverWidth: number;
  popoverHeight: number;
  gap?: number;
  margin?: number;
}): ExternalLinkPopoverPosition {
  const { anchorRect, viewportWidth, viewportHeight, popoverWidth, popoverHeight, gap = 6, margin = 8 } = params;
  const maxTop = Math.max(margin, viewportHeight - popoverHeight - margin);
  const maxLeft = Math.max(margin, viewportWidth - popoverWidth - margin);
  let top = anchorRect.top - popoverHeight - gap;
  let placement: ExternalLinkPopoverPosition["placement"] = "above";
  if (top < margin) {
    top = anchorRect.bottom + gap;
    placement = "below";
  }
  const centeredLeft = (anchorRect.left + anchorRect.right) / 2 - popoverWidth / 2;
  return {
    top: Math.max(margin, Math.min(top, maxTop)),
    left: Math.max(margin, Math.min(centeredLeft, maxLeft)),
    placement,
  };
}

export async function openExternalLinkUrl(href: string): Promise<void> {
  const safeHref = normalizeExternalHref(href);
  if (!safeHref) throw new Error("Unsupported external URL");
  if (window.piBridge?.openExternal) {
    await window.piBridge.openExternal(safeHref);
    return;
  }
  const opened = window.open(safeHref, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("External window could not be opened");
}

export function closeExternalLinkPopover(expectedAnchor?: HTMLAnchorElement | null): void {
  if (!activeExternalLink) return;
  if (expectedAnchor && activeExternalLink.anchor !== expectedAnchor) return;
  activeExternalLink = null;
  notifyListeners();
}

export function toggleExternalLinkPopover(
  anchor: HTMLAnchorElement,
  href: string,
  clickPoint?: ExternalLinkPoint,
): void {
  const safeHref = normalizeExternalHref(href);
  if (!safeHref) return;
  if (activeExternalLink?.anchor === anchor) {
    closeExternalLinkPopover(anchor);
    return;
  }
  activeExternalLink = {
    href: safeHref,
    anchor,
    anchorRect: pickAnchorRect(anchor, clickPoint),
    keyboardTriggered: clickPoint === undefined,
  };
  notifyListeners();
}

export function useActiveExternalLink(anchorRef: RefObject<HTMLAnchorElement | null>): ActiveExternalLink | null {
  return useSyncExternalStore(
    subscribe,
    () => (activeExternalLink && activeExternalLink.anchor === anchorRef.current ? activeExternalLink : null),
    () => null,
  );
}

export function ExternalLinkPopover({ active }: { active: ActiveExternalLink }) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback(1_200);
  const [copyFailed, setCopyFailed] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: active.anchorRect.top,
    left: active.anchorRect.left,
  });

  useLayoutEffect(() => {
    const view = active.anchor.ownerDocument.defaultView;
    if (!view || !active.anchor.isConnected) {
      closeExternalLinkPopover(active.anchor);
      return;
    }
    const pillRect = popoverRef.current?.getBoundingClientRect();
    const next = computeExternalLinkPopoverPosition({
      anchorRect: active.anchorRect,
      viewportWidth: view.innerWidth,
      viewportHeight: view.innerHeight,
      popoverWidth: pillRect?.width || 136,
      popoverHeight: pillRect?.height || 30,
    });
    setPosition({ top: next.top, left: next.left });
  }, [active, copied, copyFailed, openFailed]);

  useEffect(() => {
    const anchor = active.anchor;
    return () => closeExternalLinkPopover(anchor);
  }, [active.anchor]);

  useEffect(() => {
    if (active.keyboardTriggered) {
      copyButtonRef.current?.focus({ preventScroll: true });
    }
  }, [active]);

  useEffect(() => {
    const doc = active.anchor.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (popoverRef.current?.contains(target) || active.anchor.contains(target))) return;
      closeExternalLinkPopover(active.anchor);
    };
    const onDismiss = () => closeExternalLinkPopover(active.anchor);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const shouldRefocus = popoverRef.current?.contains(doc.activeElement);
      closeExternalLinkPopover(active.anchor);
      if (shouldRefocus && active.anchor.isConnected) active.anchor.focus();
    };
    const onSelectionChange = () => {
      const selection = view.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
        closeExternalLinkPopover(active.anchor);
      }
    };

    doc.addEventListener("mousedown", onPointerDown, true);
    doc.addEventListener("scroll", onDismiss, true);
    doc.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("selectionchange", onSelectionChange);
    view.addEventListener("resize", onDismiss);
    view.addEventListener("blur", onDismiss);
    return () => {
      doc.removeEventListener("mousedown", onPointerDown, true);
      doc.removeEventListener("scroll", onDismiss, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("selectionchange", onSelectionChange);
      view.removeEventListener("resize", onDismiss);
      view.removeEventListener("blur", onDismiss);
    };
  }, [active]);

  const handleCopy = async () => {
    setOpenFailed(false);
    setCopyFailed(false);
    const ok = await copy(active.href);
    if (!ok) setCopyFailed(true);
  };

  const handleOpen = async () => {
    setOpenFailed(false);
    try {
      await openExternalLinkUrl(active.href);
      closeExternalLinkPopover(active.anchor);
    } catch {
      setOpenFailed(true);
    }
  };

  const handlePopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next =
        event.currentTarget.ownerDocument.activeElement === copyButtonRef.current
          ? openButtonRef.current
          : copyButtonRef.current;
      next?.focus();
    }
  };

  const doc = active.anchor.ownerDocument;
  if (!doc.body) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t("externalLinkActions", "Link actions")}
      className="external-link-pill type-label-medium"
      data-external-link-popover=""
      data-quote-ignore=""
      style={{ position: "fixed", zIndex: 1000, ...position }}
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={handlePopoverKeyDown}
    >
      <button
        ref={copyButtonRef}
        type="button"
        className={`external-link-pill-action${copied ? " is-copied" : ""}${copyFailed ? " is-error" : ""}`}
        onClick={() => void handleCopy()}
      >
        {copied ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        )}
        <span>
          {copied ? t("copied", "Copied") : copyFailed ? t("copyFailed", "Copy failed") : t("externalLinkCopy", "Copy")}
        </span>
      </button>
      <span className="external-link-pill-divider" aria-hidden="true" />
      <button
        ref={openButtonRef}
        type="button"
        className={`external-link-pill-action${openFailed ? " is-error" : ""}`}
        title={active.href}
        onClick={() => void handleOpen()}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
        <span>{openFailed ? t("externalLinkOpenFailed", "Open failed") : t("externalLinkOpen", "Open")}</span>
      </button>
    </div>,
    doc.body,
  );
}
