import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { ChannelAccountView, ChannelStatus } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { ChannelBrandMark } from "../channel-brand-mark";
import { AccountCard } from "./account-card";
import { connectionMethodLabel } from "./channel-presentation";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function CloseIcon() {
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
      style={{ color: "var(--fx-text-tertiary)" }}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function trapTab(event: KeyboardEvent<HTMLDivElement>, dialog: HTMLDivElement | null) {
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
}

export function AccountDetail({
  account,
  status,
  onClose,
  ...cardProps
}: Omit<Parameters<typeof AccountCard>[0], "onClose"> & {
  account: ChannelAccountView;
  status?: ChannelStatus;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    dialogRef.current?.focus();
    const returnFocus = returnFocusRef.current;
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
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
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          event.stopPropagation();
          trapTab(event, dialogRef.current);
        }}
        style={{
          width: 560,
          maxWidth: "100%",
          maxHeight: "calc(100dvh - 32px)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          background: "var(--fx-surface-raised)",
          boxShadow: "var(--shadow-dialog)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "20px 16px 20px 20px",
            borderBottom: "1px solid var(--fx-line-default)",
            flexShrink: 0,
          }}
        >
          <ChannelBrandMark channel={account.channel} size={40} />
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
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
              {account.name}
            </h2>
            <span className="type-body-default" style={{ color: "var(--fx-text-tertiary)" }}>
              {connectionMethodLabel(account, t)}
            </span>
          </div>
          <Button
            variant="ghost"
            onClick={onClose}
            title={t("close", "Close")}
            aria-label={t("close", "Close")}
            style={{ width: 28, minHeight: 28, height: 28, padding: 0, borderRadius: "var(--radius-chip)" }}
          >
            <CloseIcon />
          </Button>
        </header>
        <AccountCard account={account} status={status} onClose={onClose} {...cardProps} />
      </div>
    </div>
  );
}
