import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { Button } from "../form-controls";
import { CopyGlyph } from "../processes/process-icons";
import { RowIcon } from "./session-relation-glyphs";
import type { SessionSubtree } from "./use-session-delete";

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

const MENU_WIDTH = 216;
const VIEWPORT_MARGIN = 8;

export function SessionItemActionsMenu({
  at,
  sessionPath,
  onRename,
  onDelete,
}: {
  at: { x: number; y: number } | null;
  sessionPath: string;
  onRename: (event: ReactMouseEvent) => void;
  onDelete: (event: ReactMouseEvent) => void;
}) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const [copyFailed, setCopyFailed] = useState(false);
  const [measuredTop, setMeasuredTop] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!at) {
      setMeasuredTop(null);
      return;
    }
    const menu = menuRef.current;
    if (!menu) return;
    const height = menu.getBoundingClientRect().height;
    setMeasuredTop(
      at.y + height > window.innerHeight - VIEWPORT_MARGIN ? window.innerHeight - VIEWPORT_MARGIN - height : at.y,
    );
    menu.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [at]);

  const left = at ? Math.max(VIEWPORT_MARGIN, Math.min(at.x, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN)) : 0;
  const top = at ? Math.max(VIEWPORT_MARGIN, measuredTop ?? at.y) : 0;
  const copyLabel = copied
    ? t("copied", "Copied")
    : copyFailed
      ? t("copyFailed", "Copy failed")
      : t("copySessionPath", "Copy session path");

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("sessionActions", "Session actions")}
      className="session-menu-card session-menu-card--menu composer-pop-in"
      style={at ? { position: "fixed", left, top, right: "auto", transformOrigin: "top left" } : undefined}
    >
      <div className="session-menu-list">
        <button type="button" role="menuitem" className="session-menu-item type-body-large" onClick={onRename}>
          <span className="session-menu-item-icon">
            <PencilLineGlyph />
          </span>
          <span className="session-menu-item-label">{t("rename", "Rename")}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="session-menu-item type-body-large"
          disabled={!sessionPath}
          onClick={(event) => {
            event.stopPropagation();
            void copy(sessionPath).then((ok) => setCopyFailed(!ok));
          }}
        >
          <span className="session-menu-item-icon">
            <CopyGlyph size={15} />
          </span>
          <span className="session-menu-item-label">{copyLabel}</span>
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
  subtree,
  onConfirm,
  onCancel,
}: {
  title: string;
  anchorRef: RefObject<HTMLElement | null>;
  blocked: boolean;
  busy: boolean;
  error: string | null;
  subtree: SessionSubtree;
  onConfirm: (event: ReactMouseEvent) => void;
  onCancel: (event: ReactMouseEvent | ReactKeyboardEvent) => void;
}) {
  const { t, language } = useI18n();
  const position = useAnchoredPosition(anchorRef);
  const subtreeError = subtree.status === "error" ? subtree.message : null;
  const runsWithChild = subtree.status === "ready" && subtree.running;
  const notice =
    error ??
    (blocked ? t("deleteRunningSessionBlocked", "This session is still running. Stop it before deleting.") : null) ??
    subtreeError ??
    (runsWithChild ? t("deleteRunningChildBlocked", "A sub-session is still running. Stop it before deleting.") : null);
  const childrenSentence =
    subtree.status === "ready" && subtree.count > 0
      ? (subtree.count === 1
          ? t("deleteSessionWithChild", "“{title}” and its sub-session will be deleted together. This can’t be undone.")
          : t(
              "deleteSessionWithChildren",
              "“{title}” and its {count} sub-sessions will be deleted together. This can’t be undone.",
            ).replace("{count}", formatNumber(subtree.count, language))
        ).replace("{title}", title)
      : null;
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
          {childrenSentence && <p className="session-menu-confirm-notice type-label-default">{childrenSentence}</p>}
          {notice && (
            <p
              role="alert"
              className="session-menu-confirm-notice type-label-default"
              data-tone={error || subtreeError ? "danger" : undefined}
            >
              {notice}
            </p>
          )}
        </div>
      </div>
      <div className="session-menu-confirm-footer">
        <Button
          variant="danger"
          busy={busy}
          disabled={blocked || busy || subtree.status !== "ready" || subtree.running}
          onClick={onConfirm}
        >
          {t("delete", "Delete")}
        </Button>
        <Button autoFocus disabled={busy} onClick={onCancel}>
          {t("cancel", "Cancel")}
        </Button>
      </div>
    </div>
  );
}
