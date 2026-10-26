import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { abbreviateHomePath } from "@/lib/display-path";
import { formatNumber, formatRelativeDateTime, formatShortRelativeTime } from "@/lib/locale-format";
import { useSessionNaming } from "@/lib/session-naming-store";
import { getSessionNamingModel, regenerateSessionTitle } from "@/lib/auto-session-title";
import { requestModelSettings } from "@/lib/model-settings-request";
import type { SessionActivityStatus, SessionRelation } from "@shared/session-orchestration";
import type { SubtreeActivity } from "@/lib/session-tree-status";
import {
  SessionRowCount,
  SessionRowLead,
  SessionRowStatusSlot,
  sessionRowIndicatedActivity,
  sessionRowLabel,
  sessionRowShowsTime,
  sessionRowTitleClass,
} from "./session-row-status";
import { ExpandChevronGlyph } from "./session-relation-glyphs";
import { SessionItemActionsMenu, SessionItemDeleteConfirm } from "./session-item-actions";
import { useSessionDelete } from "./use-session-delete";

export function SessionItem({
  session,
  isSelected,
  isRunning,
  activity,
  relation,
  descendants = null,
  descendantCount = 0,
  onClick,
  onRenamed,
  onDeleted,
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
  descendantCount?: number;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  homeDir?: string;
}) {
  const { language, t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const naming = useSessionNaming(session.id);
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionsSummaryRef = useRef<HTMLButtonElement>(null);
  const pointerFocusRef = useRef(false);
  const restoreFocusFrameRef = useRef<number | null>(null);
  const selectInputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeActionsMenu = useCallback((restoreFocus = false) => {
    setActionsOpen(false);
    setMenuAt(null);
    if (restoreFocus) {
      if (restoreFocusFrameRef.current !== null) window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null;
        actionsSummaryRef.current?.focus();
      });
    }
  }, []);

  const deletion = useSessionDelete({
    sessionId: session.id,
    isRunning: Boolean(isRunning),
    onDeleted,
    onOpen: closeActionsMenu,
    returnFocusRef: actionsSummaryRef,
  });

  useEffect(
    () => () => {
      if (restoreFocusFrameRef.current !== null) window.cancelAnimationFrame(restoreFocusFrameRef.current);
      if (selectInputTimerRef.current) clearTimeout(selectInputTimerRef.current);
    },
    [],
  );

  const title = getSessionDisplayTitle(session);
  const regenerate = actionsOpen
    ? !getSessionNamingModel()
      ? "needs-model"
      : naming || session.messageCount === 0 || !session.firstMessage.trim()
        ? "unavailable"
        : "ready"
    : "unavailable";
  const foldedDescendants = hasChildren && collapsed ? descendants : null;
  const details = [
    foldedDescendants
      ? t("sessionChildCount", "{count} sub-sessions").replace("{count}", formatNumber(descendantCount, language))
      : null,
    `${t("messageCount", "{count} msgs").replace("{count}", formatNumber(session.messageCount, language))}${
      session.worktreeBranch ? ` · ${session.worktreeBranch}` : ""
    }`,
    session.cwd ? abbreviateHomePath(session.cwd, homeDir) : null,
    formatRelativeDateTime(session.modified, language),
  ]
    .filter(Boolean)
    .join(" · ");

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

  const regenerateName = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      closeActionsMenu(true);
      void regenerateSessionTitle(session.id, session.firstMessage).then((name) => {
        if (name) onRenamed?.();
      });
    },
    [closeActionsMenu, onRenamed, session.firstMessage, session.id],
  );

  const openNamingSettings = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      closeActionsMenu();
      requestModelSettings();
    },
    [closeActionsMenu],
  );

  const ITEM_HEIGHT = 30;
  const rowBackground = renaming
    ? "var(--fx-surface-raised)"
    : isSelected || actionsOpen || deletion.open
      ? "var(--fx-surface-selected)"
      : hovered
        ? "var(--fx-surface-hover)"
        : "transparent";
  const titleTone = sessionRowTitleClass({ activity, relation, isSelected, naming });
  const indicated = sessionRowIndicatedActivity(activity, foldedDescendants);
  const showTime = !naming && sessionRowShowsTime(indicated);
  const agentDone = relation === "delegate" && activity === "idle";
  const revealed = hovered || keyboardFocus || actionsOpen;

  return (
    <div
      ref={rowRef}
      role="listitem"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onMouseDown={() => {
        pointerFocusRef.current = true;
      }}
      onFocus={() => {
        setKeyboardFocus(!pointerFocusRef.current);
        pointerFocusRef.current = false;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocus(false);
      }}
      onContextMenu={
        renaming
          ? undefined
          : (event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenuAt({ x: event.clientX, y: event.clientY });
              setActionsOpen(true);
            }
      }
      style={{
        height: ITEM_HEIGHT,
        position: "relative",
        zIndex: actionsOpen ? 20 : undefined,
        display: "flex",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
        padding: "0 8px",
        cursor: renaming ? "text" : "pointer",
        background: rowBackground,
        boxShadow: renaming ? "inset 0 0 0 1px var(--fx-accent-blue), 0 0 0 3px var(--fx-accent-blue-soft)" : undefined,
        borderRadius: "var(--radius-row)",
        transition: "background var(--duration-quick) var(--ease-smooth-out)",
        gap: 8,
        overflow: "visible",
      }}
    >
      {renaming ? (
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
            aria-label={sessionRowLabel({
              title,
              activity,
              relation,
              naming,
              descendants: foldedDescendants,
              t,
            })}
            aria-description={details}
            style={{
              alignSelf: "stretch",
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: 0,
              paddingRight: revealed ? 28 : 0,
              border: 0,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              font: "inherit",
              textAlign: "left",
              transition: "padding-right var(--duration-quick) var(--ease-smooth-out)",
            }}
          >
            <SessionRowLead activity={activity} relation={relation} naming={naming} />
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
            {foldedDescendants && <SessionRowCount count={descendantCount} />}
            {!naming && <SessionRowStatusSlot activity={indicated} />}
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
                {agentDone ? t("sessionAgentDone", "Done") : formatShortRelativeTime(session.modified, language)}
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
              aria-label={collapsed ? t("expandForks", "Expand forks") : t("collapseForks", "Collapse forks")}
              aria-expanded={!collapsed}
              style={{
                display: "flex",
                width: 14,
                height: 14,
                padding: 0,
                flexShrink: 0,
                background: "transparent",
                border: "none",
                color: "var(--fx-text-tertiary)",
                cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform var(--duration-quick) var(--ease-smooth-out)",
              }}
            >
              <ExpandChevronGlyph />
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
            style={{ position: "absolute", top: 3, right: hasChildren ? 26 : 4, flexShrink: 0 }}
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
                setMenuAt(null);
                setActionsOpen((open) => !open);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                padding: 0,
                background: revealed ? rowBackground : "transparent",
                border: "1px solid transparent",
                borderRadius: "var(--radius-chip)",
                color: actionsOpen ? "var(--fx-text-primary)" : "var(--fx-text-tertiary)",
                cursor: "pointer",
                opacity: revealed ? 1 : 0,
                pointerEvents: revealed ? "auto" : "none",
                transition: "opacity var(--duration-quick) var(--ease-smooth-out)",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="19" cy="12" r="1.7" />
              </svg>
            </button>
            {actionsOpen && (
              <SessionItemActionsMenu
                at={menuAt}
                sessionPath={session.path}
                onRename={startRename}
                regenerate={regenerate}
                onRegenerate={regenerateName}
                onOpenNamingSettings={openNamingSettings}
                onDelete={deletion.requestDelete}
              />
            )}
          </div>
          {deletion.open && (
            <SessionItemDeleteConfirm
              title={title}
              anchorRef={rowRef}
              blocked={Boolean(isRunning)}
              subtree={deletion.subtree}
              busy={deletion.busy}
              error={deletion.error}
              onConfirm={deletion.confirm}
              onCancel={deletion.cancel}
            />
          )}
        </>
      )}
    </div>
  );
}
