import { useState, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery } from "@/lib/session-list";
import { SessionGroupsSection } from "../session-sidebar/session-groups";

// Phase 4: history region of the new navigation. The search is on-demand
// (N09): the header row shows the title and the search/refresh/new controls;
// the search icon replaces the row with a focused input; closing via the
// clear button or Escape clears the filter, and collapsing the sidebar
// unmounts this region so the filter starts empty next time.

function IconButton({
  label,
  onClick,
  children,
  searchToggle = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  searchToggle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      {...(searchToggle ? { "data-nav-search-toggle": true } : {})}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        padding: 0,
        flexShrink: 0,
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-control)",
        color: "var(--fx-text-tertiary)",
        cursor: "pointer",
        transition:
          "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--fx-surface-hover)";
        e.currentTarget.style.color = "var(--fx-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--fx-text-tertiary)";
      }}
    >
      {children}
    </button>
  );
}

export function NavHistory({
  sessions,
  loading,
  error,
  selectedSessionId,
  liveStatuses,
  runningSessionIds,
  unreadSessionIds,
  homeDir,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  onRefreshSessions,
  foldedSessionIds,
  onToggleFold,
}: {
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  selectedSessionId: string | null;
  liveStatuses?: Record<string, SessionLiveStatus>;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  homeDir: string;
  onSelectSession: (session: SessionInfo) => void;
  onRenamed: () => void;
  onSessionDeleted: (id: string) => void;
  onRefreshSessions: () => void;
  foldedSessionIds?: ReadonlySet<string>;
  onToggleFold?: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [sessionFilter, setSessionFilter] = useState("");

  const filteredSessions = filterSessionsForQuery(sessions, sessionFilter);

  const closeSearch = () => {
    setSearchOpen(false);
    setSessionFilter("");
  };

  return (
    <nav
      aria-label={t("navHistory", "History")}
      style={{ flex: "1 1 auto", overflowY: "auto", minHeight: 80, display: "flex", flexDirection: "column" }}
    >
      <div
        style={{
          minHeight: 28,
          padding: "0 var(--space-3) 0 22px",
          marginBottom: "var(--space-1)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-1)",
          flexShrink: 0,
        }}
      >
        {searchOpen ? (
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 9,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--fx-text-tertiary)",
                pointerEvents: "none",
              }}
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.5" y2="16.5" />
            </svg>
            <input
              type="search"
              autoFocus
              value={sessionFilter}
              onChange={(event) => setSessionFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                closeSearch();
              }}
              placeholder={t("searchSessions", "Search sessions")}
              aria-label={t("searchSessions", "Search sessions")}
              className="type-body-large"
              style={{
                width: "100%",
                height: 28,
                padding: "0 28px 0 28px",
                border: "1px solid var(--fx-line-subtle)",
                borderRadius: "var(--radius-control)",
                background: "var(--fx-surface-raised)",
                color: "var(--fx-text-primary)",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={closeSearch}
              title={t("clearSessionSearch", "Clear session search")}
              aria-label={t("clearSessionSearch", "Clear session search")}
              className="type-title-section"
              style={{
                position: "absolute",
                top: 1,
                right: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                padding: 0,
                border: 0,
                borderRadius: "var(--radius-control)",
                background: "transparent",
                color: "var(--fx-text-tertiary)",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        ) : (
          <>
            <span className="type-label-medium" style={{ color: "var(--fx-text-tertiary)", flexShrink: 0 }}>
              {t("navHistory", "History")}
            </span>
            <span
              aria-label={t("sessionCount", "{count} sessions").replace("{count}", String(filteredSessions.length))}
              className="type-mono-meta"
              style={{ color: "var(--fx-text-tertiary)", flexShrink: 0 }}
            >
              {filteredSessions.length}
            </span>
            <span style={{ flex: 1 }} />
            <IconButton label={t("searchSessions", "Search sessions")} onClick={() => setSearchOpen(true)} searchToggle>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="20" y1="20" x2="16.5" y2="16.5" />
              </svg>
            </IconButton>
            <IconButton label={t("refresh", "Refresh")} onClick={onRefreshSessions}>
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
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            </IconButton>
          </>
        )}
      </div>
      <SessionGroupsSection
        sessions={filteredSessions}
        loading={loading}
        error={error}
        hasActiveFilter={sessionFilter.trim().length > 0}
        selectedSessionId={selectedSessionId}
        liveStatuses={liveStatuses}
        runningSessionIds={runningSessionIds}
        unreadSessionIds={unreadSessionIds}
        homeDir={homeDir}
        onSelectSession={onSelectSession}
        onRenamed={onRenamed}
        onSessionDeleted={onSessionDeleted}
        foldedSessionIds={foldedSessionIds}
        onToggleFold={onToggleFold}
      />
    </nav>
  );
}
