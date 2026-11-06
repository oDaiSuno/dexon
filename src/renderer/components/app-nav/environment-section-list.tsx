import { useState } from "react";
import type { EnvironmentView } from "@contract/environment";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery, projectSessionGroups } from "@/lib/session-list";
import { spaceFolderName } from "@/lib/space-identity";
import { ProjectSessionList, SessionListStatus, type SessionListHandlers } from "../session-sidebar/session-groups";
import { ProjectRow } from "./project-row";

export interface RemoteEnvironmentGroup extends SessionListHandlers {
  environment: EnvironmentView;
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  onConnect: () => Promise<unknown>;
  onDisconnect: () => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}

function EnvironmentSection({ group, query }: { group: RemoteEnvironmentGroup; query: string }) {
  const { t } = useI18n();
  const [openProjects, setOpenProjects] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [foldedSessionIds, setFoldedSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const phase = group.environment.status.phase;
  const connected = phase === "connected";
  const connecting = phase === "connecting" || phase === "backoff";
  const status = {
    available: t("environmentAvailable", "Available"),
    connected: t("environmentConnected", "Connected"),
    connecting: t("environmentConnecting", "Connecting"),
    backoff: t("environmentBackoff", "Retrying"),
    blocked: t("environmentBlocked", "Blocked"),
    offline: t("environmentOffline", "Offline"),
  }[phase];
  const searching = query.trim().length > 0;
  const projects = projectSessionGroups(group.sessions, { currentProject: "", environmentId: group.environment.id })
    .map((project) => ({ ...project, visible: filterSessionsForQuery([...project.sessions], query) }))
    .filter((project) => !searching || project.visible.length > 0);
  const perform = (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    void action()
      .catch((cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setBusy(false));
  };
  const buttonClass =
    "type-caption rounded px-1 py-1 text-[var(--fx-text-secondary)] hover:bg-[var(--fx-surface-hover)] disabled:opacity-50";

  return (
    <div
      data-environment-id={group.environment.id}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-1)",
          borderTop: "1px solid var(--fx-line-subtle)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="type-label-medium"
            style={{
              color: "var(--fx-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {group.environment.label}
          </div>
          <div className="type-caption" role="status" style={{ color: "var(--fx-text-tertiary)" }}>
            {status}
          </div>
        </div>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => perform(connected || connecting ? group.onDisconnect : group.onConnect)}
        >
          {connected || connecting ? t("environmentDisconnect", "Disconnect") : t("environmentConnect", "Connect")}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => perform(group.onRemove)}>
          {t("environmentRemove", "Remove")}
        </button>
      </div>
      <SessionListStatus
        loading={group.loading}
        error={
          actionError ??
          group.error ??
          (group.environment.status.phase === "blocked" ? group.environment.status.diagnosis.detail : null)
        }
        empty={connected && projects.length === 0}
        hasActiveFilter={searching}
      />
      <div
        role="list"
        aria-label={group.environment.label}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
      >
        {projects.map((project) => {
          const open = searching || (openProjects.get(project.key) ?? true);
          return (
            <ProjectRow
              key={project.key}
              name={spaceFolderName(project.root)}
              path={project.root}
              count={project.visible.length}
              countLabel={t("sessionCount", "{count} sessions").replace("{count}", String(project.visible.length))}
              open={open}
              current={project.sessions.some((session) => session.id === group.selectedSessionId)}
              onToggle={() => setOpenProjects((current) => new Map(current).set(project.key, !open))}
            >
              {open && (
                <ProjectSessionList
                  {...group}
                  sessions={project.visible}
                  foldedSessionIds={foldedSessionIds}
                  onToggleFold={(id) =>
                    setFoldedSessionIds((current) => {
                      const next = new Set(current);
                      if (!next.delete(id)) next.add(id);
                      return next;
                    })
                  }
                />
              )}
            </ProjectRow>
          );
        })}
      </div>
    </div>
  );
}

export function EnvironmentSectionList({
  remoteGroups,
  query,
}: {
  remoteGroups: readonly RemoteEnvironmentGroup[];
  query: string;
}) {
  if (remoteGroups.length === 0) return null;
  return (
    <>
      {remoteGroups.map((group) => (
        <EnvironmentSection key={group.environment.id} group={group} query={query} />
      ))}
    </>
  );
}
