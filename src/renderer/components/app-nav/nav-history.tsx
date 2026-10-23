import { useState, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { filterSessionsForQuery, groupSessionsByProject, sessionProjectKey } from "@/lib/session-list";
import { ProjectSessionList, SessionListStatus, type SessionListHandlers } from "../session-sidebar/session-groups";
import { ProjectRow } from "./project-row";

export interface ProjectTreeOptions {
  currentProject: string;
  projectName: (root: string) => string;
  isPinnedProject?: (root: string) => boolean;
  openProjects?: ReadonlyMap<string, boolean>;
  onToggleProject?: (key: string, open: boolean) => void;
  onChooseFolder: () => void;
  renderCurrentActions?: (name: string, revealed: boolean) => ReactNode;
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
  const openProjects = tree.openProjects ?? localOpen;
  const toggleProject =
    tree.onToggleProject ??
    ((key: string, open: boolean) => setLocalOpen((current) => new Map(current).set(key, open)));

  const searching = query.trim().length > 0;
  const currentKey = tree.currentProject ? sessionProjectKey(tree.currentProject) : "";
  const projects = groupSessionsByProject(sessions, tree.currentProject, tree.isPinnedProject)
    .map((project) => ({ ...project, key: sessionProjectKey(project.root) }))
    .map((project) => ({ ...project, visible: filterSessionsForQuery(project.sessions, query) }))
    .filter((project) => !searching || project.visible.length > 0);
  const nothingMatches = searching && projects.length === 0;

  return (
    <nav
      aria-label={t("navHistory", "Project spaces")}
      style={{
        flex: "1 1 auto",
        overflowY: "auto",
        minHeight: 80,
        display: "flex",
        flexDirection: "column",
        padding: "0 var(--space-3) var(--space-3)",
      }}
    >
      <SectionHeader onAdd={tree.onChooseFolder} />
      <SessionListStatus loading={loading} error={error} empty={nothingMatches} hasActiveFilter={searching} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {projects.map((project) => {
          const current = project.key === currentKey;
          const open = searching || (openProjects.get(project.key) ?? current);
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
              onToggle={() => toggleProject(project.key, !open)}
              actions={
                current && tree.renderCurrentActions
                  ? (revealed) => tree.renderCurrentActions?.(name, revealed)
                  : undefined
              }
            />
          );
          return (
            <div key={project.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {current ? (
                <div role="group" aria-label={t("workspaceControls", "Workspace controls")}>
                  {row}
                </div>
              ) : (
                row
              )}
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
            </div>
          );
        })}
      </div>
    </nav>
  );
}
