import { useEffect, useRef, useState, type ReactNode } from "react";
import { PRIMARY_ENVIRONMENT_ID, qualifySessionKey } from "@contract/environment";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery } from "@/lib/session-list";
import { ProjectSessionList, SessionListStatus, type SessionListHandlers } from "../session-sidebar/session-groups";
import { projectRowFace } from "./project-row-status";
import { ProjectRow } from "./project-row";
import { useProjectDrag } from "./use-project-drag";
import { ChevronsGlyph, HeaderButton } from "./section-header-buttons";
import type { SwitcherProject } from "./project-switcher-card";
import type { ProjectSpaceRow } from "./project-space-rows";

export interface RevealRequest {
  readonly seq: number;
  readonly sessionId: string;
  readonly environmentId?: string;
}

export interface ProjectTreeOptions {
  expandedProjects?: ReadonlyMap<string, boolean>;
  onToggleProject?: (key: string, open: boolean) => void;
  renderSwitcher?: (switchTargets: readonly SwitcherProject[]) => ReactNode;
  onReorderProjects?: (from: number, to: number) => void;
  renderProjectActions?: (name: string, revealed: boolean, project: ProjectSpaceRow) => ReactNode;
  onEnvironmentRefresh?: (environmentId: string) => void;
  onEnvironmentSessionDeleted?: (environmentId: string, sessionId: string) => void;
}

function SectionHeader({ actions }: { actions: ReactNode }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 28,
        padding: "0 6px 0 10px",
        flexShrink: 0,
      }}
    >
      <span className="type-label-medium" style={{ color: "var(--fx-text-tertiary)" }}>
        {t("navHistory", "Project spaces")}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>{actions}</div>
    </div>
  );
}

