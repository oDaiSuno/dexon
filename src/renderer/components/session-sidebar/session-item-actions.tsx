import { useI18n } from "@/i18n";
import {
  useLayoutEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { Button } from "../form-controls";
import { RowIcon } from "./session-relation-glyphs";

function PencilLineGlyph() {
  return (
    <RowIcon size={15}>
      <path d="M13 21h8" />
      <path d="m15 5 4 4" />
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </RowIcon>
  );
}

function TrashGlyph() {
  return (
    <RowIcon size={15}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </RowIcon>
  );
}

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
      className="session-menu-card session-menu-card--menu composer-pop-in"
    >
      <div className="session-menu-list">
        <button type="button" role="menuitem" className="session-menu-item type-body-large" onClick={onRename}>
          <span className="session-menu-item-icon">
            <PencilLineGlyph />
          </span>
          <span className="session-menu-item-label">{t("rename", "Rename")}</span>
        </button>
        <div aria-hidden="true" className="session-menu-separator">
          <div />
        </div>
        <button
          type="button"
          role="menuitem"
          className="session-menu-item session-menu-item--danger type-body-large"
          onClick={onDelete}
        >
          <span className="session-menu-item-icon">
            <TrashGlyph />
          </span>
          <span className="session-menu-item-label">{t("deleteSessionAction", "Delete session")}</span>
        </button>
      </div>
    </div>
  );
}

const CONFIRM_CARD_WIDTH = 264;
const CONFIRM_CARD_OFFSET = 4;
const VIEWPORT_MARGIN = 8;

function useAnchoredPosition(anchorRef: RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const maxLeft = window.innerWidth - CONFIRM_CARD_WIDTH - VIEWPORT_MARGIN;
      setPosition({
        top: rect.bottom + CONFIRM_CARD_OFFSET,
        left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);
  return position;
}

export function SessionItemDeleteConfirm({
  title,
  anchorRef,
  blocked,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  anchorRef: RefObject<HTMLElement | null>;
  blocked: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (event: ReactMouseEvent) => void;
  onCancel: (event: ReactMouseEvent | ReactKeyboardEvent) => void;
}) {
  const { t } = useI18n();
  const position = useAnchoredPosition(anchorRef);
  const notice =
    error ??
    (blocked ? t("deleteRunningSessionBlocked", "This session is still running. Stop it before deleting.") : null);
  return (
    <div
      role="alertdialog"
      aria-label={t("deleteSessionConfirm", "Delete “{title}”?").replace("{title}", title)}
      className="session-menu-card session-menu-card--confirm composer-pop-in"
      style={position ?? undefined}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || busy) return;
        event.preventDefault();
        onCancel(event);
      }}
    >
      <div className="session-menu-confirm-body">
        <span className="session-menu-confirm-icon">
          <TrashGlyph />
        </span>
        <div className="session-menu-confirm-text">
          <div className="type-body-large-medium">{t("deleteSessionTitle", "Delete this session?")}</div>
          {notice && (
            <p
              role="alert"
              className="session-menu-confirm-notice type-label-default"
              data-tone={error ? "danger" : undefined}
            >
              {notice}
            </p>
          )}
        </div>
      </div>
      <div className="session-menu-confirm-footer">
        <Button variant="danger" busy={busy} disabled={blocked || busy} onClick={onConfirm}>
          {t("delete", "Delete")}
        </Button>
        <Button autoFocus disabled={busy} onClick={onCancel}>
          {t("cancel", "Cancel")}
        </Button>
      </div>
    </div>
  );
}
