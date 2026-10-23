import type { SessionInfo } from "@/lib/types";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import { useI18n } from "@/i18n";
import { buildSessionTree } from "@/lib/session-tree";
import type { SessionActivitySignals } from "@/lib/session-tree-status";
import { SessionTreeItem } from "./session-tree-item";

export interface SessionListHandlers {
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
}

export function SessionListStatus({
  loading,
  error,
  empty,
  hasActiveFilter,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  hasActiveFilter: boolean;
}) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="type-label-default" style={{ padding: "8px 10px", color: "var(--fx-text-secondary)" }}>
        {t("loading", "Loading…")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="type-label-default" style={{ padding: "8px 10px", color: "var(--fx-status-danger-text)" }}>
        {error}
      </div>
    );
  }
  if (!empty) return null;
  return (
    <div className="type-body-default" style={{ padding: "6px 10px", color: "var(--fx-text-secondary)" }}>
      {hasActiveFilter ? t("noMatchingSessions", "No matching sessions") : t("noSessionsFound", "No sessions found")}
    </div>
  );
}

export function ProjectSessionList({ sessions, ...handlers }: { sessions: SessionInfo[] } & SessionListHandlers) {
  const signals: SessionActivitySignals = {
    liveStatuses: handlers.liveStatuses ?? {},
    runningSessionIds: handlers.runningSessionIds,
    unreadSessionIds: handlers.unreadSessionIds,
  };
  const sessionTree = buildSessionTree(sessions);

  return (
    <div style={{ paddingLeft: "var(--space-4)" }}>
      <div
        role="list"
        data-project-guide
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          paddingLeft: "var(--space-1)",
          borderLeft: "1px solid var(--fx-line-default)",
        }}
      >
        {sessionTree.map((node) => (
          <SessionTreeItem
            key={node.session.id}
            node={node}
            selectedSessionId={handlers.selectedSessionId}
            signals={signals}
            onSelectSession={handlers.onSelectSession}
            onRenamed={handlers.onRenamed}
            onSessionDeleted={handlers.onSessionDeleted}
            depth={0}
            homeDir={handlers.homeDir}
            foldedSessionIds={handlers.foldedSessionIds}
            onToggleFold={handlers.onToggleFold}
          />
        ))}
      </div>
    </div>
  );
}
