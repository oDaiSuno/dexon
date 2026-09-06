import { useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery, sessionDateGroup, type SessionDateGroup } from "@/lib/session-list";
import { buildSessionTree } from "@/lib/session-tree";
import { SessionTreeItem } from "./session-tree-item";

// Moved verbatim from SessionSidebar.tsx in Phase 2 (session list split). The
// search input and its filter state are owned here; the project-scoped session
// list arrives from the composition root.

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

  // Build parent-child tree within the filtered set
  const sessionTree = buildSessionTree(filteredSessions);
  const sessionGroups: { id: SessionDateGroup; label: string; nodes: typeof sessionTree }[] = [
    { id: "today", label: t("sessionsToday", "Today"), nodes: [] },
    { id: "recent", label: t("sessionsRecent", "Last 7 days"), nodes: [] },
    { id: "older", label: t("sessionsOlder", "Older"), nodes: [] },
  ];
  for (const node of sessionTree) {
    sessionGroups.find((group) => group.id === sessionDateGroup(node.session.modified))?.nodes.push(node);
  }

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
      {loading && (
        <div style={{ padding: "16px 16px", color: "var(--text-muted)", fontSize: "var(--text-label)" }}>
          {t("loading", "Loading…")}
        </div>
      )}
      {error && (
        <div style={{ padding: "12px 16px", color: "var(--danger)", fontSize: "var(--text-label)" }}>{error}</div>
      )}
      {!loading && !error && filteredSessions.length === 0 && (
        <div style={{ padding: "16px 16px", color: "var(--text-muted)", fontSize: "var(--text-body)" }}>
          {sessionFilter.trim()
            ? t("noMatchingSessions", "No matching sessions")
            : t("noSessionsFound", "No sessions found")}
        </div>
      )}
      <div style={{ padding: "0 8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        {sessionGroups.map(
          (group) =>
            group.nodes.length > 0 && (
              <section key={group.id} aria-labelledby={`session-group-${group.id}`}>
                <div
                  id={`session-group-${group.id}`}
                  style={{
                    padding: "8px 8px 4px",
                    color: "var(--text-dim)",
                    fontSize: "var(--text-label)",
                    fontWeight: 650,
                  }}
                >
                  {group.label}
                </div>
                <div role="list" style={{ display: "flex", flexDirection: "column" }}>
                  {group.nodes.map((node) => (
                    <SessionTreeItem
                      key={node.session.id}
                      node={node}
                      selectedSessionId={selectedSessionId}
                      runningSessionIds={runningSessionIds}
                      unreadSessionIds={unreadSessionIds}
                      onSelectSession={onSelectSession}
                      onRenamed={onRenamed}
                      onSessionDeleted={onSessionDeleted}
                      depth={0}
                      homeDir={homeDir}
                    />
                  ))}
                </div>
              </section>
            ),
        )}
      </div>
    </nav>
  );
}
