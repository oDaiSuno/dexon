import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { worktreePathsEqual } from "@shared/worktree-path";

// Split from SessionSidebar.tsx in Phase 2: the workspace/worktree state owner.
// Owns the effective cwd, worktree data for it, project-root resolution, the
// directory-selection operations, and the worktree operations INCLUDING their
// switcher UI state (dropdown, new-entry draft, busy/error, remove confirm) —
// the persistent owner keeps in-flight operations and their feedback alive
// across project switches, exactly as the original always-mounted sidebar did.

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
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
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtBusy, setWtBusy] = useState(false);
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);

  /** Resolve the project root for a cwd from the freshest data available */
  const projectRootFor = useCallback(
    (cwd: string | null): string | null => {
      if (!cwd) return null;
      if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;
      // Any path in the loaded worktree list belongs to that project — covers
      // worktrees without sessions, so switching to them keeps the row mounted.
      if (worktreeState?.worktrees.some((w) => w.path === cwd)) return worktreeState.projectRoot;
      const match = sessions.find((s) => s.cwd === cwd);
      return match?.projectRoot ?? cwd;
    },
    [worktreeState, sessions],
  );

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes). The
  // origin tells the shell whether this value was set by the coordinator's
  // own push (prop sync) or by a genuine user action in the sidebar — late
  // echoes of pushed values must never be mistaken for new user choices.
  const lastNotifiedCwdRef = useRef<string | null>(null);
  const pendingSyncEchoRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    const fromCoordinator = pendingSyncEchoRef.current !== null && pendingSyncEchoRef.current === selectedCwd;
    pendingSyncEchoRef.current = null;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd), fromCoordinator ? "coordinator" : "user");
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      pendingSyncEchoRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      return;
    }
    let cancelled = false;
    void import("@/lib/api-client")
      .then(({ call }) => call("worktrees.list", { projectRoot: selectedCwd }))
      .then((d) => {
        if (cancelled) return;
        setWorktreeState({
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
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  const openDirectory = useCallback(
    async (dir: string): Promise<WorkspaceSelectResult> => {
      try {
        const res = await fetch("/api/cwd/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: dir }),
        });
        const data = (await res.json().catch(() => ({}))) as { cwd?: string; error?: string };
        if (!res.ok || data.error) {
          return { status: "invalid", error: data.error ?? t("invalidDirectory", "Invalid directory") };
        }
        setSelectedCwd(data.cwd ?? dir);
        return { status: "selected" };
      } catch (e) {
        return { status: "invalid", error: e instanceof Error ? e.message : String(e) };
      }
    },
    [t],
  );

  /** Desktop-native directory picker (design §6.1). Falls back to path input. */
  const selectDirectoryFromPicker = useCallback(
    async (onSelected?: (folder: string) => void): Promise<WorkspaceSelectResult> => {
      let dir: string | null | undefined;
      try {
        dir = await window.piBridge?.selectDirectory?.();
      } catch (e) {
        return { status: "invalid", error: e instanceof Error ? e.message : String(e) };
      }
      if (!dir) return { status: "cancelled" };
      const result = await openDirectory(dir);
      if (result.status === "selected") onSelected?.(dir);
      return result;
    },
    [openDirectory],
  );

  const createWorktreeAt = useCallback(
    async (target: { projectRoot: string; branch?: string } | null): Promise<string | null> => {
      const branch = (target?.branch ?? wtNewBranch).trim();
      const projectRoot = target?.projectRoot ?? worktreeState?.projectRoot;
      if (!branch || wtBusy || !projectRoot) return null;
      setWtBusy(true);
      setWtError(null);
      try {
        const { call } = await import("@/lib/api-client");
        const { worktree } = await call("worktrees.create", {
          projectRoot,
          cwd: projectRoot,
          branch,
        });
        setWorktreeState((prev) => {
          const entry = { path: worktree.path, branch, isMain: false };
          const sameProject = Boolean(prev && worktreePathsEqual(prev.projectRoot, projectRoot));
          return {
            forCwd: worktree.path,
            projectRoot,
            isGit: true,
            isTopLevel: true,
            worktrees: sameProject && prev ? [...prev.worktrees, entry] : [entry],
          };
        });
        setSelectedCwd(worktree.path);
        setWtRefreshKey((k) => k + 1);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtDropdownOpen(false);
        return worktree.path;
      } catch (e) {
        setWtError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setWtBusy(false);
      }
    },
    [wtNewBranch, wtBusy, worktreeState],
  );

  const handleCreateWorktree = useCallback(() => {
    void createWorktreeAt(null);
  }, [createWorktreeAt]);

  const handleRemoveWorktree = useCallback(
    async (path: string, force: boolean, projectCwd?: string) => {
      const cwd = projectCwd ?? worktreeState?.projectRoot;
      if (!cwd || wtBusy) return;
      setWtBusy(true);
      setWtError(null);
      try {
        const { call } = await import("@/lib/api-client");
        await call("worktrees.remove", {
          cwd,
          path,
          force,
        });
        setWtConfirmRemove(null);
        if (selectedCwd === path) setSelectedCwd(cwd);
        setWtRefreshKey((k) => k + 1);
      } catch (e) {
        if (!force && (e as { detail?: { dirty?: boolean } }).detail?.dirty) {
          setWtConfirmRemove(path);
          return;
        }
        setWtError(e instanceof Error ? e.message : String(e));
      } finally {
        setWtBusy(false);
      }
    },
    [worktreeState, wtBusy, selectedCwd],
  );

  // Clicking a worktree row moves the effective cwd and closes the dropdown —
  // verbatim from the original monolith.
  const handleSelectWorktree = useCallback((path: string) => {
    setWtDropdownOpen(false);
    setWtError(null);
    setSelectedCwd(path);
  }, []);

  // Outside click closes the dropdown and resets its entry/confirm/error state —
  // verbatim from the original monolith's shared document listener.
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

  // Sessions of every worktree in the selected project are shown together.
  // Paths come from mixed sources (session files, git output) and may differ
  // in separators/casing on Windows, so compare with worktreePathsEqual.
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
