import { useI18n } from "@/i18n";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

// Moved verbatim from SessionSidebar.tsx in Phase 2 (session row split).

export const sessionMenuItemStyle: CSSProperties = {
  width: "100%",
  minHeight: 34,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 8px",
  border: 0,
  borderRadius: "var(--radius-control)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: "var(--text-body)",
  textAlign: "left",
  transition: "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
};

/** Shared hover handlers so the two session-menu items fade instead of snapping. */
export const sessionMenuItemHandlers = {
  onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "var(--bg-hover)";
    e.currentTarget.style.color = "var(--text)";
  },
  onMouseLeave: (e: ReactMouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "transparent";
    e.currentTarget.style.color = "var(--text-muted)";
  },
};

/** Delete item: same fade, but the danger color is never overridden. */
export const dangerMenuItemHandlers = {
  onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "var(--bg-hover)";
  },
  onMouseLeave: (e: ReactMouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = "transparent";
  },
};

export function SessionItemActionsMenu({
  onRename,
  onDelete,
}: {
  onRename: (event: ReactMouseEvent) => void;
  onDelete: (event: ReactMouseEvent) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="menu"
      aria-label={t("sessionActions", "Session actions")}
      className="composer-pop-in"
      style={{
        position: "absolute",
        top: 34,
        right: 0,
        zIndex: 50,
        transformOrigin: "top right",
        minWidth: 132,
        padding: 4,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        background: "var(--bg)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
      }}
    >
      <button
        type="button"
        role="menuitem"
        className="session-menu-item"
        onClick={onRename}
        style={sessionMenuItemStyle}
        {...sessionMenuItemHandlers}
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
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
        {t("rename", "Rename")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="session-menu-item"
        onClick={onDelete}
        {...dangerMenuItemHandlers}
        style={{ ...sessionMenuItemStyle, color: "var(--danger)" }}
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
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
        {t("delete", "Delete")}
      </button>
    </div>
  );
}

/** Delete confirmation: same fixed row height, prompt plus two flat buttons. */
export function SessionItemDeleteConfirm({
  title,
  onConfirm,
  onCancel,
}: {
  title: string;
  onConfirm: (event: ReactMouseEvent) => void;
  onCancel: (event: ReactMouseEvent) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "var(--text-label)",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {t("deleteSessionConfirm", "Delete “{title}”?").replace(
          "{title}",
          `${title.slice(0, 22)}${title.length > 22 ? "…" : ""}`,
        )}
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <button
          onClick={onConfirm}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            height: 24,
            padding: "0 10px",
            background: "var(--danger)",
            border: "none",
            borderRadius: "var(--radius-control)",
            color: "var(--on-danger)",
            cursor: "pointer",
            fontSize: "var(--text-label)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
          {t("delete", "Delete")}
        </button>
        <button
          onClick={onCancel}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 24,
            padding: "0 10px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-control)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "var(--text-label)",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          {t("cancel", "Cancel")}
        </button>
      </div>
    </>
  );
}
