import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { canMoveProjectSpace, withDefaultSpace } from "@/lib/project-spaces";
import { projectKeyOf, type ProjectKey, type ProjectSpaceRef } from "@shared/project-space-state";
import { workspaceStore, type MountedSpace } from "@/lib/workspace-store";
import { useEnvironments } from "@/lib/environment-registry";
import { mergeMissing, probePresence } from "@/lib/project-presence";

export interface ProjectSpaces {
  spaces: readonly MountedSpace[];
  projects: string[];
  pinned: ProjectKey | null;
  missing: ReadonlySet<string>;
  isMissing: (folder: string | null | undefined, environmentId?: EnvironmentId) => boolean;
  canMove: (folder: string, offset: -1 | 1, environmentId?: EnvironmentId) => boolean;
  add: (folder: string, environmentId?: EnvironmentId) => void;
  close: (folder: string, environmentId?: EnvironmentId) => void;
  move: (folder: string, offset: -1 | 1, environmentId?: EnvironmentId) => void;
  reorder: (from: number, to: number) => void;
}

const refOf = (path: string, environmentId = PRIMARY_ENVIRONMENT_ID): ProjectSpaceRef => ({ environmentId, path });

export function useProjectSpaces({
  defaultSpace,
  currentProject,
  refreshKey,
  onCloseCurrent,
}: {
  defaultSpace: string | null;
  currentProject: string | null;
  refreshKey: number;
  onCloseCurrent: () => void;
}): ProjectSpaces {
  const snapshot = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const environments = useEnvironments();
  const [missing, setMissing] = useState<ReadonlySet<ProjectKey>>(() => new Set());
  const closingRef = useRef<ProjectKey | null>(null);
  useEffect(() => {
    if (window.piBridge) void workspaceStore.initialize(window.piBridge);
  }, []);
  const pinned = useMemo(() => (defaultSpace ? refOf(defaultSpace) : null), [defaultSpace]);
  const environmentIds = JSON.stringify(environments.map((view) => view.id));
  const spaces = useMemo(() => {
    const ids = new Set<string>(JSON.parse(environmentIds));
    return withDefaultSpace(snapshot.spaces, pinned).filter((space) => ids.has(space.environmentId));
  }, [snapshot.spaces, pinned, environmentIds]);
  const projects = useMemo(
    () => spaces.filter((space) => space.environmentId === PRIMARY_ENVIRONMENT_ID).map((space) => space.path),
    [spaces],
  );
  useLayoutEffect(() => {
    if (!snapshot.loaded || !currentProject || snapshot.focus.environmentId !== PRIMARY_ENVIRONMENT_ID) return;
    const ref = refOf(currentProject);
    const key = projectKeyOf(ref);
    if (closingRef.current === key) return;
    closingRef.current = null;
    workspaceStore.noteCurrentProject(ref, pinned);
  }, [snapshot.loaded, snapshot.focus.environmentId, currentProject, pinned]);
  const environmentViews = useRef(environments);
  environmentViews.current = environments;
  const generations = JSON.stringify(
    environments.map((view) => [view.id, view.status.phase === "connected" ? view.status.generation : null]),
  );
  const validationTargetsKey = JSON.stringify(
    spaces
      .filter((space) => space.key !== (pinned ? projectKeyOf(pinned) : null))
      .map(({ environmentId, path }) => ({ environmentId, path }))
      .sort((left, right) => {
        const leftKey = projectKeyOf(left);
        const rightKey = projectKeyOf(right);
        return leftKey < rightKey ? -1 : Number(leftKey > rightKey);
      }),
  );
  useEffect(() => {
    let cancelled = false;
    const views = new Map(environmentViews.current.map((view) => [view.id, view]));
    const targets: ProjectSpaceRef[] = JSON.parse(validationTargetsKey);
    void Promise.all(
      targets.map((space) =>
        probePresence(space, views.get(space.environmentId), (path) =>
          getEnvironmentApiClient(space.environmentId).validateCwd(path),
        ),
      ),
    ).then((checked) => {
      if (cancelled) return;
      setMissing((previous) => mergeMissing(previous, checked));
    });
    return () => {
      cancelled = true;
    };
  }, [validationTargetsKey, refreshKey, generations]);
  const isMissing = useCallback(
    (folder: string | null | undefined, environmentId = PRIMARY_ENVIRONMENT_ID) =>
      !!folder && missing.has(projectKeyOf(refOf(folder, environmentId))),
    [missing],
  );
  const canMove = useCallback(
    (folder: string, offset: -1 | 1, environmentId = PRIMARY_ENVIRONMENT_ID) =>
      canMoveProjectSpace(spaces, projectKeyOf(refOf(folder, environmentId)), offset, pinned),
    [spaces, pinned],
  );
  const add = useCallback(
    (folder: string, environmentId = PRIMARY_ENVIRONMENT_ID) =>
      workspaceStore.noteCurrentProject(refOf(folder, environmentId), pinned),
    [pinned],
  );
  const close = useCallback(
    (folder: string, environmentId = PRIMARY_ENVIRONMENT_ID) => {
      const key = projectKeyOf(refOf(folder, environmentId));
      if (pinned && key === projectKeyOf(pinned)) return;
      const current =
        snapshot.focus.spaceKey === key ||
        (environmentId === PRIMARY_ENVIRONMENT_ID &&
          snapshot.focus.environmentId === PRIMARY_ENVIRONMENT_ID &&
          currentProject !== null &&
          key === projectKeyOf(refOf(currentProject)));
      if (current) closingRef.current = key;
      workspaceStore.unmount(key);
      if (current) onCloseCurrent();
    },
    [pinned, snapshot.focus, currentProject, onCloseCurrent],
  );
  const move = useCallback(
    (folder: string, offset: -1 | 1, environmentId = PRIMARY_ENVIRONMENT_ID) => {
      const key = projectKeyOf(refOf(folder, environmentId));
      if (!canMoveProjectSpace(spaces, key, offset, pinned)) return;
      const index = spaces.findIndex((space) => space.key === key);
      const target = spaces[index + offset];
      const from = snapshot.spaces.findIndex((space) => space.key === key);
      const to = snapshot.spaces.findIndex((space) => space.key === target?.key);
      workspaceStore.reorder(from, to + (offset === 1 ? 1 : 0), pinned);
    },
    [spaces, snapshot.spaces, pinned],
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
  return {
    spaces,
    projects,
    pinned: pinned ? projectKeyOf(pinned) : null,
    missing,
    isMissing,
    canMove,
    add,
    close,
    move,
    reorder,
  };
}
