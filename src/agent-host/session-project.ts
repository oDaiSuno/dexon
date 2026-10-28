import { existsSync } from "node:fs";
import type { SessionInfo } from "../shared/types";
import { inferMissingProject, resolveProject, type ProjectInfo } from "../shared/worktree";
import { getSessionProject, rememberSessionProject, type SessionProjectRecord } from "./session-project-store";

export type LocatedProject = SessionProjectRecord;

export interface ProjectLookupEntry {
  located: LocatedProject | null;
  parentSessionId?: string;
}

const pendingProjects = new Map<string, Promise<ProjectInfo>>();

function resolveProjectOnce(cwd: string): Promise<ProjectInfo> {
  const pending = pendingProjects.get(cwd);
  if (pending) return pending;
  const started = resolveProject(cwd).finally(() => pendingProjects.delete(cwd));
  pendingProjects.set(cwd, started);
  return started;
}

function toLocated(project: ProjectInfo): LocatedProject {
  return {
    projectRoot: project.projectRoot,
    ...(project.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
  };
}

export async function locateSessionProject(info: Pick<SessionInfo, "id" | "cwd">): Promise<LocatedProject | null> {
  if (!info.cwd) return null;
  if (existsSync(info.cwd)) {
    const project = await resolveProjectOnce(info.cwd);
    if (existsSync(info.cwd)) {
      const located = toLocated(project);
      rememberSessionProject(info.id, located);
      return located;
    }
  }
  const remembered = getSessionProject(info.id);
  if (remembered) return remembered;
  const inferred = await inferMissingProject(info.cwd);
  return inferred ? toLocated(inferred) : null;
}

export function inheritProject(
  sessionId: string,
  lookup: (id: string) => ProjectLookupEntry | undefined,
): LocatedProject | null {
  const visited = new Set<string>([sessionId]);
  let id = lookup(sessionId)?.parentSessionId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const ancestor = lookup(id);
    if (!ancestor) return null;
    if (ancestor.located) return { projectRoot: ancestor.located.projectRoot };
    id = ancestor.parentSessionId;
  }
  return null;
}
