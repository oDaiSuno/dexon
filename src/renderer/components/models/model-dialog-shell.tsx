import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "../form-controls";
import { useI18n } from "@/i18n";
import type { PersistResult } from "./use-models-config";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogNotice {
  tone: "danger" | "warning";
  text: string;
  action?: ReactNode;
}

export function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function ModelDialogShell({
  width,
  elevated = false,
  layer = 0,
  dirty,
  title,
  subtitle,
  leading,
  trailing,
  divided = false,
  notice,
  footer,
  onClose,
  children,
}: {
  width: number;
  elevated?: boolean;
  layer?: number;
  dirty: boolean;
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  divided?: boolean;
  notice?: DialogNotice | null;
  footer: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const requestClose = () => {
    if (dirty) setDiscardPrompt(true);
    else onClose();
  };
  const shownNotice: DialogNotice | null | undefined = discardPrompt
    ? {
        tone: "warning",
        text: t("modelUnsavedChanges", "You have unsaved changes."),
        action: (
          <>
            <Button variant="ghost" onClick={() => setDiscardPrompt(false)}>
              {t("modelKeepEditing", "Keep editing")}
            </Button>
            <Button variant="danger" onClick={onClose}>
              {t("discard", "Discard")}
            </Button>
          </>
        ),
      }
    : notice;
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled])");
    (first ?? dialog)?.focus();
    const returnFocus = returnFocusRef.current;
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100 + layer * 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-4)",
        background: "var(--fx-surface-scrim)",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            requestClose();
            return;
          }
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
        style={{
          width,
          maxWidth: "100%",
          maxHeight: "calc(100dvh - 32px)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          background: "var(--fx-surface-raised)",
          boxShadow: elevated ? "var(--shadow-dialog)" : undefined,
          overflow: "hidden",
          outline: "none",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: divided ? "center" : "flex-start",
            gap: divided ? 14 : 12,
            padding: divided ? "var(--space-5) var(--space-4) var(--space-5) var(--space-5)" : "18px 16px 4px 20px",
            borderBottom: divided ? "1px solid var(--fx-line-default)" : undefined,
            flexShrink: 0,
          }}
        >
          {leading}
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: divided ? 2 : 4 }}>
            <h2
              id={titleId}
              className="type-title-dialog"
              style={{
                margin: 0,
                color: "var(--fx-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </h2>
            {subtitle && (
              <span
                className={divided ? "type-body-default" : "type-label-default"}
                style={{
                  color: "var(--fx-text-tertiary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {subtitle}
              </span>
            )}
          </div>
          {trailing}
          <Button
            variant="ghost"
            onClick={requestClose}
            title={t("close", "Close")}
            aria-label={t("close", "Close")}
            style={{ width: 28, minHeight: 28, height: 28, padding: 0, borderRadius: "var(--radius-chip)" }}
          >
            <CloseIcon />
          </Button>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
        {shownNotice && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "var(--space-3) var(--space-5)",
              borderTop: "1px solid var(--fx-line-default)",
              flexShrink: 0,
            }}
          >
            <span
              className="type-body-default"
              style={{
                flex: 1,
                minWidth: 0,
                color: shownNotice.tone === "danger" ? "var(--fx-status-danger)" : "var(--fx-status-warning-text)",
              }}
            >
              {shownNotice.text}
            </span>
            {shownNotice.action}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}

export function useSaveNotice(onReload: () => Promise<void>) {
  const { t } = useI18n();
  const [notice, setNotice] = useState<DialogNotice | null>(null);
  const report = (result: PersistResult) => {
    if (result.ok) {
      setNotice(null);
      return;
    }
    setNotice({
      tone: "danger",
      text: result.error,
      action: result.conflict ? (
        <Button
          onClick={() => void onReload().then(() => setNotice(null))}
          title={t("modelReloadDiskVersionHint", "Discard local edits and load the current models.json")}
        >
          {t("modelReloadDiskVersion", "Reload disk version")}
        </Button>
      ) : undefined,
    });
  };
  return { notice, setNotice, report };
}
