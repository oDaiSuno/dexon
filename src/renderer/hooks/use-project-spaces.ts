import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PRIMARY_ENVIRONMENT_ID,
  parseQualifiedProjectKey,
  qualifySessionKey,
  type EnvironmentId,
} from "@contract/environment";
import type { ProjectSpaces } from "@/components/app-shell/use-project-spaces";
import { canMoveProjectSpace, leadingPinnedCount, withPinnedSpaces } from "@/lib/project-spaces";
import { automationSpaceFolder } from "@/lib/space-identity";
import { projectKeyOf, type ProjectKey, type ProjectSpaceRef } from "@shared/project-space-state";
import { normalizeWorktreePathForComparison } from "@shared/worktree-path";
import type { ProjectSpaceDirectory } from "@/components/app-nav/project-space-rows";
import type { RevealRequest } from "@/components/app-nav/nav-history";
import type { SessionInfo } from "@/lib/types";
import { sessionAncestorIds } from "@/lib/session-tree";

const refOf = (path: string, environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID): ProjectSpaceRef => ({
  environmentId,
  path,
});
const wrappedProjects = new WeakMap<ProjectSpaces, { automationCwd: string | null; personalCwd: string | null }>();

export function isAutomationManagedChild(
  path: string,
  automationCwd: string | null,
  environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID,
): boolean {
  if (!automationCwd || environmentId !== PRIMARY_ENVIRONMENT_ID) return false;
  const platform = /^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/u.test(automationCwd) ? "win32" : "";
  const root = normalizeWorktreePathForComparison(automationCwd, platform).replace(/\/+$/, "");
  const candidate = normalizeWorktreePathForComparison(path, platform);
  return candidate !== root && candidate.startsWith(`${root}/`);
}

export function automationProjectPath(
  path: string,
  automationCwd: string | null,
  environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID,
): string {
  return automationCwd &&
    environmentId === PRIMARY_ENVIRONMENT_ID &&
    (projectKeyOf(refOf(path)) === projectKeyOf(refOf(automationCwd)) ||
      isAutomationManagedChild(path, automationCwd, environmentId))
    ? automationCwd
    : path;
}

export function automationProjectKey(key: ProjectKey | null, automationCwd: string | null): ProjectKey | null {
  const ref = key ? parseQualifiedProjectKey(key) : null;
  return ref ? projectKeyOf({ ...ref, path: automationProjectPath(ref.path, automationCwd, ref.environmentId) }) : key;
}

export function useProjectSpaceExpansion({
  currentKey,
  automationCwd,
  directories,
}: {
  currentKey: ProjectKey | null;
  automationCwd: string | null;
  directories: readonly Pick<ProjectSpaceDirectory, "environment" | "sessions">[];
}) {
  const [expandedSessionIds, setExpandedSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null);
  useEffect(() => {
    if (currentKey)
      setExpandedProjects((current) =>
        current.get(currentKey) === false ? new Map(current).set(currentKey, true) : current,
      );
  }, [currentKey]);
  const toggleExpand = useCallback(
    (sessionId: string) =>
      setExpandedSessionIds((current) => {
        const next = new Set(current);
        if (!next.delete(sessionId)) next.add(sessionId);
        return next;
      }),
    [],
  );
  const toggleProject = useCallback(
    (key: string, nextOpen: boolean) => setExpandedProjects((current) => new Map(current).set(key, nextOpen)),
    [],
  );
  const revealSession = useCallback(
    (session: SessionInfo, introducedAncestorIds?: readonly string[]) => {
      const environmentId = session.environmentId;
      const cwd = automationProjectPath(session.cwd, automationCwd, environmentId);
      const root =
        cwd === automationCwd ? cwd : automationProjectPath(session.projectRoot ?? cwd, automationCwd, environmentId);
      if (root && introducedAncestorIds === undefined)
        setExpandedProjects((current) => new Map(current).set(projectKeyOf({ environmentId, path: root }), true));
      const members = directories.find((item) => item.environment.id === environmentId)?.sessions ?? [];
      const ancestors = (introducedAncestorIds ?? sessionAncestorIds(members, session.id)).map((id) =>
        qualifySessionKey(environmentId, id),
      );
      setExpandedSessionIds((current) => {
        if (ancestors.every((id) => current.has(id))) return current;
        const next = new Set(current);
        for (const id of ancestors) next.add(id);
        return next;
      });
      setRevealRequest((previous) => ({ seq: (previous?.seq ?? 0) + 1, sessionId: session.id, environmentId }));
    },
    [directories, automationCwd],
  );
  return { expandedSessionIds, expandedProjects, revealRequest, toggleExpand, toggleProject, revealSession };
}

