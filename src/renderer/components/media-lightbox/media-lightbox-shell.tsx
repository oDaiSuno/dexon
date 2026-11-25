import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { CloseIcon } from "./media-lightbox-icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MediaLightboxDialog({
  titleId,
  onClose,
  onBeforeEscape,
  children,
}: {
  titleId: string;
  onClose: () => void;
  onBeforeEscape?: () => boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const onCloseRef = useRef(onClose);
  const onBeforeEscapeRef = useRef(onBeforeEscape);

  useEffect(() => {
    onCloseRef.current = onClose;
    onBeforeEscapeRef.current = onBeforeEscape;
  }, [onBeforeEscape, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.focus({ preventScroll: true });
    const returnFocus = returnFocusRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (onBeforeEscapeRef.current?.()) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      className="media-lightbox-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="media-lightbox-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          event.stopPropagation();
          const dialog = dialogRef.current;
          if (!dialog) return;
          const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (element) => element.getClientRects().length > 0,
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) {
            event.preventDefault();
            return;
          }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function MediaLightboxHeader({
  titleId,
  icon,
  title,
  meta,
  center,
  actions,
  onClose,
}: {
  titleId: string;
  icon: ReactNode;
  title: string;
  meta?: string | null;
  center?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const hasCenter = center !== undefined && center !== null;

  return (
    <header className={["media-lightbox-header", hasCenter ? "has-center" : ""].filter(Boolean).join(" ")}>
      <div className="media-lightbox-meta">
        <span className="media-lightbox-type-icon">{icon}</span>
        <span id={titleId} className="media-lightbox-title type-label-medium" title={title}>
          {title}
        </span>
        {meta && (
          <span className="media-lightbox-submeta type-mono-meta" title={meta}>
            {meta}
          </span>
        )}
      </div>
      {hasCenter && <div className="media-lightbox-center">{center}</div>}
      <div className="media-lightbox-actions">
        {actions}
        <span className="media-lightbox-divider" aria-hidden="true" />
        <button
          type="button"
          className="media-lightbox-close"
          onClick={onClose}
          title={t("close", "Close")}
          aria-label={t("close", "Close")}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}

export function MediaLightboxHint({ text }: { text: string }) {
  return (
    <div className="media-lightbox-hint type-meta-default" aria-hidden="true">
      {text}
    </div>
  );
}
