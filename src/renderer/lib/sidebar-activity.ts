import type { SessionInfo } from "./types";
import type { ProjectKey, ProjectSessions } from "./session-list";
import { buildSessionTree } from "./session-tree";
import {
  isCountedActivity,
  descendantActivity,
  indicatedActivity,
  COUNTED_ACTIVITIES,
  type CountedActivity,
  type RunAge,
  type SessionActivity,
  type SessionActivityCounts,
} from "./session-tree-status";

export interface ProjectActivity {
  readonly sessionCounts: Readonly<SessionActivityCounts>;
  readonly taskCounts: Readonly<SessionActivityCounts>;
  readonly unread: number;
  readonly workInFlight: boolean;
}

export const IDLE_PROJECT_ACTIVITY: ProjectActivity = {
  sessionCounts: { awaiting_input: 0, error: 0, running: 0 },
  taskCounts: { awaiting_input: 0, error: 0, running: 0 },
  unread: 0,
  workInFlight: false,
};

export interface PulseRow {
  readonly key: string;
  readonly status: CountedActivity;
  readonly projectKey: ProjectKey;
  readonly projectName: string;
  readonly root: SessionInfo;
  readonly target: SessionInfo;
  readonly subagents: number;
  readonly runAge: RunAge;
  readonly sortTimestampMs: number;
}

export interface PulseModel {
  readonly rows: readonly PulseRow[];
  readonly sessionCounts: Readonly<SessionActivityCounts>;
  readonly projectNames: readonly string[];
}

export interface SidebarActivity {
  project(key: ProjectKey): ProjectActivity;
  readonly pulse: PulseModel;
  readonly urgency: CountedActivity | null;
}

export function buildSidebarActivity(
  projects: readonly ProjectSessions[],
  activity: SessionActivity,
  projectName: (root: string) => string,
): SidebarActivity {
  const byProject = new Map<ProjectKey, ProjectActivity>();
  const rows: PulseRow[] = [];
  const sessionCounts: SessionActivityCounts = { awaiting_input: 0, error: 0, running: 0 };
  for (const project of projects) {
    const counts: SessionActivityCounts = { awaiting_input: 0, error: 0, running: 0 };
    const taskCounts: SessionActivityCounts = { awaiting_input: 0, error: 0, running: 0 };
    let unread = 0;
    for (const node of buildSessionTree(project.sessions)) {
      const own = activity.of(node.session.id);
      const descendants = descendantActivity(node, activity);
      unread += descendants.unread + Number(own === "unread");
      for (const status of COUNTED_ACTIVITIES) {
        const count = descendants.counts[status] + Number(own === status);
        counts[status] += count;
        sessionCounts[status] += count;
      }
      const status = indicatedActivity(own, descendants);
      if (!isCountedActivity(status)) continue;
      taskCounts[status] += 1;
      const target = own === status ? node.session : descendants.focus!.session;
      const runAge = activity.runAge(target.id, target.modified);
      rows.push({
        key: node.session.id,
        status,
        projectKey: project.key,
        projectName: projectName(project.root),
        root: node.session,
        target,
        subagents: COUNTED_ACTIVITIES.reduce((total, counted) => total + descendants.counts[counted], 0),
        runAge,
        sortTimestampMs: runAge.kind === "observed" ? runAge.since : Date.parse(target.modified) || 0,
      });
    }
    byProject.set(project.key, {
      sessionCounts: counts,
      taskCounts,
      unread,
      workInFlight: counts.running > 0 || counts.awaiting_input > 0,
    });
  }
  rows.sort(
    (left, right) =>
      COUNTED_ACTIVITIES.indexOf(left.status) - COUNTED_ACTIVITIES.indexOf(right.status) ||
      right.sortTimestampMs - left.sortTimestampMs,
  );
  return {
    project: (key) => byProject.get(key) ?? IDLE_PROJECT_ACTIVITY,
    pulse: { rows, sessionCounts, projectNames: [...new Set(rows.map((row) => row.projectName))] },
    urgency: COUNTED_ACTIVITIES.find((status) => sessionCounts[status] > 0) ?? null,
  };
}
