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

export type LinkPopoverKind = "external" | "local";

export interface LinkPopoverRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface LinkPopoverPoint {
  readonly x: number;
  readonly y: number;
}

export interface LinkPopoverRequest {
  readonly kind: LinkPopoverKind;
  readonly anchor: HTMLAnchorElement;
  readonly copyValue: string;
  readonly openTitle: string;
  readonly onOpen?: () => Promise<void> | void;
  readonly clickPoint?: LinkPopoverPoint;
}

export interface ActiveLinkPopover {
  readonly kind: LinkPopoverKind;
  readonly copyValue: string;
  readonly openTitle: string;
  readonly onOpen?: () => Promise<void> | void;
  readonly anchor: HTMLAnchorElement;
  readonly anchorRect: LinkPopoverRect;
  readonly keyboardTriggered: boolean;
}

export interface LinkPopoverPosition {
  readonly top: number;
  readonly left: number;
  readonly placement: "above" | "below";
}

let activeLinkPopover: ActiveLinkPopover | null = null;
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

function rectFromDomRect(rect: DOMRect): LinkPopoverRect {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
  };
}

function distanceToRect(point: LinkPopoverPoint, rect: DOMRect): number {
  const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
  const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
  return dx * dx + dy * dy;
}

function pickAnchorRect(anchor: HTMLAnchorElement, clickPoint?: LinkPopoverPoint): LinkPopoverRect {
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

export function computeLinkPopoverPosition(params: {
  anchorRect: LinkPopoverRect;
  viewportWidth: number;
  viewportHeight: number;
  popoverWidth: number;
  popoverHeight: number;
  gap?: number;
  margin?: number;
}): LinkPopoverPosition {
  const { anchorRect, viewportWidth, viewportHeight, popoverWidth, popoverHeight, gap = 6, margin = 8 } = params;
  const maxTop = Math.max(margin, viewportHeight - popoverHeight - margin);
  const maxLeft = Math.max(margin, viewportWidth - popoverWidth - margin);
  let top = anchorRect.top - popoverHeight - gap;
  let placement: LinkPopoverPosition["placement"] = "above";
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

export function closeLinkPopover(expectedAnchor?: HTMLAnchorElement | null): void {
  if (!activeLinkPopover) return;
  if (expectedAnchor && activeLinkPopover.anchor !== expectedAnchor) return;
  activeLinkPopover = null;
  notifyListeners();
}

export function toggleLinkPopover(request: LinkPopoverRequest): void {
  if (!request.copyValue) return;
  if (activeLinkPopover?.anchor === request.anchor) {
    closeLinkPopover(request.anchor);
    return;
  }
  activeLinkPopover = {
    kind: request.kind,
    copyValue: request.copyValue,
    openTitle: request.openTitle,
    onOpen: request.onOpen,
    anchor: request.anchor,
    anchorRect: pickAnchorRect(request.anchor, request.clickPoint),
    keyboardTriggered: request.clickPoint === undefined,
  };
  notifyListeners();
}

export function useActiveLinkPopover(anchorRef: RefObject<HTMLAnchorElement | null>): ActiveLinkPopover | null {
  return useSyncExternalStore(
    subscribe,
    () => (activeLinkPopover && activeLinkPopover.anchor === anchorRef.current ? activeLinkPopover : null),
    () => null,
  );
}

export function LinkPopover({ active }: { active: ActiveLinkPopover }) {
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
      closeLinkPopover(active.anchor);
      return;
    }
    const pillRect = popoverRef.current?.getBoundingClientRect();
    const next = computeLinkPopoverPosition({
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
    return () => closeLinkPopover(anchor);
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
      closeLinkPopover(active.anchor);
    };
    const onDismiss = () => closeLinkPopover(active.anchor);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const shouldRefocus = popoverRef.current?.contains(doc.activeElement);
      closeLinkPopover(active.anchor);
      if (shouldRefocus && active.anchor.isConnected) active.anchor.focus();
    };
    const onSelectionChange = () => {
      const selection = view.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
        closeLinkPopover(active.anchor);
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
    const ok = await copy(active.copyValue);
    if (!ok) setCopyFailed(true);
  };

  const handleOpen = async () => {
    if (!active.onOpen) return;
    setOpenFailed(false);
    try {
      await active.onOpen();
      closeLinkPopover(active.anchor);
    } catch {
      setOpenFailed(true);
    }
  };

  const handlePopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && openButtonRef.current) {
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

  const copyLabel = active.kind === "local" ? t("copyPath", "Copy path") : t("externalLinkCopy", "Copy");

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t("externalLinkActions", "Link actions")}
      className="external-link-pill type-label-medium"
      data-link-popover=""
      data-link-kind={active.kind}
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
        <span>{copied ? t("copied", "Copied") : copyFailed ? t("copyFailed", "Copy failed") : copyLabel}</span>
      </button>
      {active.onOpen && (
        <>
          <span className="external-link-pill-divider" aria-hidden="true" />
          <button
            ref={openButtonRef}
            type="button"
            className={`external-link-pill-action${openFailed ? " is-error" : ""}`}
            title={active.openTitle}
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
        </>
      )}
    </div>,
    doc.body,
  );
}
