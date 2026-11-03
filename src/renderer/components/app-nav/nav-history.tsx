import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery, projectSessionGroups, sessionProjectKey, type ProjectKey } from "@/lib/session-list";
import { ProjectSessionList, SessionListStatus, type SessionListHandlers } from "../session-sidebar/session-groups";
import { IDLE_PROJECT_ACTIVITY, type ProjectActivity } from "@/lib/sidebar-activity";
import { projectRowFace } from "./project-row-status";
import { ProjectRow } from "./project-row";
import { useProjectDrag } from "./use-project-drag";
import { ChevronsGlyph, HeaderButton } from "./section-header-buttons";
import type { SwitcherProject } from "./project-switcher-card";
import type { WorkspaceFacts } from "@/lib/remote-workspace";

export interface RevealRequest {
  readonly seq: number;
  readonly sessionId: string;
}

export interface ListedProject {
  root: string;
  missing: boolean;
}

export interface ProjectTreeOptions {
  currentProject: string;
  projectActivity?: (key: ProjectKey) => ProjectActivity;
  projectName: (root: string) => string;
  workspaceFacts?: (root: string) => WorkspaceFacts;
  isPinnedProject?: (root: string) => boolean;
  listedProjects?: readonly ListedProject[];
  expandedProjects?: ReadonlyMap<string, boolean>;
  onToggleProject?: (key: string, open: boolean) => void;
  renderSwitcher?: (switchTargets: readonly SwitcherProject[]) => ReactNode;
  onReorderProjects?: (from: number, to: number) => void;
  renderProjectActions?: (name: string, revealed: boolean, project: ListedProject) => ReactNode;
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
  sessions,
  query,
  loading,
  error,
  tree,
  revealRequest,
  ...handlers
}: {
  sessions: SessionInfo[];
  query: string;
  loading: boolean;
  error: string | null;
  tree: ProjectTreeOptions;
  revealRequest?: RevealRequest | null;
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
      (element) => element.dataset.sessionId === revealRequest.sessionId,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [revealRequest, handlers.selectedSessionId]);
  const drag = useProjectDrag({
    listRef,
    onReorder: (from, to) => tree.onReorderProjects?.(from, to),
  });

  const searching = query.trim().length > 0;
  const currentKey = tree.currentProject ? sessionProjectKey(tree.currentProject) : "";
  const base = useMemo(
    () =>
      projectSessionGroups(sessions, {
        listedProjects: tree.listedProjects,
        currentProject: tree.currentProject,
        isPinnedProject: tree.isPinnedProject,
      }),
    [sessions, tree.listedProjects, tree.currentProject, tree.isPinnedProject],
  );

  const projects = base
    .map((project) => ({ ...project, visible: filterSessionsForQuery([...project.sessions], query) }))
    .filter((project) => !searching || project.visible.length > 0);
  const switchTargets = base
    .filter((project) => project.key !== currentKey)
    .map((project) => ({ root: project.root, name: tree.projectName(project.root) }));
  const isOpen = (key: string) => expandedProjects.get(key) ?? key === currentKey;
  const anyOpen = base.some((project) => isOpen(project.key));
  const foldAll = () => {
    for (const project of base) if (isOpen(project.key)) toggleProject(project.key, false);
  };
  const openCurrent = () => {
    if (currentKey) toggleProject(currentKey, true);
  };
  const nothingMatches = searching && projects.length === 0;
  const missingLabel = t("missingFolder", "Folder not found");

  return (
    <nav
      aria-label={t("navHistory", "Project spaces")}
      style={{
        flex: "1 1 auto",
        overflowY: "auto",
        minHeight: 80,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
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
      <SessionListStatus loading={loading} error={error} empty={nothingMatches} hasActiveFilter={searching} />
      <div
        ref={listRef}
        role="list"
        aria-label={t("navHistory", "Project spaces")}
        style={{ display: "flex", flexDirection: "column", gap: 2 }}
      >
        {projects.map((project, index) => {
          const current = project.key === currentKey;
          const open = searching || isOpen(project.key);
          const name = tree.projectName(project.root);
          const workspace = tree.workspaceFacts?.(project.root);
          const accessibleName =
            workspace?.kind === "ssh"
              ? t("sshWorkspaceName", "{folder} @{host}")
                  .replace("{folder}", workspace.folderName)
                  .replace("{host}", workspace.hostLabel)
              : name;
          const missing = workspace?.kind !== "ssh" && project.missing;
          const count = project.visible.length;
          const row = (
            <ProjectRow
              name={name}
              accessibleName={accessibleName}
              workspace={workspace}
              path={project.root}
              count={count}
              countLabel={t("sessionCount", "{count} sessions").replace("{count}", String(count))}
              open={open}
              current={current}
              missing={missing}
              missingLabel={missingLabel}
              face={projectRowFace({
                open,
                missing,
                totalSessions: count,
                activity: tree.projectActivity?.(project.key) ?? IDLE_PROJECT_ACTIVITY,
              })}
              dragging={drag.draggingIndex === index}
              onDragStart={
                tree.onReorderProjects && !searching && index > 0 ? (event) => drag.start(index, event) : undefined
              }
              consumeDragClick={drag.consumeClick}
              onToggle={() => {
                if (!searching) toggleProject(project.key, !isOpen(project.key));
              }}
              actions={
                tree.renderProjectActions
                  ? (revealed) => tree.renderProjectActions?.(accessibleName, revealed, project)
                  : undefined
              }
            >
              {open &&
                (project.visible.length > 0 ? (
                  <ProjectSessionList sessions={project.visible} {...handlers} />
                ) : (
                  !loading &&
                  !error && (
                    <div style={{ paddingLeft: "var(--space-4)" }}>
                      <SessionListStatus loading={false} error={null} empty hasActiveFilter={false} />
                    </div>
                  )
                ))}
            </ProjectRow>
          );
          return (
            <div
              key={project.key}
              role={current ? "group" : undefined}
              aria-label={current ? t("workspaceControls", "Workspace controls") : undefined}
              style={{ display: "flex", flexDirection: "column" }}
            >
              {row}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