export function NavHistory({
  rows,
  query,
  loading,
  error,
  tree,
  revealRequest,
  selectedEnvironmentId = PRIMARY_ENVIRONMENT_ID,
  ...handlers
}: {
  rows: readonly ProjectSpaceRow[];
  query: string;
  loading: boolean;
  error: string | null;
  tree: ProjectTreeOptions;
  revealRequest?: RevealRequest | null;
  selectedEnvironmentId?: string;
} & SessionListHandlers) {
  const { t } = useI18n();
  const [localOpen, setLocalOpen] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const expandedProjects = tree.expandedProjects ?? localOpen;
  const toggleProject =
    tree.onToggleProject ??
    ((key: string, open: boolean) => setLocalOpen((current) => new Map(current).set(key, open)));
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!revealRequest || revealRequest.sessionId !== handlers.selectedSessionId) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-session-id]") ?? [])].find(
      (element) =>
        element.dataset.sessionId === revealRequest.sessionId &&
        element.closest<HTMLElement>("[data-environment-id]")?.dataset.environmentId ===
          (revealRequest.environmentId ?? selectedEnvironmentId),
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [revealRequest, handlers.selectedSessionId, selectedEnvironmentId]);
  const drag = useProjectDrag({ listRef, onReorder: (from, to) => tree.onReorderProjects?.(from, to) });
  const searching = query.trim().length > 0;
  const projects = rows
    .map((row, index) => ({ ...row, index, visible: filterSessionsForQuery([...row.sessions], query) }))
    .filter((row) => !searching || row.visible.length > 0);
  const switchTargets = rows
    .filter((row) => !row.current)
    .map((row) => ({
      root: row.path,
      name: row.name,
      environmentId: row.environmentId,
      key: row.key,
      host: row.environmentId === PRIMARY_ENVIRONMENT_ID ? undefined : row.environment.label,
    }));
  const isOpen = (row: ProjectSpaceRow) => expandedProjects.get(row.key) ?? row.current;
  const anyOpen = rows.some(isOpen);
  const foldAll = () => {
    for (const row of rows) if (isOpen(row)) toggleProject(row.key, false);
  };
  const openCurrent = () => {
    for (const row of rows) if (row.current) toggleProject(row.key, true);
  };
  return (
    <nav
      aria-label={t("navHistory", "Project spaces")}
      style={{ flex: "1 1 auto", overflowY: "auto", minHeight: 80, display: "flex", flexDirection: "column", gap: 4 }}
    >
      <SectionHeader
        actions={
          <>
            <HeaderButton
              label={
                anyOpen
                  ? t("collapseAllProjects", "Collapse all projects")
                  : t("expandCurrentProject", "Expand current project")
              }
              disabled={searching}
              onClick={anyOpen ? foldAll : openCurrent}
            >
              <ChevronsGlyph inward={anyOpen} />
            </HeaderButton>
            {tree.renderSwitcher?.(switchTargets)}
          </>
        }
      />
      <SessionListStatus
        loading={loading}
        error={error}
        empty={searching && projects.length === 0}
        hasActiveFilter={searching}
      />
      <div
        ref={listRef}
        role="list"
        aria-label={t("navHistory", "Project spaces")}
        style={{ display: "flex", flexDirection: "column", gap: 2 }}
      >
        {projects.map((project) => {
          const open = searching || isOpen(project);
          const remote = project.environmentId !== PRIMARY_ENVIRONMENT_ID;
          return (
            <div
              key={project.key}
              data-environment-id={project.environmentId}
              role={project.current ? "group" : undefined}
              aria-label={project.current ? t("workspaceControls", "Workspace controls") : undefined}
              style={{ display: "flex", flexDirection: "column" }}
            >
              <ProjectRow
                name={project.name}
                path={project.path}
                spaceKey={project.key}
                count={project.visible.length}
                countLabel={t("sessionCount", "{count} sessions").replace("{count}", String(project.visible.length))}
                open={open}
                current={project.current}
                missing={project.missing}
                missingLabel={t("missingFolder", "Folder not found")}
                remote={remote ? { label: project.environment.label, connection: project.connection } : undefined}
                face={projectRowFace({
                  open,
                  missing: project.missing,
                  totalSessions: project.visible.length,
                  activity: project.activity,
                })}
                dragging={drag.draggingIndex === project.index}
                onDragStart={
                  tree.onReorderProjects && !searching && !project.pinned && project.index > 0
                    ? (event) => drag.start(project.index, event)
                    : undefined
                }
                consumeDragClick={drag.consumeClick}
                onToggle={() => {
                  if (!searching) toggleProject(project.key, !isOpen(project));
                }}
                actions={
                  tree.renderProjectActions
                    ? (revealed) => tree.renderProjectActions?.(project.name, revealed, project)
                    : undefined
                }
              >
                {open &&
                  (project.visible.length > 0 ? (
                    <ProjectSessionList
                      {...handlers}
                      sessions={project.visible}
                      searching={searching}
                      activity={project.sessionActivity}
                      homeDir={project.homeDir || handlers.homeDir}
                      selectedSessionId={
                        project.environmentId === selectedEnvironmentId ? handlers.selectedSessionId : null
                      }
                      expandedSessionIds={
                        handlers.expandedSessionIds
                          ? new Set(
                              project.sessions
                                .filter(
                                  (session) =>
                                    handlers.expandedSessionIds?.has(
                                      qualifySessionKey(project.environmentId, session.id),
                                    ) ||
                                    (project.environmentId === PRIMARY_ENVIRONMENT_ID &&
                                      handlers.expandedSessionIds?.has(session.id)),
                                )
                                .map((session) => session.id),
                            )
                          : undefined
                      }
                      onToggleExpand={
                        handlers.onToggleExpand
                          ? (id) => handlers.onToggleExpand?.(qualifySessionKey(project.environmentId, id))
                          : undefined
                      }
                      onRenamed={() =>
                        tree.onEnvironmentRefresh
                          ? tree.onEnvironmentRefresh(project.environmentId)
                          : handlers.onRenamed()
                      }
                      onSessionDeleted={(id) =>
                        tree.onEnvironmentSessionDeleted
                          ? tree.onEnvironmentSessionDeleted(project.environmentId, id)
                          : handlers.onSessionDeleted(id)
                      }
                    />
                  ) : (
                    <div style={{ paddingLeft: "var(--space-4)" }}>
                      <SessionListStatus
                        loading={project.loading}
                        error={project.error}
                        empty
                        hasActiveFilter={searching}
                      />
                    </div>
                  ))}
              </ProjectRow>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
