import { PRIMARY_ENVIRONMENT_ID, qualifySessionKey, type EnvironmentView } from "@contract/environment";
import { projectKeyOf, type ProjectKey } from "@shared/project-space-state";
import type { MountedSpace, WorkspaceFocus } from "@/lib/workspace-store";
import type { SessionInfo } from "@/lib/types";
import { COUNTED_ACTIVITIES, PULSE_ACTIVITIES, type SessionActivity } from "@/lib/session-tree-status";
import { buildSidebarActivity, type ProjectActivity } from "@/lib/sidebar-activity";
import { presentConnection, type ConnectionPresentation } from "@/lib/connection-presentation";
import { spaceFolderName } from "@/lib/space-identity";

export interface ProjectSpaceDirectory {
  readonly environment: EnvironmentView;
  readonly sessions: readonly SessionInfo[];
  readonly activity: SessionActivity;
  readonly loading: boolean;
  readonly error: string | null;
}

export interface ProjectSpaceRow extends MountedSpace {
  readonly root: string;
  readonly name: string;
  readonly environment: EnvironmentView;
  readonly connection: ConnectionPresentation;
  readonly sessions: readonly SessionInfo[];
  readonly sessionActivity: SessionActivity;
  readonly activity: ProjectActivity;
  readonly current: boolean;
  readonly pinned: boolean;
  readonly missing: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly homeDir: string;
}

export function buildProjectSpaceRows({
  spaces,
  directories,
  focus,
  missing = new Set(),
  pinned = null,
  projectName,
  now,
}: {
  spaces: readonly MountedSpace[];
  directories: readonly ProjectSpaceDirectory[];
  focus: WorkspaceFocus;
  missing?: ReadonlySet<string>;
  pinned?: ProjectKey | null;
  projectName?: (space: MountedSpace) => string;
  now: number;
}): ProjectSpaceRow[] {
  const byEnvironment = new Map(directories.map((directory) => [directory.environment.id, directory]));
  const byProject = new Map<ProjectKey, SessionInfo[]>();
  for (const directory of directories) {
    const environmentId = directory.environment.id;
    for (const session of directory.sessions) {
      const path = session.projectRoot ?? session.cwd;
      if (!path) continue;
      const key = projectKeyOf({ environmentId, path });
      const scoped = environmentId === PRIMARY_ENVIRONMENT_ID ? session : { ...session, environmentId };
      const members = byProject.get(key);
      if (members) members.push(scoped);
      else byProject.set(key, [scoped]);
    }
  }
  return spaces.flatMap((space) => {
    const directory = byEnvironment.get(space.environmentId);
    if (!directory) return [];
    const sessions = byProject.get(space.key) ?? [];
    const name = projectName?.(space) ?? spaceFolderName(space.path);
    const missingFolder = missing.has(space.key);
    const group = { key: space.key, root: space.path, sessions, missing: missingFolder };
    const sidebar = buildSidebarActivity([group], directory.activity, () => name);
    return [
      {
        ...space,
        root: space.path,
        name,
        environment: directory.environment,
        connection: presentConnection(directory.environment, now),
        sessions,
        sessionActivity: directory.activity,
        activity: sidebar.project(space.key),
        current: focus.environmentId === space.environmentId && focus.spaceKey === space.key,
        pinned: space.key === pinned,
        missing: missingFolder,
        loading: directory.loading,
        error: directory.error,
        homeDir: directory.environment.descriptor?.platform.home ?? "",
      },
    ];
  });
}

export function buildProjectSpaceActivity(rows: readonly ProjectSpaceRow[]) {
  const counts = { awaiting_input: 0, error: 0, running: 0 };
  const pulseRows = rows.flatMap((row) => {
    const sidebar = buildSidebarActivity(
      [{ key: row.key, root: row.path, missing: row.missing, sessions: row.sessions }],
      row.sessionActivity,
      () => row.name,
    );
    for (const status of COUNTED_ACTIVITIES) counts[status] += sidebar.pulse.sessionCounts[status];
    return sidebar.pulse.rows.map((pulse) => ({ ...pulse, key: qualifySessionKey(row.environmentId, pulse.root.id) }));
  });
  pulseRows.sort(
    (left, right) =>
      PULSE_ACTIVITIES.indexOf(left.status) - PULSE_ACTIVITIES.indexOf(right.status) ||
      right.sortTimestampMs - left.sortTimestampMs,
  );
  return {
    pulse: {
      rows: pulseRows,
      sessionCounts: counts,
      projectNames: [...new Set(pulseRows.map((row) => row.projectName))],
    },
    urgency: COUNTED_ACTIVITIES.find((status) => counts[status] > 0) ?? null,
  };
}
