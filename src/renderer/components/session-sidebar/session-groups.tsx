import { useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import { useI18n } from "@/i18n";
import { buildSessionTree } from "@/lib/session-tree";
import { partitionSessionRoots } from "@/lib/session-root-batch";
import type { SessionActivity, SessionActivitySignals } from "@/lib/session-tree-status";
import { SessionTreeItem } from "./session-tree-item";

export interface SessionListHandlers {
  selectedSessionId: string | null;
  activity?: SessionActivity;
  liveStatuses?: Record<string, SessionLiveStatus>;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  homeDir: string;
  onSelectSession: (session: SessionInfo) => void;
  onRenamed: () => void;
  onSessionDeleted: (id: string) => void;
  expandedSessionIds?: ReadonlySet<string>;
  onToggleExpand?: (sessionId: string) => void;
  searching?: boolean;
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
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const signals: SessionActivity | SessionActivitySignals = handlers.activity ?? {
    liveStatuses: handlers.liveStatuses ?? {},
    runningSessionIds: handlers.runningSessionIds,
    unreadSessionIds: handlers.unreadSessionIds,
  };
  const sessionTree = buildSessionTree(sessions);
  const { visible, hiddenCount } =
    showAll || handlers.searching
      ? { visible: sessionTree, hiddenCount: 0 }
      : partitionSessionRoots(sessionTree, {
          now: Date.now(),
          signals,
          selectedSessionId: handlers.selectedSessionId,
        });

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
        {visible.map((node) => (
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
            expandedSessionIds={handlers.expandedSessionIds}
            onToggleExpand={handlers.onToggleExpand}
            searching={handlers.searching}
          />
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-label={t("loadMoreSessions", "Load more sessions")}
          onClick={() => setShowAll(true)}
          style={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            width: "100%",
            height: 24,
            boxSizing: "border-box",
            padding: "2px 8px 0",
            gap: 6,
            border: 0,
            borderTop: "1px solid var(--fx-line-default)",
            background: "transparent",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span className="type-meta-default" style={{ flex: 1, color: "var(--fx-text-tertiary)" }}>
            {t("loadMoreSessions", "Load more sessions")}
          </span>
          <span className="type-mono-meta" style={{ color: "var(--fx-text-secondary)" }}>
            {hiddenCount}
          </span>
        </button>
      )}
    </div>
  );
}
