import { normalizeWorktreePathForComparison } from "../../shared/worktree-path.ts";
import type { SessionInfo } from "./types";

export type ProjectKey = string & { readonly __brand?: "ProjectKey" };

export interface SessionProject {
  root: string;
  sessions: SessionInfo[];
}

export interface ListedProject {
  root: string;
  missing: boolean;
}

export interface ProjectSessions {
  readonly key: ProjectKey;
  readonly root: string;
  readonly missing: boolean;
  readonly sessions: readonly SessionInfo[];
}

export interface ProjectListing {
  readonly currentProject: string;
  readonly listedProjects?: readonly ListedProject[];
  readonly isPinnedProject?: (root: string) => boolean;
}

export type SessionDateGroup = "today" | "recent" | "older";

export type InitialSessionRestoreDecision =
  { status: "wait" | "none" | "not-found" } | { status: "restore"; session: SessionInfo };

export function resolveInitialSessionRestore(
  sessions: SessionInfo[],
  initialSessionId: string | null | undefined,
  loading: boolean,
  hasLoadError: boolean,
  alreadyRestored: boolean,
): InitialSessionRestoreDecision {
  if (loading || hasLoadError) return { status: "wait" };
  if (!initialSessionId || alreadyRestored) return { status: "none" };
  const session = sessions.find((item) => item.id === initialSessionId);
  return session ? { status: "restore", session } : { status: "not-found" };
}

export function getSessionDisplayTitle(session: SessionInfo, maxLength = 72): string {
  const source = session.name?.trim() || session.firstMessage?.trim() || session.id;
  const normalized = source.replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function sessionDateGroup(modified: string, now = new Date()): SessionDateGroup {
  const date = new Date(modified);
  if (Number.isNaN(date.getTime())) return "older";

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const recentStart = new Date(todayStart);
  recentStart.setDate(recentStart.getDate() - 6);

  if (date >= todayStart) return "today";
  if (date >= recentStart) return "recent";
  return "older";
}

export function getRecentProjects(sessions: SessionInfo[]): string[] {
  const latestByRoot = new Map<string, string>();
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) {
      latestByRoot.set(root, s.modified);
    }
  }
  return [...latestByRoot.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([root]) => root);
}

export function sessionProjectKey(root: string): ProjectKey {
  return normalizeWorktreePathForComparison(root);
}

export function sessionProjectKeyOf(session: SessionInfo): ProjectKey | null {
  const root = session.projectRoot ?? session.cwd;
  return root ? sessionProjectKey(root) : null;
}

export function projectSessionGroups(sessions: readonly SessionInfo[], listing: ProjectListing): ProjectSessions[] {
  if (!listing.listedProjects) {
    return groupSessionsByProject(sessions, listing.currentProject, listing.isPinnedProject).map((project) => ({
      ...project,
      key: sessionProjectKey(project.root),
      missing: false,
    }));
  }
  const byProject = new Map<ProjectKey, SessionInfo[]>();
  for (const session of sessions) {
    const key = sessionProjectKeyOf(session);
    if (!key) continue;
    const members = byProject.get(key);
    if (members) members.push(session);
    else byProject.set(key, [session]);
  }
  return listing.listedProjects.map((project) => {
    const key = sessionProjectKey(project.root);
    return { ...project, key, sessions: byProject.get(key) ?? [] };
  });
}

export function groupSessionsByProject(
  sessions: readonly SessionInfo[],
  currentRoot: string,
  pinned: (root: string) => boolean = () => false,
): SessionProject[] {
  const groups = new Map<string, SessionProject & { latest: string }>();
  for (const session of sessions) {
    const root = session.projectRoot ?? session.cwd;
    if (!root) continue;
    const key = sessionProjectKey(root);
    const group = groups.get(key);
    if (!group) groups.set(key, { root, sessions: [session], latest: session.modified });
    else {
      group.sessions.push(session);
      if (session.modified > group.latest) group.latest = session.modified;
    }
  }
  const currentKey = sessionProjectKey(currentRoot);
  if (currentRoot && !groups.has(currentKey))
    groups.set(currentKey, { root: currentRoot, sessions: [], latest: "\uffff" });
  return [...groups.values()]
    .sort(
      (left, right) =>
        Number(pinned(right.root)) - Number(pinned(left.root)) || right.latest.localeCompare(left.latest),
    )
    .map(({ root, sessions: members }) => ({ root, sessions: members }));
}

export function filterSessionsForQuery(sessions: SessionInfo[], rawQuery: string): SessionInfo[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return sessions;

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const visibleIds = new Set<string>();

  for (const session of sessions) {
    const searchText = [session.name, session.firstMessage, session.id, session.cwd, session.worktreeBranch]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase();
    if (!searchText.includes(query)) continue;

    visibleIds.add(session.id);
    let parentId = session.parentSessionId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      visibleIds.add(parent.id);
      parentId = parent.parentSessionId;
    }
  }

  return sessions.filter((session) => visibleIds.has(session.id));
}
