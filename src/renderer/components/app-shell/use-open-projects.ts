import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { validateCwd } from "@/lib/api-client";
import { sessionProjectKey } from "@/lib/session-list";
import {
  addOpenProject,
  canMoveOpenProject,
  isListedProject,
  moveOpenProject,
  readOpenProjects,
  removeOpenProject,
  reorderOpenProjects,
  withDefaultSpace,
} from "@/lib/open-projects";

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
  const [saved, setSaved] = useState<string[]>([]);
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  const [loaded, setLoaded] = useState(false);
  const touchedRef = useRef(false);
  const closingRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.resolve(window.piBridge?.getUiState?.()).then(
      (state) => {
        if (!mounted) return;
        if (!touchedRef.current) setSaved(readOpenProjects(state?.openProjects));
        setLoaded(true);
      },
      () => {
        if (mounted) setLoaded(true);
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  const projects = useMemo(() => withDefaultSpace(saved, defaultSpace), [saved, defaultSpace]);

  const pendingRef = useRef<string[] | null>(null);
  const writtenRef = useRef<string | null>(null);
  const writingRef = useRef(false);

  const persist = useCallback((list: string[]) => {
    if (pendingRef.current === null && writtenRef.current === JSON.stringify(list)) return;
    pendingRef.current = list;
    if (writingRef.current) return;
    writingRef.current = true;
    void (async () => {
      try {
        while (pendingRef.current !== null) {
          const next = pendingRef.current;
          pendingRef.current = null;
          writtenRef.current = JSON.stringify(next);
          try {
            await window.piBridge?.setUiState?.({ openProjects: next });
          } catch {
            writtenRef.current = null;
          }
        }
      } finally {
        writingRef.current = false;
      }
    })();
  }, []);

  const commit = useCallback(
    (list: string[]) => {
      touchedRef.current = true;
      const next = withDefaultSpace(list, defaultSpace);
      setSaved(next);
      persist(next);
    },
    [defaultSpace, persist],
  );

  useLayoutEffect(() => {
    if (!loaded || !currentProject) return;
    const key = sessionProjectKey(currentProject);
    if (closingRef.current !== null && closingRef.current !== key) closingRef.current = null;
    if (closingRef.current === key) return;
    if (defaultSpace && key === sessionProjectKey(defaultSpace)) return;
    if (isListedProject(projects, currentProject)) return;
    commit(addOpenProject(projects, currentProject, defaultSpace));
  }, [loaded, currentProject, defaultSpace, projects, commit]);

  const generationRef = useRef(0);
  useEffect(() => {
    const generation = ++generationRef.current;
    const defaultKey = defaultSpace ? sessionProjectKey(defaultSpace) : null;
    const folders = projects.filter((folder) => sessionProjectKey(folder) !== defaultKey);
    void Promise.all(
      folders.map(async (folder) => {
        try {
          const result = await validateCwd(folder);
          return result.ok ? null : sessionProjectKey(folder);
        } catch {
          return sessionProjectKey(folder);
        }
      }),
    ).then((checked) => {
      if (generation !== generationRef.current) return;
      setMissing(new Set(checked.filter((key): key is string => key !== null)));
    });
  }, [projects, defaultSpace, refreshKey]);

  const isMissing = useCallback(
    (folder: string | null | undefined) => (folder ? missing.has(sessionProjectKey(folder)) : false),
    [missing],
  );

  const canMove = useCallback(
    (folder: string, offset: -1 | 1) => canMoveOpenProject(projects, folder, offset, defaultSpace),
    [projects, defaultSpace],
  );

  const add = useCallback(
    (folder: string) => commit(addOpenProject(projects, folder, defaultSpace)),
    [commit, projects, defaultSpace],
  );

  const close = useCallback(
    (folder: string) => {
      if (defaultSpace && sessionProjectKey(folder) === sessionProjectKey(defaultSpace)) return;
      const closingCurrent = currentProject !== null && sessionProjectKey(currentProject) === sessionProjectKey(folder);
      if (closingCurrent) closingRef.current = sessionProjectKey(folder);
      commit(removeOpenProject(projects, folder));
      if (closingCurrent) onCloseCurrent();
    },
    [commit, projects, defaultSpace, currentProject, onCloseCurrent],
  );

  const move = useCallback(
    (folder: string, offset: -1 | 1) => commit(moveOpenProject(projects, folder, offset, defaultSpace)),
    [commit, projects, defaultSpace],
  );

  const reorder = useCallback(
    (from: number, to: number) => commit(reorderOpenProjects(projects, from, to, defaultSpace)),
    [commit, projects, defaultSpace],
  );

  return { projects, missing, isMissing, canMove, add, close, move, reorder };
}
