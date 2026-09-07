import { useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery } from "@/lib/session-list";
import { SessionGroupsSection } from "./session-groups";

// Phase 4 refactor: the search input and its filter state stay here (old
// sidebar presentation), while the three date groups, the derived tree and
// the loading/error/empty states moved into the shared SessionGroupsSection
// consumed verbatim by the new navigation history as well.

export function SessionList({
  projectSessions,
  loading,
  error,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  homeDir,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
}: {
  projectSessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  homeDir: string;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed: () => void;
  onSessionDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const [sessionFilter, setSessionFilter] = useState("");

  const filteredSessions = filterSessionsForQuery(projectSessions, sessionFilter);

  return (
    <nav
      aria-label={t("sessions", "Sessions")}
      style={{ flex: "1 1 auto", overflowY: "auto", padding: "0", minHeight: 80 }}
    >
      <div style={{ padding: "12px 12px 8px" }}>
        <div
          style={{
            padding: "0 4px 8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            color: "var(--text-dim)",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          <span>{t("sessions", "Sessions")}</span>
          <span aria-label={t("sessionCount", "{count} sessions").replace("{count}", String(filteredSessions.length))}>
            {filteredSessions.length}
          </span>
        </div>
        <div style={{ position: "relative" }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-dim)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16.5" y2="16.5" />
          </svg>
          <input
            type="search"
            value={sessionFilter}
            onChange={(event) => setSessionFilter(event.target.value)}
            placeholder={t("searchSessions", "Search sessions")}
            aria-label={t("searchSessions", "Search sessions")}
            style={{
              width: "100%",
              height: 34,
              padding: "0 32px 0 32px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontSize: "var(--text-body)",
              outline: "none",
            }}
          />
          {sessionFilter && (
            <button
              type="button"
              onClick={() => setSessionFilter("")}
              title={t("clearSessionSearch", "Clear session search")}
              aria-label={t("clearSessionSearch", "Clear session search")}
              style={{
                position: "absolute",
                top: 1,
                right: 1,
                width: 32,
                height: 32,
                border: 0,
                borderRadius: "var(--radius-card)",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: "var(--text-heading-lg)",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>
      <SessionGroupsSection
        sessions={filteredSessions}
        loading={loading}
        error={error}
        hasActiveFilter={sessionFilter.trim().length > 0}
        selectedSessionId={selectedSessionId}
        runningSessionIds={runningSessionIds}
        unreadSessionIds={unreadSessionIds}
        homeDir={homeDir}
        onSelectSession={onSelectSession}
        onRenamed={onRenamed}
        onSessionDeleted={onSessionDeleted}
      />
    </nav>
  );
}