export function useAutomationProjectSpaces({
  projects,
  automationCwd,
  personalCwd,
}: {
  projects: ProjectSpaces;
  automationCwd: string | null;
  personalCwd: string | null;
}): ProjectSpaces {
  const { spaces: raw, pinned: defaultKey, missing, isMissing: rawIsMissing } = projects;
  const { add: rawAdd, close: rawClose, reorder: rawReorder } = projects;
  const defaultSpace = useMemo(() => raw.find((space) => space.key === defaultKey), [raw, defaultKey]);
  const automationFolder = automationSpaceFolder(automationCwd, personalCwd ?? defaultSpace?.path ?? null);
  const automationKey = automationFolder ? projectKeyOf(refOf(automationFolder)) : null;
  const pins = useMemo<ProjectSpaceRef[]>(() => {
    const automation =
      raw.find((space) => space.key === automationKey) ?? (automationFolder ? refOf(automationFolder) : null);
    return [defaultSpace, automation].filter((ref): ref is ProjectSpaceRef => !!ref);
  }, [raw, defaultSpace, automationKey, automationFolder]);
  const pinnedKeys = useMemo<ReadonlySet<string>>(() => new Set(pins.map(projectKeyOf)), [pins]);
  const spaces = useMemo(() => {
    const visible = raw.filter((space) => !isAutomationManagedChild(space.path, automationFolder, space.environmentId));
    return withPinnedSpaces(visible, pins);
  }, [raw, pins, automationFolder]);
  const visibleMissing = useMemo(
    () => new Set([...missing].filter((key) => !pinnedKeys.has(key))),
    [missing, pinnedKeys],
  );
  const isPinned = useCallback(
    (folder: string, environmentId: EnvironmentId) => pinnedKeys.has(projectKeyOf(refOf(folder, environmentId))),
    [pinnedKeys],
  );
  const isMissing = useCallback(
    (folder: string | null | undefined, environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID) =>
      !(folder && isPinned(folder, environmentId)) && rawIsMissing(folder, environmentId),
    [isPinned, rawIsMissing],
  );
  const canMove = useCallback(
    (folder: string, offset: -1 | 1, environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID) =>
      canMoveProjectSpace(spaces, projectKeyOf(refOf(folder, environmentId)), offset, pins),
    [spaces, pins],
  );
  const add = useCallback(
    (folder: string, environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID) => {
      const path = automationProjectPath(folder, automationFolder, environmentId);
      if (!isPinned(path, environmentId)) rawAdd(path, environmentId);
    },
    [isPinned, rawAdd, automationFolder],
  );
  const close = useCallback(
    (folder: string, environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID) => {
      if (!isPinned(folder, environmentId)) rawClose(folder, environmentId);
    },
    [isPinned, rawClose],
  );
  const reorder = useCallback(
    (from: number, to: number) => {
      const moved = spaces[from];
      if (!moved || pinnedKeys.has(moved.key) || !Number.isInteger(to)) return;
      const before = spaces[Math.max(to, leadingPinnedCount(spaces, pins))];
      const sourceFrom = raw.findIndex((space) => space.key === moved.key);
      const sourceTo = before ? raw.findIndex((space) => space.key === before.key) : raw.length;
      if (sourceFrom >= 0 && sourceTo >= 0) rawReorder(sourceFrom, sourceTo);
    },
    [spaces, pins, pinnedKeys, raw, rawReorder],
  );
  const move = useCallback(
    (folder: string, offset: -1 | 1, environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID) => {
      const key = projectKeyOf(refOf(folder, environmentId));
      const index = spaces.findIndex((space) => space.key === key);
      if (canMoveProjectSpace(spaces, key, offset, pins)) reorder(index, offset === 1 ? index + 2 : index - 1);
    },
    [spaces, pins, reorder],
  );
  return useMemo(() => {
    const wrapped = wrappedProjects.get(projects);
    if (wrapped && wrapped.automationCwd === automationCwd && wrapped.personalCwd === personalCwd) return projects;
    const result = { ...projects, spaces, missing: visibleMissing, isMissing, canMove, add, close, move, reorder };
    wrappedProjects.set(result, { automationCwd, personalCwd });
    return result;
  }, [projects, spaces, visibleMissing, isMissing, canMove, add, close, move, reorder, automationCwd, personalCwd]);
}
