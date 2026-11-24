import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId, type EnvironmentView } from "@contract/environment";
import type { MountedSpace } from "@/lib/workspace-store";
import { projectKeyOf } from "@shared/project-space-state";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { isPersonalSpace, spaceDisplayName, spaceFolderName } from "@/lib/space-identity";
import { worktreePathsEqual } from "@shared/worktree-path";
import type {
  ComposerCardBlocked,
  ComposerCardPane,
  ComposerCardProject,
  ComposerCheckout,
  ComposerWorkspaceCard,
} from "../chat-input/types";
import { branchSections, checkoutSections } from "../chat-input/workspace-card-rows";
import type { ProjectWorkspaceState } from "../session-sidebar/project-workspace";
import { useWorkspaceCardData } from "./use-workspace-card-data";

interface BlockedSwitch {
  environmentId: EnvironmentId;
  reason: "dirty" | "busy";
  branch: string;
  projectPath: string;
}

function isConnecting(view: EnvironmentView | undefined): boolean {
  return view?.status.phase === "connecting" || view?.status.phase === "backoff";
}

export type FolderOutcome = { ok: boolean; error?: string };

export function useWorkspaceCard({
  environmentId,
  workspace,
  open,
  spaces,
  environments,
  currentFolder,
  currentProject,
  isMissing,
  personalCwd,
  homeDir,
  onGoToFolder,
  onReturnToPersonalSpace,
  onSwitched,
}: {
  environmentId: EnvironmentId;
  workspace: ProjectWorkspaceState;
  open: boolean;
  spaces: readonly MountedSpace[] | null;
  environments: readonly EnvironmentView[];
  currentFolder: string | null;
  currentProject: { name: string; path: string } | null;
  isMissing: (folder: string | null | undefined, environmentId?: EnvironmentId) => boolean;
  personalCwd: string | null;
  homeDir: string;
  onGoToFolder: (folder: string, targetEnvironmentId?: EnvironmentId) => Promise<FolderOutcome>;
  onReturnToPersonalSpace: () => void;
  onSwitched: () => void;
}): ComposerWorkspaceCard {
  const { language, t } = useI18n();
  const worktreeEntries = workspace.worktreeState?.worktrees;
  const checkouts: ComposerCheckout[] = useMemo(
    () => (workspace.showWorktreeSwitcher ? (worktreeEntries ?? []) : []),
    [worktreeEntries, workspace.showWorktreeSwitcher],
  );
  const anchorProject = currentProject?.path ?? currentFolder;
  const [browsedSelection, setBrowsed] = useState({ environmentId, path: anchorProject });
  const browsed = browsedSelection.path;
  const browsedEnvironmentId = browsedSelection.environmentId;
  const environment = environments.find((view) => view.id === browsedEnvironmentId);
  const generation = environment?.status.phase === "connected" ? environment.status.generation : null;
  const browsedHomeDir =
    browsedEnvironmentId === PRIMARY_ENVIRONMENT_ID ? homeDir : (environment?.descriptor?.platform.home ?? "");
  const [openToken, setOpenToken] = useState(0);
  const [filter, setFilter] = useState("");
  const [blocked, setBlocked] = useState<BlockedSwitch | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const mounted = useRef(true);
  const actionContext = JSON.stringify([environmentId, currentFolder, open, browsedEnvironmentId, browsed, generation]);
  const latest = useRef({ actionContext });
  latest.current = { actionContext };
  const actionRequest = useRef(0);
  const navigationRequest = useRef(0);
  const currentRoot = workspace.selectedProject ?? currentProject?.path ?? null;
  const queryFolder =
    browsedEnvironmentId === environmentId && browsed && currentRoot && worktreePathsEqual(browsed, currentRoot)
      ? (workspace.selectedCwd ?? browsed)
      : browsed;

  useEffect(() => {
    if (!open) return;
    setOpenToken((token) => token + 1);
    setBrowsed({ environmentId, path: currentProject?.path ?? currentFolder ?? null });
    setFilter("");
    setBlocked(null);
    setFailure(null);
  }, [open, currentProject?.path, currentFolder, environmentId]);

  const { listing, factsFor, authorize, loadBranches } = useWorkspaceCardData({
    activeEnvironmentId: environmentId,
    browsedEnvironmentId,
    folder: queryFolder,
    spaces,
    environments,
    open,
    refreshKey: workspace.wtRefreshKey,
    refreshToken: openToken,
    isMissing,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pane: ComposerCardPane = (() => {
    if (spaces === null) {
      if (checkouts.length === 0) return { state: "not-repo" };
      const sections = checkoutSections({
        checkouts,
        selectedCwd: workspace.selectedCwd,
        blocked,
        homeDir,
      });
      const count = sections.current.length + sections.folders.length + sections.others.length + sections.stale.length;
      return { state: "ready", count, sections };
    }
    if (generation === null)
      return {
        state: "offline",
        environmentLabel:
          browsedEnvironmentId === PRIMARY_ENVIRONMENT_ID
            ? t("serversThisComputer", "This computer")
            : (environment?.label ?? browsedEnvironmentId),
        connecting: isConnecting(environment),
      };
    if (!queryFolder) return { state: "loading" };
    if (listing?.error) return { state: "error", message: listing.error };
    if (!listing?.result) return { state: "loading" };
    if (!listing.result.isGit || !listing.result.isTopLevel) return { state: "not-repo" };
    const { sections, count } = branchSections({
      listing: listing.result,
      folder: queryFolder,
      blocked,
      filter,
      language,
      homeDir: browsedHomeDir,
    });
    return { state: "ready", count, sections };
  })();

  const personalLabel = t("personalSpace", "Default space");
  const displayName = useCallback(
    (folder: string) => spaceDisplayName(folder, personalCwd, homeDir, personalLabel),
    [homeDir, personalCwd, personalLabel],
  );

  const projectRows: ComposerCardProject[] = (() => {
    const folders =
      spaces ??
      (currentProject
        ? [
            {
              environmentId,
              path: currentProject.path,
              key: projectKeyOf({ environmentId, path: currentProject.path }),
              displayPath: currentProject.path,
            },
          ]
        : []);
    const environmentOrder = [...new Set(folders.map((space) => space.environmentId))].sort(
      (left, right) => Number(right === PRIMARY_ENVIRONMENT_ID) - Number(left === PRIMARY_ENVIRONMENT_ID),
    );
    const orderedFolders = environmentOrder.flatMap((id) => folders.filter((space) => space.environmentId === id));
    return orderedFolders.map((space) => {
      const folder = space.path;
      const primary = space.environmentId === PRIMARY_ENVIRONMENT_ID;
      const view = environments.find((view) => view.id === space.environmentId);
      const connecting = isConnecting(view);
      const environmentState = view?.status.phase === "connected" ? "connected" : connecting ? "connecting" : "offline";
      const name =
        space.environmentId === environmentId && currentProject && worktreePathsEqual(currentProject.path, folder)
          ? currentProject.name
          : primary
            ? displayName(folder)
            : spaceFolderName(folder);
      const missing = isMissing(folder, space.environmentId);
      const personal = primary && isPersonalSpace(folder, personalCwd, homeDir);
      const fact = factsFor(space.environmentId, folder);
      const isGit = Boolean(fact?.isGit);
      const current = Boolean(
        space.environmentId === environmentId && currentRoot && worktreePathsEqual(currentRoot, folder),
      );
      return {
        key: space.key,
        environmentId: space.environmentId,
        environmentLabel: primary ? t("serversThisComputer", "This computer") : (view?.label ?? space.environmentId),
        isPrimaryEnvironment: primary,
        environmentState,
        unavailable: environmentState !== "connected",
        path: folder,
        name,
        displayPath: space.displayPath,
        subline:
          environmentState !== "connected"
            ? environmentState === "connecting"
              ? t("workspaceReconnecting", "Reconnecting…")
              : t("serversStatusOffline", "Offline")
            : missing
              ? t("missingFolder", "Folder not found")
              : personal
                ? t("defaultSpaceNote", "Not in any repository")
                : !fact
                  ? ""
                  : isGit
                    ? (fact.branch ?? "")
                    : t("notGitRepo", "Not a git repository"),
        sublineKind: environmentState === "connected" && isGit && !personal && !missing ? "branch" : "note",
        icon: missing ? "folder-missing" : personal ? "house" : current ? "folder-open" : "folder",
        current,
        browsed: Boolean(
          browsedSelection.environmentId === space.environmentId && browsed && worktreePathsEqual(browsed, folder),
        ),
        missing,
      };
    });
  })();

  const browsedName =
    projectRows.find((project) => project.browsed)?.name ??
    (browsed
      ? browsedEnvironmentId === PRIMARY_ENVIRONMENT_ID
        ? displayName(browsed)
        : spaceFolderName(browsed)
      : "");
  const closeCard = workspace.resetWorktreeDropdownForOutsideClick;

  const goTo = useCallback(
    async (folder: string, targetEnvironmentId = environmentId) => {
      const request = ++navigationRequest.current;
      const outcome = await onGoToFolder(folder, targetEnvironmentId);
      if (mounted.current && latest.current.actionContext === actionContext && navigationRequest.current === request) {
        closeCard();
        if (!outcome.ok) setFailure(outcome.error ?? null);
      }
      return outcome.ok;
    },
    [actionContext, closeCard, onGoToFolder, environmentId],
  );

  const activateProject = useCallback(
    (key: string) => {
      const project = projectRows.find((row) => row.key === key);
      if (!project || project.missing || project.unavailable) return;
      const path = project.path;
      if (project.environmentId === environmentId && worktreePathsEqual(path, currentFolder ?? "")) {
        closeCard();
        return;
      }
      if (project.isPrimaryEnvironment && isPersonalSpace(path, personalCwd, homeDir)) {
        closeCard();
        onReturnToPersonalSpace();
        return;
      }
      void goTo(path, project.environmentId);
    },
    [projectRows, environmentId, closeCard, currentFolder, goTo, homeDir, onReturnToPersonalSpace, personalCwd],
  );

  const browseProject = useCallback(
    (key: string) => {
      const project = projectRows.find((row) => row.key === key);
      if (!project || project.missing) return;
      setFilter("");
      setBlocked(null);
      setFailure(null);
      workspace.cancelWorktreeRemove();
      setBrowsed({ environmentId: project.environmentId, path: project.path });
    },
    [projectRows, workspace],
  );

  useEffect(() => {
    actionRequest.current += 1;
    navigationRequest.current += 1;
    setBlocked(null);
    setSwitching(false);
  }, [actionContext]);

  const runAction = useCallback(
    async (operation: (isCurrent: () => boolean, canNavigate: () => boolean) => Promise<void>) => {
      if (!open || (spaces !== null && (generation === null || isMissing(browsed, browsedEnvironmentId)))) return;
      const request = ++actionRequest.current;
      const navRequest = navigationRequest.current;
      const isCurrent = () =>
        mounted.current && latest.current.actionContext === actionContext && actionRequest.current === request;
      const canNavigate = () => isCurrent() && navigationRequest.current === navRequest;
      setSwitching(true);
      setFailure(null);
      try {
        await operation(isCurrent, canNavigate);
      } catch (error) {
        if (isCurrent()) setFailure(error instanceof Error ? error.message : String(error));
      } finally {
        if (isCurrent()) setSwitching(false);
      }
    },
    [actionContext, browsed, browsedEnvironmentId, generation, isMissing, open, spaces],
  );

  const switchIn = useCallback(
    (cwd: string, branch: string, other: boolean) =>
      runAction(async (isCurrent, canNavigate) => {
        if (generation !== null) await authorize(cwd);
        if (!isCurrent()) return;
        const result = await getEnvironmentApiClient(browsedEnvironmentId).call("worktrees.switchBranch", {
          cwd,
          branch,
        });
        if (!isCurrent()) return;
        if (result.ok) {
          onSwitched();
          if (other) {
            if (canNavigate()) await goTo(cwd, browsedEnvironmentId);
          } else {
            closeCard();
          }
          return;
        }
        if (result.reason === "occupied" && result.path) {
          if (canNavigate()) await goTo(result.path, browsedEnvironmentId);
          return;
        }
        if (result.reason === "stale") {
          loadBranches(cwd);
          return;
        }
        if (result.reason === "dirty" || result.reason === "busy") {
          setBlocked({ environmentId: browsedEnvironmentId, reason: result.reason, branch, projectPath: cwd });
        }
      }),
    [authorize, browsedEnvironmentId, closeCard, generation, goTo, loadBranches, onSwitched, runAction],
  );

  const activateBranch = useCallback(
    (key: string) => {
      if (pane.state !== "ready") return;
      const rows = [...pane.sections.current, ...pane.sections.folders, ...pane.sections.others];
      const row = rows.find((entry) => entry.key === key);
      if (!row || row.disabled) return;
      if (row.kind === "current" || row.kind === "folder" || row.kind === "detached") {
        if (!row.path) return;
        if (browsedEnvironmentId === environmentId && worktreePathsEqual(row.path, currentFolder ?? "")) {
          closeCard();
          return;
        }
        void goTo(row.path, browsedEnvironmentId);
        return;
      }
      if (row.kind !== "local" || !browsed) return;
      const sameProject = Boolean(
        browsedEnvironmentId === environmentId && currentRoot && worktreePathsEqual(currentRoot, browsed),
      );
      void switchIn(sameProject ? (workspace.selectedCwd ?? browsed) : browsed, row.name, !sameProject);
    },
    [
      browsed,
      browsedEnvironmentId,
      environmentId,
      closeCard,
      currentFolder,
      currentRoot,
      goTo,
      pane,
      switchIn,
      workspace.selectedCwd,
    ],
  );

  const blockedMessage: ComposerCardBlocked | null = useMemo(() => {
    if (!blocked) return null;
    const other =
      blocked.environmentId !== environmentId || !worktreePathsEqual(blocked.projectPath, workspace.selectedCwd ?? "");
    const projectName =
      projectRows.find(
        (project) =>
          project.environmentId === blocked.environmentId && worktreePathsEqual(project.path, blocked.projectPath),
      )?.name ?? browsedName;
    return {
      reason: blocked.reason,
      branch: blocked.branch,
      projectPath: blocked.projectPath,
      title:
        blocked.reason === "dirty"
          ? other
            ? t("blockedDirtyOther", "{project}'s main folder has uncommitted changes").replace(
                "{project}",
                projectName,
              )
            : t("blockedDirty", "This folder has uncommitted changes")
          : other
            ? t("blockedBusyOther", "A session or process is running in {project}'s main folder").replace(
                "{project}",
                projectName,
              )
            : t("blockedBusy", "A session or process is running in this folder"),
      detail:
        blocked.reason === "dirty"
          ? t("blockedDirtyDetail", "Switching now would carry these changes to the other branch.")
          : t("blockedBusyDetail", "Switching now would change the files it is reading."),
    };
  }, [blocked, browsedName, projectRows, t, workspace.selectedCwd, environmentId]);

  const createWorktree = useCallback(
    (projectRoot: string, branch?: string, fromBlocked = false) => {
      void runAction(async (isCurrent, canNavigate) => {
        const path = await workspace.createWorktreeAt(
          { projectRoot, ...(branch ? { branch } : {}) },
          browsedEnvironmentId,
        );
        if (!path || !isCurrent()) return;
        if (fromBlocked) setBlocked(null);
        if (browsedEnvironmentId !== environmentId) {
          if (canNavigate()) await goTo(path, browsedEnvironmentId);
        } else if (fromBlocked) {
          closeCard();
        }
      });
    },
    [browsedEnvironmentId, closeCard, environmentId, goTo, runAction, workspace],
  );

  const openBlockedInNewWorktree = useCallback(() => {
    if (blocked) createWorktree(blocked.projectPath, blocked.branch, true);
  }, [blocked, createWorktree]);

  const createCheckout = useCallback(() => {
    if (browsed) createWorktree(browsed);
  }, [browsed, createWorktree]);

  const removeCheckout = useCallback(
    (path: string, force: boolean) => {
      void runAction(async (isCurrent) => {
        await workspace.handleRemoveWorktree(path, force, browsed ?? undefined, browsedEnvironmentId);
        if (isCurrent() && queryFolder) loadBranches(queryFolder);
      });
    },
    [browsed, browsedEnvironmentId, loadBranches, queryFolder, runAction, workspace],
  );

  return {
    projects: projectRows,
    pane,
    browsedName,
    browsedEnvironmentId: browsedSelection.environmentId,
    retryBranches: () => {
      if (queryFolder) loadBranches(queryFolder);
    },
    showEnvironmentGroups: projectRows.some((project) => !project.isPrimaryEnvironment),
    folder: browsed ?? "",
    showFilter: true,
    filter,
    setFilter,
    blocked: blockedMessage,
    dismissBlocked: () => setBlocked(null),
    openBlockedInNewWorktree,
    newEntryOpen: workspace.wtNewOpen,
    newBranch: workspace.wtNewBranch,
    setNewBranch: workspace.setNewWorktreeBranch,
    openNewEntry: workspace.openNewWorktreeEntry,
    closeNewEntry: workspace.closeNewWorktreeEntry,
    createCheckout,
    removeCheckout,
    confirmRemovePath:
      workspace.wtConfirmRemoveTarget !== undefined
        ? workspace.wtConfirmRemoveTarget?.environmentId === browsedEnvironmentId
          ? workspace.wtConfirmRemoveTarget.path
          : null
        : workspace.wtConfirmRemove,
    cancelRemove: workspace.cancelWorktreeRemove,
    busy: workspace.wtBusy || switching,
    error: failure ?? listing?.error ?? workspace.wtError,
    activateProject,
    browseProject,
    activateBranch,
  };
}
