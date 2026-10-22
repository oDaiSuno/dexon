import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { abbreviateHomePath } from "@/lib/display-path";
import { formatNumber, formatRelativeDateTime } from "@/lib/locale-format";
import { MAX_TREE_INDENT_DEPTH } from "@/lib/session-tree";
import type { SessionActivityStatus, SessionRelation } from "@shared/session-orchestration";
import { COUNTED_ACTIVITIES, type SubtreeActivity } from "@/lib/session-tree-status";
import {
  SessionRowCounts,
  SessionRowLead,
  SessionRowStatusSlot,
  sessionRowLabel,
  sessionRowShowsTime,
  sessionRowTitleClass,
} from "./session-row-status";
import { RowIcon } from "./session-relation-glyphs";
import { SessionItemActionsMenu, SessionItemDeleteConfirm } from "./session-item-actions";

// Moved verbatim from SessionSidebar.tsx in Phase 2 (session row split). The
// actions menu and status indicators now live in their own modules.

export function SessionItem({
  session,
  isSelected,
  isRunning,
  activity,
  relation,
  descendants = null,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
  homeDir = "",
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  activity: SessionActivityStatus;
  relation: SessionRelation | null;
  descendants?: SubtreeActivity | null;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  homeDir?: string;
}) {
  const { language, t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionsSummaryRef = useRef<HTMLButtonElement>(null);
  const restoreFocusFrameRef = useRef<number | null>(null);
  const selectInputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeActionsMenu = useCallback((restoreFocus = false) => {
    setActionsOpen(false);
    if (restoreFocus) {
      if (restoreFocusFrameRef.current !== null) window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null;
        actionsSummaryRef.current?.focus();
      });
    }
  }, []);

  useEffect(
    () => () => {
      if (restoreFocusFrameRef.current !== null) window.cancelAnimationFrame(restoreFocusFrameRef.current);
      if (selectInputTimerRef.current) clearTimeout(selectInputTimerRef.current);
    },
    [],
  );

  const title = getSessionDisplayTitle(session);
  const foldedDescendants = hasChildren && collapsed ? descendants : null;
  const showCounts = foldedDescendants ? COUNTED_ACTIVITIES.some((kind) => foldedDescendants.counts[kind] > 0) : false;

  const tooltipText = [
    title,
    `${t("messageCount", "{count} msgs").replace("{count}", formatNumber(session.messageCount, language))}${
      session.worktreeBranch ? ` · ${session.worktreeBranch}` : ""
    }`,
    session.cwd ? abbreviateHomePath(session.cwd, homeDir) : null,
    formatRelativeDateTime(session.modified, language),
  ]
    .filter(Boolean)
    .join("\n");

  const startRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      closeActionsMenu();
      setRenameValue(session.name ?? "");
      setRenaming(true);
      if (selectInputTimerRef.current) clearTimeout(selectInputTimerRef.current);
      selectInputTimerRef.current = setTimeout(() => {
        selectInputTimerRef.current = null;
        inputRef.current?.select();
      }, 0);
    },
    [closeActionsMenu, session.name],
  );

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        console.error("rename failed", body.error ?? res.status);
        return;
      }
      onRenamed?.();
    } catch (e) {
      console.error("rename failed", e);
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      closeActionsMenu();
      // ISSUE-001: block delete while agent is running
      if (isRunning) {
        window.alert(t("deleteRunningSessionBlocked", "This session is still running. Stop it before deleting."));
        return;
      }
      setConfirmDelete(true);
    },
    [closeActionsMenu, isRunning, t],
  );

  const handleDeleteConfirm = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isRunning) {
        window.alert(t("deleteRunningSessionBlocked", "This session is still running. Stop it before deleting."));
        setConfirmDelete(false);
        return;
      }
      setConfirmDelete(false);
      setDeleting(true);
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          window.alert(
            body.error ??
              t("deleteSessionFailedStatus", "Delete failed ({status})").replace("{status}", String(res.status)),
          );
          setDeleting(false);
          return;
        }
        onDeleted?.(session.id);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
        setDeleting(false);
      }
    },
    [session.id, onDeleted, isRunning, t],
  );

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const ITEM_HEIGHT = 30;
  const rowBackground = confirmDelete
    ? "var(--fx-status-danger-soft)"
    : renaming
      ? "var(--fx-surface-raised)"
      : isSelected || actionsOpen
        ? "var(--fx-surface-selected)"
        : hovered
          ? "var(--fx-surface-hover)"
          : "transparent";
  const rowBorder = confirmDelete
    ? "var(--fx-status-danger-border)"
    : renaming
      ? "var(--fx-accent-blue)"
      : "transparent";
  const titleTone = sessionRowTitleClass({ activity, relation, isSelected });
  const showTime = !showCounts && depth < MAX_TREE_INDENT_DEPTH && sessionRowShowsTime(activity);

  return (
    <div
      role="listitem"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
      }}
      style={{
        height: ITEM_HEIGHT,
        position: "relative",
        zIndex: actionsOpen ? 20 : undefined,
        display: "flex",
        alignItems: "center",
        margin: "0 4px 1px",
        paddingLeft: Math.min(depth, MAX_TREE_INDENT_DEPTH) * 12 + 7,
        paddingRight: 7,
        cursor: renaming ? "text" : "pointer",
        background: rowBackground,
        border: `1px solid ${rowBorder}`,
        boxShadow: renaming ? "0 0 0 3px var(--fx-accent-blue-soft)" : undefined,
        borderRadius: "var(--radius-control)",
        transition:
          "background var(--duration-quick) var(--ease-smooth-out), border-color var(--duration-quick) var(--ease-smooth-out)",
        opacity: deleting ? 0.5 : 1,
        gap: 8,
        overflow: "visible",
      }}
    >
      {confirmDelete ? (
        <SessionItemDeleteConfirm title={title} onConfirm={handleDeleteConfirm} onCancel={handleDeleteCancel} />
      ) : renaming ? (
        <>
          <SessionRowLead activity={activity} relation={relation} />
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            autoFocus
            className="session-rename-input type-body-large"
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              padding: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              color: "var(--fx-text-primary)",
            }}
          />
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              closeActionsMenu();
              onClick();
            }}
            aria-current={isSelected ? "page" : undefined}
            aria-label={sessionRowLabel({ title, activity, relation, descendants: foldedDescendants, t })}
            title={tooltipText}
            style={{
              alignSelf: "stretch",
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: 0,
              border: 0,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              font: "inherit",
              textAlign: "left",
            }}
          >
            <SessionRowLead activity={activity} relation={relation} />
            <span
              data-session-row-title
              className={titleTone.className}
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: titleTone.color,
              }}
            >
              {title}
            </span>
            {showCounts && foldedDescendants && <SessionRowCounts counts={foldedDescendants.counts} />}
            <SessionRowStatusSlot activity={activity} />
            {showTime && (
              <span
                data-session-row-time
                className="type-label-default"
                style={{
                  flexShrink: 0,
                  color: activity === "unread" ? "var(--fx-accent-blue-text)" : "var(--fx-text-tertiary)",
                  whiteSpace: "nowrap",
                }}
              >
                {formatRelativeDateTime(session.modified, language)}
              </span>
            )}
          </button>

          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.();
              }}
              title={collapsed ? t("expandForks", "Expand forks") : t("collapseForks", "Collapse forks")}
              aria-label={collapsed ? t("expandForks", "Expand forks") : t("collapseForks", "Collapse forks")}
              aria-expanded={!collapsed}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                padding: 0,
                flexShrink: 0,
                background: "transparent",
                border: "none",
                borderRadius: "var(--radius-chip)",
                color: "var(--fx-text-tertiary)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  transform: collapsed ? "rotate(-90deg)" : "none",
                  transition: "transform var(--duration-quick) var(--ease-smooth-out)",
                }}
              >
                <RowIcon size={14} strokeWidth={2}>
                  <path d="m6 9 6 6 6-6" />
                </RowIcon>
              </span>
            </button>
          )}

          <div
            ref={actionsRef}
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              closeActionsMenu();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !actionsOpen) return;
              event.preventDefault();
              closeActionsMenu(true);
            }}
            style={{ position: "absolute", top: 2, right: hasChildren ? 30 : 4, flexShrink: 0 }}
          >
            <button
              type="button"
              ref={actionsSummaryRef}
              className="session-actions-summary"
              title={t("sessionActions", "Session actions")}
              aria-label={t("sessionActionsFor", "Session actions for {title}").replace("{title}", title)}
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              onClick={(event) => {
                event.stopPropagation();
                setActionsOpen((open) => !open);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                padding: 0,
                background: actionsOpen || hovered ? rowBackground : "transparent",
                border: "1px solid transparent",
                borderRadius: "var(--radius-chip)",
                color: actionsOpen ? "var(--fx-text-primary)" : "var(--fx-text-tertiary)",
                cursor: "pointer",
                opacity: actionsOpen || hovered ? 1 : 0,
                pointerEvents: actionsOpen || hovered ? "auto" : "none",
                transition: "opacity var(--duration-quick) var(--ease-smooth-out)",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="19" cy="12" r="1.7" />
              </svg>
            </button>
            {actionsOpen && <SessionItemActionsMenu onRename={startRename} onDelete={handleDeleteClick} />}
          </div>
        </>
      )}
    </div>
  );
}
