import { useMemo } from "react";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentView } from "@contract/environment";
import { projectKeyOf } from "@shared/project-space-state";
import { mountSpace } from "@/lib/project-spaces";
import { projectSessionGroups, type ListedProject } from "@/lib/session-list";
import { sessionActivityFromLegacySignals } from "@/lib/session-activity-state";
import type { SessionActivity } from "@/lib/session-tree-status";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import type { SessionInfo } from "@/lib/types";
import { buildProjectSpaceActivity, buildProjectSpaceRows, type ProjectSpaceRow } from "./project-space-rows";

const localEnvironment: EnvironmentView = {
  id: PRIMARY_ENVIRONMENT_ID,
  label: "Primary",
  enabled: true,
  target: { kind: "primary" },
  status: { phase: "available" },
  descriptor: null,
};

export function useNavigationProjects(input: {
  projectRows?: readonly ProjectSpaceRow[];
  sessions: SessionInfo[];
  listedProjects?: readonly ListedProject[];
  currentProject: string;
  isPinnedProject?: (path: string) => boolean;
  projectName: (path: string) => string;
  loading: boolean;
  error: string | null;
  activity?: SessionActivity;
  liveStatuses?: Record<string, SessionLiveStatus>;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
}) {
  const {
    projectRows,
    sessions,
    listedProjects,
    currentProject,
    isPinnedProject,
    projectName,
    loading,
    error,
    activity,
    liveStatuses,
    runningSessionIds,
    unreadSessionIds,
  } = input;
  const resolvedActivity = useMemo(
    () =>
      activity ??
      sessionActivityFromLegacySignals({ liveStatuses: liveStatuses ?? {}, runningSessionIds, unreadSessionIds }),
    [activity, liveStatuses, runningSessionIds, unreadSessionIds],
  );
  const rows = useMemo(() => {
    if (projectRows) return projectRows;
    const groups = projectSessionGroups(sessions, { listedProjects, currentProject, isPinnedProject });
    const spaces = groups.map((group) => mountSpace({ environmentId: PRIMARY_ENVIRONMENT_ID, path: group.root }));
    return buildProjectSpaceRows({
      spaces,
      directories: [{ environment: localEnvironment, sessions, activity: resolvedActivity, loading, error }],
      focus: {
        environmentId: PRIMARY_ENVIRONMENT_ID,
        spaceKey: currentProject ? projectKeyOf({ environmentId: PRIMARY_ENVIRONMENT_ID, path: currentProject }) : null,
        sessionId: null,
      },
      missing: new Set(
        groups
          .filter((group) => group.missing)
          .map((group) => projectKeyOf({ environmentId: PRIMARY_ENVIRONMENT_ID, path: group.root })),
      ),
      pinned: spaces.find((space) => isPinnedProject?.(space.path))?.key,
      projectName: (space) => projectName(space.path),
      now: 0,
    });
  }, [
    projectRows,
    sessions,
    listedProjects,
    currentProject,
    isPinnedProject,
    projectName,
    loading,
    error,
    resolvedActivity,
  ]);
  const sidebar = useMemo(() => buildProjectSpaceActivity(rows), [rows]);
  return { rows, sidebar, resolvedActivity };
}
