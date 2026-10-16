import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { sessionDateGroup, type SessionDateGroup } from "@/lib/session-list";
import { buildSessionTree } from "@/lib/session-tree";
import { SessionTreeItem } from "./session-tree-item";

// Extracted in Phase 4 from session-list.tsx so the old sidebar and the new
// navigation history render the same three date groups, the derived tree and
// the loading/error/empty states. Presentation only: consumers pass the
// already-filtered sessions and own the search/filter state.

export function SessionGroupsSection({
  sessions,
  loading,
  error,
  hasActiveFilter,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  homeDir,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  foldedSessionIds,
  onToggleFold,
}: {
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  hasActiveFilter: boolean;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  homeDir: string;
  onSelectSession: (session: SessionInfo) => void;
  onRenamed: () => void;
  onSessionDeleted: (id: string) => void;
  foldedSessionIds?: ReadonlySet<string>;
  onToggleFold?: (sessionId: string) => void;
}) {
  const { t } = useI18n();

  const sessionTree = buildSessionTree(sessions);
  const sessionGroups: { id: SessionDateGroup; label: string; nodes: typeof sessionTree }[] = [
    { id: "today", label: t("sessionsToday", "Today"), nodes: [] },
    { id: "recent", label: t("sessionsRecent", "Last 7 days"), nodes: [] },
    { id: "older", label: t("sessionsOlder", "Older"), nodes: [] },
  ];
  for (const node of sessionTree) {
    sessionGroups.find((group) => group.id === sessionDateGroup(node.session.modified))?.nodes.push(node);
  }

  return (
    <>
      {loading && (
        <div style={{ padding: "16px 16px", color: "var(--text-muted)", fontSize: "var(--text-label)" }}>
          {t("loading", "Loading…")}
        </div>
      )}
      {error && (
        <div style={{ padding: "12px 16px", color: "var(--danger)", fontSize: "var(--text-label)" }}>{error}</div>
      )}
      {!loading && !error && sessions.length === 0 && (
        <div style={{ padding: "16px 16px", color: "var(--text-muted)", fontSize: "var(--text-body)" }}>
          {hasActiveFilter
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
                      foldedSessionIds={foldedSessionIds}
                      onToggleFold={onToggleFold}
                    />
                  ))}
                </div>
              </section>
            ),
        )}
      </div>
    </>
  );
}
