import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { isPersonalSpace, spaceDisplayName } from "@/lib/space-identity";
import { worktreePathsEqual } from "@shared/worktree-path";
import type { WorktreeBranchesResult, WorktreeSwitchBranchResult } from "@shared/api-types";
import type {
  ComposerCardBlocked,
  ComposerCardPane,
  ComposerCardProject,
  ComposerCheckout,
  ComposerWorkspaceCard,
} from "../chat-input/types";
import { branchSections, checkoutSections } from "../chat-input/workspace-card-rows";
import type { ProjectWorkspaceState } from "../session-sidebar/project-workspace";

interface BlockedSwitch {
  reason: "dirty" | "busy";
  branch: string;
  projectPath: string;
}

interface Listing {
  forFolder: string;
  result: WorktreeBranchesResult | null;
  loading: boolean;
}

interface ProjectFacts {
  isGit: boolean;
  branch: string | null;
}

export type FolderOutcome = { ok: boolean; error?: string };

export function useWorkspaceCard({
  workspace,
  open,
  projects,
  currentFolder,
  currentProject,
  isMissing,
  personalCwd,
  homeDir,
  onGoToFolder,
  onReturnToPersonalSpace,
  onSwitched,
}: {
  workspace: ProjectWorkspaceState;
  open: boolean;
  projects: string[] | null;
  currentFolder: string | null;
  currentProject: { name: string; path: string } | null;
  isMissing: (folder: string | null | undefined) => boolean;
  personalCwd: string | null;
  homeDir: string;
  onGoToFolder: (folder: string) => Promise<FolderOutcome>;
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
  const [browsed, setBrowsed] = useState<string | null>(anchorProject);
  const [openToken, setOpenToken] = useState(0);
  const [filter, setFilter] = useState("");
  const [blocked, setBlocked] = useState<BlockedSwitch | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [listing, setListing] = useState<Listing>({ forFolder: "", result: null, loading: false });
  const [facts, setFacts] = useState<Record<string, ProjectFacts>>({});
  const requestRef = useRef(0);
  const currentRoot = workspace.selectedProject ?? currentProject?.path ?? null;
  const queryFolder =
    browsed && currentRoot && worktreePathsEqual(browsed, currentRoot) ? (workspace.selectedCwd ?? browsed) : browsed;

  useEffect(() => {
    if (!open) return;
    setOpenToken((token) => token + 1);
    setBrowsed(currentProject?.path ?? currentFolder ?? null);
    setFilter("");
    setBlocked(null);
    setFailure(null);
  }, [open, currentProject?.path, currentFolder]);

  const loadBranches = useCallback((folder: string) => {
    const request = ++requestRef.current;
    setListing({ forFolder: folder, result: null, loading: true });
    void call("worktrees.branches", { cwd: folder }).then(
      (result) => {
        if (requestRef.current !== request) return;
        setListing({ forFolder: folder, result: result as WorktreeBranchesResult, loading: false });
      },
      () => {
        if (requestRef.current !== request) return;
        setListing({ forFolder: folder, result: null, loading: false });
      },
    );
  }, []);

  useEffect(() => {
    if (!open || !queryFolder || projects === null) return;
    loadBranches(queryFolder);
  }, [open, queryFolder, openToken, workspace.wtRefreshKey, loadBranches, projects]);

  useEffect(() => {
    if (!open || !projects) return;
    let cancelled = false;
    for (const folder of projects) {
      if (isMissing(folder)) continue;
      void call("git.branch", { path: folder }).then(
        (result) => {
          if (cancelled) return;
          setFacts((prev) => ({ ...prev, [folder]: { isGit: result.isGit, branch: result.branch ?? null } }));
        },
        () => {
          if (cancelled) return;
          setFacts((prev) => ({ ...prev, [folder]: { isGit: false, branch: null } }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [open, projects, isMissing, workspace.wtRefreshKey]);

  const pane: ComposerCardPane = useMemo(() => {
    if (projects === null) {
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
    if (!queryFolder) return { state: "loading" };
    if (listing.loading || listing.forFolder !== queryFolder || !listing.result) return { state: "loading" };
    if (!listing.result.isGit || !listing.result.isTopLevel) return { state: "not-repo" };
    const { sections, count } = branchSections({
      listing: listing.result,
      folder: queryFolder,
      blocked,
      filter,
      language,
      homeDir,
    });
    return { state: "ready", count, sections };
  }, [blocked, checkouts, filter, homeDir, language, listing, projects, queryFolder, workspace.selectedCwd]);

  const personalLabel = t("personalSpace", "Default space");
  const displayName = useCallback(
    (folder: string) => spaceDisplayName(folder, personalCwd, homeDir, personalLabel),
    [homeDir, personalCwd, personalLabel],
  );

  const projectRows: ComposerCardProject[] = useMemo(() => {
    const folders = projects ?? (currentProject ? [currentProject.path] : []);
    return folders.map((folder) => {
      const name =
        currentProject && worktreePathsEqual(currentProject.path, folder) ? currentProject.name : displayName(folder);
      const missing = isMissing(folder);
      const personal = isPersonalSpace(folder, personalCwd, homeDir);
      const fact = facts[folder];
      const isGit = Boolean(fact?.isGit);
      const current = Boolean(currentRoot && worktreePathsEqual(currentRoot, folder));
      return {
        path: folder,
        name,
        displayPath: folder,
        subline: missing
          ? t("missingFolder", "Folder not found")
          : personal
            ? t("defaultSpaceNote", "Not in any repository")
            : !fact
              ? ""
              : isGit
                ? (fact.branch ?? "")
                : t("notGitRepo", "Not a git repository"),
        sublineKind: isGit && !personal && !missing ? "branch" : "note",
        icon: missing ? "folder-missing" : personal ? "house" : current ? "folder-open" : "folder",
        current,
        browsed: Boolean(browsed && worktreePathsEqual(browsed, folder)),
        missing,
      };
    });
  }, [browsed, currentProject, currentRoot, displayName, facts, homeDir, isMissing, personalCwd, projects, t]);

  const browsedName = projectRows.find((project) => project.browsed)?.name ?? (browsed ? displayName(browsed) : "");
  const closeCard = workspace.resetWorktreeDropdownForOutsideClick;

  const goTo = useCallback(
    async (folder: string) => {
      const outcome = await onGoToFolder(folder);
      closeCard();
      if (!outcome.ok) setFailure(outcome.error ?? null);
      return outcome.ok;
    },
    [closeCard, onGoToFolder],
  );

  const activateProject = useCallback(
    (path: string) => {
      if (isMissing(path)) return;
      if (worktreePathsEqual(path, currentFolder ?? "")) {
        closeCard();
        return;
      }
      if (isPersonalSpace(path, personalCwd, homeDir)) {
        closeCard();
        onReturnToPersonalSpace();
        return;
      }
      void goTo(path);
    },
    [closeCard, currentFolder, goTo, homeDir, isMissing, onReturnToPersonalSpace, personalCwd],
  );

  const browseProject = useCallback(
    (path: string) => {
      if (isMissing(path)) return;
      setFilter("");
      setBlocked(null);
      setFailure(null);
      setBrowsed(path);
    },
    [isMissing],
  );

  const switchIn = useCallback(
    async (cwd: string, branch: string, other: boolean) => {
      setSwitching(true);
      setFailure(null);
      try {
        const result = (await call("worktrees.switchBranch", { cwd, branch })) as WorktreeSwitchBranchResult;
        if (result.ok) {
          onSwitched();
          if (other) await goTo(cwd);
          else closeCard();
          return;
        }
        if (result.reason === "occupied" && result.path) {
          await goTo(result.path);
          return;
        }
        if (result.reason === "stale") {
          loadBranches(cwd);
          return;
        }
        if (result.reason === "dirty" || result.reason === "busy") {
          setBlocked({ reason: result.reason, branch, projectPath: cwd });
        }
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error));
      } finally {
        setSwitching(false);
      }
    },
    [closeCard, goTo, loadBranches, onSwitched],
  );

  const activateBranch = useCallback(
    (key: string) => {
      if (pane.state !== "ready") return;
      const rows = [...pane.sections.current, ...pane.sections.folders, ...pane.sections.others];
      const row = rows.find((entry) => entry.key === key);
      if (!row || row.disabled) return;
      if (row.kind === "current" || row.kind === "folder" || row.kind === "detached") {
        if (!row.path) return;
        if (worktreePathsEqual(row.path, currentFolder ?? "")) {
          closeCard();
          return;
        }
        void goTo(row.path);
        return;
      }
      if (row.kind !== "local" || !browsed) return;
      const sameProject = Boolean(currentRoot && worktreePathsEqual(currentRoot, browsed));
      void switchIn(sameProject ? (workspace.selectedCwd ?? browsed) : browsed, row.name, !sameProject);
    },
    [browsed, closeCard, currentFolder, currentRoot, goTo, pane, switchIn, workspace.selectedCwd],
  );

  const blockedMessage: ComposerCardBlocked | null = useMemo(() => {
    if (!blocked) return null;
    const other = !worktreePathsEqual(blocked.projectPath, workspace.selectedCwd ?? "");
    const projectName =
      projectRows.find((project) => worktreePathsEqual(project.path, blocked.projectPath))?.name ?? browsedName;
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
  }, [blocked, browsedName, projectRows, t, workspace.selectedCwd]);

  const openBlockedInNewWorktree = useCallback(() => {
    if (!blocked) return;
    setFailure(null);
    void workspace.createWorktreeAt({ projectRoot: blocked.projectPath, branch: blocked.branch }).then((path) => {
      if (!path) return;
      setBlocked(null);
      closeCard();
    });
  }, [blocked, closeCard, workspace]);

  const createCheckout = useCallback(() => {
    if (!browsed) return;
    void workspace.createWorktreeAt({ projectRoot: browsed });
  }, [browsed, workspace]);

  return {
    projects: projectRows,
    pane,
    browsedName,
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
    removeCheckout: (path, force) => void workspace.handleRemoveWorktree(path, force, browsed ?? undefined),
    confirmRemovePath: workspace.wtConfirmRemove,
    cancelRemove: workspace.cancelWorktreeRemove,
    busy: workspace.wtBusy || switching,
    error: failure ?? workspace.wtError,
    activateProject,
    browseProject,
    activateBranch,
  };
}
