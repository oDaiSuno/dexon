import type { SessionInfo } from "@/lib/types";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import { useI18n } from "@/i18n";
import { sessionDateGroup, type SessionDateGroup } from "@/lib/session-list";
import { buildSessionTree } from "@/lib/session-tree";
import type { SessionActivitySignals } from "@/lib/session-tree-status";
import { SessionTreeItem } from "./session-tree-item";

export function SessionGroupsSection({
  sessions,
  loading,
  error,
  hasActiveFilter,
  selectedSessionId,
  liveStatuses,
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
  liveStatuses?: Record<string, SessionLiveStatus>;
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

  const signals: SessionActivitySignals = { liveStatuses: liveStatuses ?? {}, runningSessionIds, unreadSessionIds };
  const sessionTree = buildSessionTree(sessions);
  const sessionGroups: { id: SessionDateGroup; label: string; nodes: typeof sessionTree }[] = [
    { id: "today", label: t("sessionsToday", "Today"), nodes: [] },
    { id: "recent", label: t("sessionsRecent", "Last 7 days"), nodes: [] },
    { id: "older", label: t("sessionsOlder", "Older"), nodes: [] },
  ];
  for (const node of sessionTree) {
    sessionGroups.find((group) => group.id === sessionDateGroup(node.activity))?.nodes.push(node);
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
                      signals={signals}
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
