import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { sessionProjectKey } from "@/lib/session-list";
import { canMoveProjectSpace, withDefaultSpace } from "@/lib/project-spaces";
import { projectKeyOf } from "@shared/project-space-state";
import { workspaceStore } from "@/lib/workspace-store";
export interface OpenProjects {
  projects: string[];
  missing: ReadonlySet<string>;
  isMissing: (folder: string | null | undefined) => boolean;
  canMove: (folder: string, offset: -1 | 1) => boolean;
  add: (folder: string) => void;
  close: (folder: string) => void;
  move: (folder: string, offset: -1 | 1) => void;
  reorder: (from: number, to: number) => void;
}
const refOf = (path: string) => ({ environmentId: PRIMARY_ENVIRONMENT_ID, path });
export function useOpenProjects({
  defaultSpace,
  currentProject,
  refreshKey,
  onCloseCurrent,
}: {
  defaultSpace: string | null;
  currentProject: string | null;
  refreshKey: number;
  onCloseCurrent: () => void;
}): OpenProjects {
  const snapshot = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  const closingRef = useRef<string | null>(null);
  useEffect(() => {
    if (window.piBridge) void workspaceStore.initialize(window.piBridge);
  }, []);
  const pinned = useMemo(() => (defaultSpace ? refOf(defaultSpace) : null), [defaultSpace]);
  const spaces = useMemo(
    () =>
      withDefaultSpace(
        snapshot.spaces.filter((space) => space.environmentId === PRIMARY_ENVIRONMENT_ID),
        pinned,
      ),
    [snapshot.spaces, pinned],
  );
  const projects = useMemo(() => spaces.map((space) => space.path), [spaces]);
  useLayoutEffect(() => {
    if (!snapshot.loaded || !currentProject || snapshot.focus.environmentId !== PRIMARY_ENVIRONMENT_ID) return;
    const key = sessionProjectKey(currentProject);
    if (closingRef.current !== key) closingRef.current = null;
    if (closingRef.current === key) return;
    workspaceStore.noteCurrentProject(refOf(currentProject), pinned);
  }, [snapshot.loaded, snapshot.focus.environmentId, currentProject, pinned]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      projects
        .filter((folder) => folder !== defaultSpace)
        .map(async (folder) => {
          try {
            return (await getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID).validateCwd(folder)).ok
              ? null
              : sessionProjectKey(folder);
          } catch {
            return sessionProjectKey(folder);
          }
        }),
    ).then((checked) => {
      if (!cancelled) setMissing(new Set(checked.filter((key): key is string => key !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [projects, defaultSpace, refreshKey]);
  const isMissing = useCallback(
    (folder: string | null | undefined) => !!folder && missing.has(sessionProjectKey(folder)),
    [missing],
  );
  const canMove = useCallback(
    (folder: string, offset: -1 | 1) => canMoveProjectSpace(spaces, projectKeyOf(refOf(folder)), offset, pinned),
    [spaces, pinned],
  );
  const add = useCallback((folder: string) => workspaceStore.noteCurrentProject(refOf(folder), pinned), [pinned]);
  const close = useCallback(
    (folder: string) => {
      if (defaultSpace && sessionProjectKey(folder) === sessionProjectKey(defaultSpace)) return;
      const current = currentProject !== null && sessionProjectKey(folder) === sessionProjectKey(currentProject);
      if (current) closingRef.current = sessionProjectKey(folder);
      workspaceStore.unmount(projectKeyOf(refOf(folder)));
      if (current) onCloseCurrent();
    },
    [defaultSpace, currentProject, onCloseCurrent],
  );
  const move = useCallback(
    (folder: string, offset: -1 | 1) => workspaceStore.move(projectKeyOf(refOf(folder)), offset, pinned),
    [pinned],
  );
  const reorder = useCallback(
    (from: number, to: number) => {
      const space = spaces[from];
      if (!space) return;
      const actualFrom = snapshot.spaces.findIndex((item) => item.key === space.key);
      const actualTo =
        to >= spaces.length
          ? snapshot.spaces.length
          : snapshot.spaces.findIndex((item) => item.key === spaces[to]?.key);
      workspaceStore.reorder(actualFrom, Math.max(0, actualTo), pinned);
    },
    [spaces, snapshot.spaces, pinned],
  );
  return { projects, missing, isMissing, canMove, add, close, move, reorder };
}
