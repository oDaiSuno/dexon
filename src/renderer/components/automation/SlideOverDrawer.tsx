import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { Button } from "@/components/form-controls";
import { AutomationIcon } from "./automation-icons";

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function SlideOverDrawer({
  title,
  onClose,
  children,
  footer,
  modal = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  modal?: boolean;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const roots = [...document.querySelectorAll<HTMLElement>(".automation-page-root")];
    const previous = roots.map((root) => root.inert);
    for (const root of roots) root.inert = true;
    return () => {
      roots.forEach((root, index) => {
        root.inert = previous[index];
      });
    };
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    const previous = returnFocus.current;
    return () => {
      cancelAnimationFrame(frame);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const topPanel = () =>
      [...document.querySelectorAll<HTMLElement>('.auto-page-overlay > [role="dialog"]')].at(-1) === panelRef.current;
    const controls = () =>
      [...(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])].filter(
        (element) => element.getClientRects().length > 0,
      );
    const focusInside = () => (controls()[0] ?? panelRef.current)?.focus();
    const onFocus = (event: FocusEvent) => {
      if (topPanel() && event.target instanceof Node && !panelRef.current?.contains(event.target)) focusInside();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !topPanel()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const outside = !panelRef.current?.contains(document.activeElement);
      if (outside || document.activeElement === panelRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [onClose]);
  return createPortal(
    <div
      role="presentation"
      className={`auto-page-overlay${modal ? " is-modal" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`auto-page-drawer${entered ? " is-entered" : ""}${modal ? " is-modal" : ""}`}
      >
        <header className="auto-page-drawer-header">
          <h2 id={titleId} className="type-title-section">
            {title}
          </h2>
          <Button variant="ghost" aria-label={t("autoPageClose", "Close")} onClick={onClose}>
            <AutomationIcon name="close" />
          </Button>
        </header>
        <div className="auto-page-drawer-body">{children}</div>
        {footer && <footer className="auto-page-drawer-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
