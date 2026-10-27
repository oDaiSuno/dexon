import { useMemo, useRef, useState, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery, groupSessionsByProject, sessionProjectKey } from "@/lib/session-list";
import { ProjectSessionList, SessionListStatus, type SessionListHandlers } from "../session-sidebar/session-groups";
import { ProjectRow } from "./project-row";
import { useProjectDrag } from "./use-project-drag";
import type { SwitcherProject } from "./project-switcher-card";

export interface ListedProject {
  root: string;
  missing: boolean;
}

export interface ProjectTreeOptions {
  currentProject: string;
  projectName: (root: string) => string;
  isPinnedProject?: (root: string) => boolean;
  listedProjects?: readonly ListedProject[];
  expandedProjects?: ReadonlyMap<string, boolean>;
  onToggleProject?: (key: string, open: boolean) => void;
  onChooseFolder: () => void;
  onReorderProjects?: (from: number, to: number) => void;
  renderProjectActions?: (
    name: string,
    revealed: boolean,
    project: ListedProject,
    switchTargets: readonly SwitcherProject[],
  ) => ReactNode;
}

function PlusGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function SectionHeader({ onAdd }: { onAdd: () => void }) {
  const { t } = useI18n();
  const label = t("addProjectSpace", "Add project space from folder…");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 28,
        padding: "0 10px",
        flexShrink: 0,
      }}
    >
      <span className="type-label-medium" style={{ color: "var(--fx-text-tertiary)" }}>
        {t("navHistory", "Project spaces")}
      </span>
      <button
        type="button"
        onClick={onAdd}
        title={label}
        aria-label={label}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--fx-surface-hover)";
          event.currentTarget.style.color = "var(--fx-text-primary)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
          event.currentTarget.style.color = "var(--fx-text-tertiary)";
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          marginRight: -4,
          padding: 0,
          border: "none",
          borderRadius: "var(--radius-chip)",
          background: "transparent",
          color: "var(--fx-text-tertiary)",
          cursor: "pointer",
          transition:
            "background var(--duration-quick) var(--ease-smooth-out), color var(--duration-quick) var(--ease-smooth-out)",
        }}
      >
        <PlusGlyph />
      </button>
    </div>
  );
}

export function NavHistory({
  sessions,
  query,
  loading,
  error,
  tree,
  ...handlers
}: {
  sessions: SessionInfo[];
  query: string;
  loading: boolean;
  error: string | null;
  tree: ProjectTreeOptions;
} & SessionListHandlers) {
  const { t } = useI18n();
  const [localOpen, setLocalOpen] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const expandedProjects = tree.expandedProjects ?? localOpen;
  const toggleProject =
    tree.onToggleProject ??
    ((key: string, open: boolean) => setLocalOpen((current) => new Map(current).set(key, open)));
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useProjectDrag({
    listRef,
    onReorder: (from, to) => tree.onReorderProjects?.(from, to),
  });

  const searching = query.trim().length > 0;
  const currentKey = tree.currentProject ? sessionProjectKey(tree.currentProject) : "";
  const base = useMemo(() => {
    const listed = tree.listedProjects;
    if (!listed) {
      return groupSessionsByProject(sessions, tree.currentProject, tree.isPinnedProject).map((project) => ({
        root: project.root,
        key: sessionProjectKey(project.root),
        missing: false,
        sessions: project.sessions,
      }));
    }
    const byProject = new Map<string, SessionInfo[]>();
    for (const session of sessions) {
      const root = session.projectRoot ?? session.cwd;
      if (!root) continue;
      const key = sessionProjectKey(root);
      const members = byProject.get(key);
      if (members) members.push(session);
      else byProject.set(key, [session]);
    }
    return listed.map((project) => {
      const key = sessionProjectKey(project.root);
      return { root: project.root, key, missing: project.missing, sessions: byProject.get(key) ?? [] };
    });
  }, [sessions, tree.listedProjects, tree.currentProject, tree.isPinnedProject]);

  const projects = base
    .map((project) => ({ ...project, visible: filterSessionsForQuery(project.sessions, query) }))
    .filter((project) => !searching || project.visible.length > 0);
  const switchTargets = base
    .filter((project) => project.key !== currentKey)
    .map((project) => ({ root: project.root, name: tree.projectName(project.root) }));
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
      <SectionHeader onAdd={tree.onChooseFolder} />
      <SessionListStatus loading={loading} error={error} empty={nothingMatches} hasActiveFilter={searching} />
      <div
        ref={listRef}
        role="list"
        aria-label={t("navHistory", "Project spaces")}
        style={{ display: "flex", flexDirection: "column", gap: 2 }}
      >
        {projects.map((project, index) => {
          const current = project.key === currentKey;
          const open = searching || (expandedProjects.get(project.key) ?? current);
          const name = tree.projectName(project.root);
          const count = project.visible.length;
          const row = (
            <ProjectRow
              name={name}
              path={project.root}
              count={count}
              countLabel={t("sessionCount", "{count} sessions").replace("{count}", String(count))}
              open={open}
              current={current}
              missing={project.missing}
              missingLabel={missingLabel}
              dragging={drag.draggingIndex === index}
              onDragStart={
                tree.onReorderProjects && !searching && index > 0 ? (event) => drag.start(index, event) : undefined
              }
              consumeDragClick={drag.consumeClick}
              onToggle={() => toggleProject(project.key, !open)}
              actions={
                tree.renderProjectActions
                  ? (revealed) => tree.renderProjectActions?.(name, revealed, project, switchTargets)
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
