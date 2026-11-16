import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { projectKeyOf } from "@shared/project-space-state";
import { worktreePathsEqual } from "@shared/worktree-path";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { workspaceStore } from "@/lib/workspace-store";
import { useActiveEnvironment } from "@/lib/environment-registry";

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface WorktreeState {
  environmentId: string;
  generation: number | null;
  forCwd: string;
  projectRoot: string;
  isGit: boolean;

  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

export type WorkspaceSelectResult =
  { status: "cancelled" } | { status: "selected" } | { status: "invalid"; error: string };

export function useProjectWorkspace({
  sessions,
  selectedCwdProp,
  onCwdChange,
  refreshKey,
}: {
  sessions: readonly Pick<SessionInfo, "cwd" | "projectRoot">[];
  selectedCwdProp: string | null | undefined;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null, origin?: "user" | "coordinator") => void;
  refreshKey?: number;
}) {
  const { t } = useI18n();
  const environment = useActiveEnvironment();
  const { focus } = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const scope = JSON.stringify(focus);
  const [selection, setSelection] = useState<{ scope: string; cwd: string | null } | null>(null);
  const selectedCwd = selection?.scope === scope ? selection.cwd : (selectedCwdProp ?? null);
  const setSelectedCwd = useCallback((cwd: string | null, environmentId: EnvironmentId) => {
    const focus = workspaceStore.getSnapshot().focus;
    if (focus.environmentId === environmentId) setSelection({ scope: JSON.stringify(focus), cwd });
  }, []);
  const generation = environment.status.phase === "connected" ? environment.status.generation : null;
  const operationScope = JSON.stringify([environment.id, generation, selectedCwd]);
  const currentScope = useRef(operationScope);
  currentScope.current = operationScope;
  const [storedWorktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const worktreeState =
    storedWorktreeState?.environmentId === environment.id && storedWorktreeState.generation === generation
      ? storedWorktreeState
      : null;
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtBusy, setWtBusy] = useState(false);
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);

  const projectRootFor = useCallback(
    (cwd: string | null): string | null => {
      if (!cwd) return null;
      if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;

      if (worktreeState?.worktrees.some((w) => w.path === cwd)) return worktreeState.projectRoot;
      const match = sessions.find((s) => s.cwd === cwd);
      return match?.projectRoot ?? cwd;
    },
    [worktreeState, sessions],
  );

  const lastNotifiedCwdRef = useRef<string | null>(null);
  const pendingSyncEchoRef = useRef<string | null>(null);
  useEffect(() => {
    const key = selectedCwd ? projectKeyOf({ environmentId: environment.id, path: selectedCwd }) : null;
    if (lastNotifiedCwdRef.current === key) return;
    lastNotifiedCwdRef.current = key;
    const fromCoordinator =
      selection?.scope !== scope || (pendingSyncEchoRef.current !== null && pendingSyncEchoRef.current === key);
    pendingSyncEchoRef.current = null;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd), fromCoordinator ? "coordinator" : "user");
  }, [selectedCwd, selection?.scope, scope, environment.id, onCwdChange, projectRootFor]);

  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    const key = selectedCwdProp ? projectKeyOf({ environmentId: environment.id, path: selectedCwdProp }) : null;
    if (selectedCwdProp && key !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = key;
      pendingSyncEchoRef.current = key;
      setSelectedCwd(selectedCwdProp, environment.id);
    }
  }, [selectedCwdProp, environment.id, setSelectedCwd]);

  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      return;
    }
    let cancelled = false;
    const api = getEnvironmentApiClient(environment.id);
    const authorize =
      environment.id === PRIMARY_ENVIRONMENT_ID
        ? Promise.resolve()
        : api.validateCwd(selectedCwd).then((result) => {
            if (!result.ok) throw new Error("Project folder is unavailable");
          });
    void authorize
      .then(() => api.listWorktrees(selectedCwd))
      .then((d) => {
        if (cancelled) return;
        setWorktreeState({
          environmentId: environment.id,
          generation,
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          isGit: d.isGit,
          isTopLevel: d.isTopLevel,
          worktrees: d.worktrees.map((worktree) => ({
            path: worktree.path,
            branch: worktree.branch ?? null,
            isMain: worktree.isMain === true,
          })),
        });
      })
      .catch(() => {
        if (!cancelled) setWorktreeState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCwd, wtRefreshKey, refreshKey, environment.id, generation]);

  const openDirectory = useCallback(
    async (dir: string, environmentId: EnvironmentId): Promise<WorkspaceSelectResult> => {
      const origin = workspaceStore.getSnapshot().focus;
      try {
        const data = await getEnvironmentApiClient(environmentId).validateCwd(dir);
        if (workspaceStore.getSnapshot().focus !== origin) return { status: "cancelled" };
        if (!data.ok || data.error) {
          return { status: "invalid", error: data.error ?? t("invalidDirectory", "Invalid directory") };
        }
        const path = data.path ?? dir;
        const root = projectRootFor(path) ?? path;
        if (environmentId !== origin.environmentId || selectedCwd === path) {
          if (origin.environmentId === environmentId && origin.sessionId) {
            workspaceStore.focusSession({ id: origin.sessionId, environmentId, cwd: path, projectRoot: root });
          } else {
            workspaceStore.openSpace({ environmentId, path: root });
          }
        }
        setSelectedCwd(path, environmentId);
        return { status: "selected" };
      } catch (e) {
        return { status: "invalid", error: e instanceof Error ? e.message : String(e) };
      }
    },
    [t, setSelectedCwd, projectRootFor, selectedCwd],
  );

  const selectDirectoryFromPicker = useCallback(
    async (
      onSelected: ((folder: string) => void) | undefined,
      environmentId: EnvironmentId,
    ): Promise<WorkspaceSelectResult> => {
      let dir: string | null | undefined;
      try {
        dir = await window.piBridge?.selectDirectory?.();
      } catch (e) {
        return { status: "invalid", error: e instanceof Error ? e.message : String(e) };
      }
      if (!dir) return { status: "cancelled" };
      const result = await openDirectory(dir, environmentId);
      if (result.status === "selected") onSelected?.(dir);
      return result;
    },
    [openDirectory],
  );

  const createWorktreeAt = useCallback(
    async (target: { projectRoot: string; branch?: string } | null): Promise<string | null> => {
      const environmentId = environment.id;
      const origin = workspaceStore.getSnapshot().focus;
      const branch = (target?.branch ?? wtNewBranch).trim();
      const projectRoot = target?.projectRoot ?? worktreeState?.projectRoot;
      if (!branch || wtBusy || !projectRoot) return null;
      setWtBusy(true);
      setWtError(null);
      try {
        const { worktree } = await getEnvironmentApiClient(environmentId).call("worktrees.create", {
          projectRoot,
          cwd: projectRoot,
          branch,
        });
        if (workspaceStore.getSnapshot().focus !== origin || currentScope.current !== operationScope) return null;
        setWorktreeState((prev) => {
          const entry = { path: worktree.path, branch, isMain: false };
          const sameProject = Boolean(
            prev && prev.environmentId === environmentId && worktreePathsEqual(prev.projectRoot, projectRoot),
          );
          return {
            environmentId,
            generation,
            forCwd: worktree.path,
            projectRoot,
            isGit: true,
            isTopLevel: true,
            worktrees: sameProject && prev ? [...prev.worktrees, entry] : [entry],
          };
        });
        setSelectedCwd(worktree.path, environmentId);
        setWtRefreshKey((k) => k + 1);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtDropdownOpen(false);
        return worktree.path;
      } catch (e) {
        if (workspaceStore.getSnapshot().focus === origin && currentScope.current === operationScope)
          setWtError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setWtBusy(false);
      }
    },
    [wtNewBranch, wtBusy, worktreeState, environment.id, generation, setSelectedCwd, operationScope],
  );

  const handleCreateWorktree = useCallback(() => {
    void createWorktreeAt(null);
  }, [createWorktreeAt]);

  const handleRemoveWorktree = useCallback(
    async (path: string, force: boolean, projectCwd?: string) => {
      const environmentId = environment.id;
      const origin = workspaceStore.getSnapshot().focus;
      const cwd = projectCwd ?? worktreeState?.projectRoot;
      if (!cwd || wtBusy) return;
      setWtBusy(true);
      setWtError(null);
      try {
        await getEnvironmentApiClient(environmentId).call("worktrees.remove", {
          cwd,
          path,
          force,
        });
        if (currentScope.current !== operationScope) return;
        setWtRefreshKey((k) => k + 1);
        if (workspaceStore.getSnapshot().focus !== origin) return;
        setWtConfirmRemove(null);
        if (selectedCwd === path) setSelectedCwd(cwd, environmentId);
      } catch (e) {
        if (workspaceStore.getSnapshot().focus !== origin || currentScope.current !== operationScope) return;
        if (!force && (e as { detail?: { dirty?: boolean } }).detail?.dirty) {
          setWtConfirmRemove(path);
          return;
        }
        setWtError(e instanceof Error ? e.message : String(e));
      } finally {
        setWtBusy(false);
      }
    },
    [worktreeState, wtBusy, selectedCwd, environment.id, setSelectedCwd, operationScope],
  );

  const handleSelectWorktree = useCallback(
    (path: string) => {
      setWtDropdownOpen(false);
      setWtError(null);
      setSelectedCwd(path, environment.id);
    },
    [setSelectedCwd, environment.id],
  );

  const resetWorktreeDropdownForOutsideClick = useCallback(() => {
    setWtDropdownOpen(false);
    setWtNewOpen(false);
    setWtNewBranch("");
    setWtError(null);
    setWtConfirmRemove(null);
  }, []);

  const openNewWorktreeEntry = useCallback(() => {
    setWtNewOpen(true);
    setWtError(null);
  }, []);

  const closeNewWorktreeEntry = useCallback(() => {
    setWtNewOpen(false);
    setWtNewBranch("");
    setWtError(null);
  }, []);

  const setNewWorktreeBranch = useCallback((branch: string) => {
    setWtNewBranch(branch);
    setWtError(null);
  }, []);

  const toggleWorktreeDropdown = useCallback(() => {
    setWtDropdownOpen((v) => !v);
  }, []);

  const cancelWorktreeRemove = useCallback(() => {
    setWtConfirmRemove(null);
  }, []);

  const selectedProject = projectRootFor(selectedCwd);
  useEffect(
    () => resetWorktreeDropdownForOutsideClick(),
    [environment.id, generation, selectedCwd, resetWorktreeDropdownForOutsideClick],
  );

  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit &&
    worktreeState.isTopLevel &&
    selectedCwd &&
    selectedProject &&
    worktreePathsEqual(selectedProject, worktreeState.projectRoot),
  );
  return {
    selectedCwd,
    setSelectedCwd,
    worktreeState,
    projectRootFor,
    selectedProject,
    showWorktreeSwitcher,
    selectDirectoryFromPicker,
    openDirectory,
    wtRefreshKey,
    wtDropdownOpen,
    toggleWorktreeDropdown,
    resetWorktreeDropdownForOutsideClick,
    wtNewOpen,
    openNewWorktreeEntry,
    closeNewWorktreeEntry,
    wtNewBranch,
    setNewWorktreeBranch,
    wtBusy,
    wtError,
    wtConfirmRemove,
    cancelWorktreeRemove,
    handleCreateWorktree,
    createWorktreeAt,
    handleRemoveWorktree,
    handleSelectWorktree,
  };
}

export type ProjectWorkspaceState = ReturnType<typeof useProjectWorkspace>;
