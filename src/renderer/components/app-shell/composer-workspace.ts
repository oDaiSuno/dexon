import { useMemo } from "react";
import { worktreePathsEqual } from "@shared/worktree-path";
import type { ComposerCheckout, ComposerProject, ComposerWorkspace, ComposerWorkspaceCard } from "../chat-input/types";
import { checkoutSections } from "../chat-input/workspace-card-rows";
import type { ProjectWorkspaceState } from "../session-sidebar/project-workspace";

export function useComposerWorkspace(props: {
  workspace: ProjectWorkspaceState;
  project: ComposerProject | null;
  onSwitchProject: () => void;
  onOpenInFinder: () => Promise<void>;
  onCopyPath: () => Promise<void>;
  card?: ComposerWorkspaceCard | null;
  readOnly?: { branch: string | null; isWorktree: boolean; path: string } | null;
}): ComposerWorkspace | null {
  const { workspace, project, onSwitchProject, onOpenInFinder, onCopyPath, card, readOnly } = props;
  const {
    showWorktreeSwitcher,
    worktreeState,
    selectedCwd,
    wtDropdownOpen,
    toggleWorktreeDropdown,
    resetWorktreeDropdownForOutsideClick,
    wtNewOpen,
    wtNewBranch,
    wtBusy,
    wtError,
    wtConfirmRemove,
  } = workspace;

  const checkouts: ComposerCheckout[] = useMemo(
    () => (showWorktreeSwitcher ? (worktreeState?.worktrees ?? []) : []),
    [showWorktreeSwitcher, worktreeState],
  );

  const fallbackCard = useMemo<ComposerWorkspaceCard | null>(() => {
    if (!project) return null;
    const sections = checkoutSections({ checkouts, selectedCwd, blocked: null });
    const count = sections.current.length + sections.folders.length + sections.others.length + sections.stale.length;
    return {
      projects: [
        {
          path: project.path,
          name: project.name,
          displayPath: project.displayPath,
          subline: "",
          sublineKind: "note",
          icon: "folder-open",
          current: true,
          browsed: true,
          missing: false,
        },
      ],
      pane: checkouts.length === 0 ? { state: "not-repo" } : { state: "ready", count, sections },
      browsedName: project.name,
      folder: project.path,
      showFilter: false,
      filter: "",
      setFilter: () => {},
      blocked: null,
      dismissBlocked: () => {},
      openBlockedInNewWorktree: () => {},
      newEntryOpen: wtNewOpen,
      newBranch: wtNewBranch,
      setNewBranch: workspace.setNewWorktreeBranch,
      openNewEntry: workspace.openNewWorktreeEntry,
      closeNewEntry: workspace.closeNewWorktreeEntry,
      createCheckout: workspace.handleCreateWorktree,
      removeCheckout: (path, force) => void workspace.handleRemoveWorktree(path, force),
      confirmRemovePath: wtConfirmRemove,
      cancelRemove: workspace.cancelWorktreeRemove,
      busy: wtBusy,
      error: wtError,
      activateProject: () => {
        resetWorktreeDropdownForOutsideClick();
        onSwitchProject();
      },
      browseProject: () => {},
      activateBranch: (key) => {
        const rows = [...sections.current, ...sections.folders];
        const row = rows.find((entry) => entry.key === key);
        if (row?.path) workspace.handleSelectWorktree(row.path);
      },
    };
  }, [
    checkouts,
    project,
    selectedCwd,
    wtNewOpen,
    wtNewBranch,
    wtBusy,
    wtError,
    wtConfirmRemove,
    resetWorktreeDropdownForOutsideClick,
    workspace,
    onSwitchProject,
  ]);

  return useMemo(() => {
    if (!project) return null;
    const current =
      checkouts.length === 0
        ? null
        : ((selectedCwd ? checkouts.find((entry) => worktreePathsEqual(entry.path, selectedCwd)) : undefined) ??
          checkouts.find((entry) => entry.isMain) ??
          null);
    const base = {
      project,
      menuOpen: wtDropdownOpen,
      toggleMenu: toggleWorktreeDropdown,
      closeMenu: resetWorktreeDropdownForOutsideClick,
      openInFinder: onOpenInFinder,
      copyPath: onCopyPath,
      error: wtError,
    };
    if (readOnly) {
      return {
        ...base,
        mode: "read-only" as const,
        branch: readOnly.branch,
        isWorktree: readOnly.isWorktree,
        path: readOnly.path,
      };
    }
    return {
      ...base,
      mode: "switchable" as const,
      branch: current?.branch ?? null,
      isWorktree: Boolean(
        worktreeState?.worktrees.some(
          (entry) => selectedCwd && worktreePathsEqual(entry.path, selectedCwd) && !entry.isMain,
        ),
      ),
      path: selectedCwd ?? worktreeState?.projectRoot ?? project.path,
      checkouts,
      current,
      currentPath: selectedCwd ?? worktreeState?.projectRoot ?? null,
      card: card ?? fallbackCard ?? EMPTY_CARD,
    };
  }, [
    project,
    checkouts,
    selectedCwd,
    worktreeState,
    wtDropdownOpen,
    toggleWorktreeDropdown,
    resetWorktreeDropdownForOutsideClick,
    wtError,
    onOpenInFinder,
    onCopyPath,
    card,
    fallbackCard,
    readOnly,
  ]);
}

const EMPTY_CARD: ComposerWorkspaceCard = {
  projects: [],
  pane: { state: "loading" },
  browsedName: "",
  folder: "",
  showFilter: false,
  filter: "",
  setFilter: () => {},
  blocked: null,
  dismissBlocked: () => {},
  openBlockedInNewWorktree: () => {},
  newEntryOpen: false,
  newBranch: "",
  setNewBranch: () => {},
  openNewEntry: () => {},
  closeNewEntry: () => {},
  createCheckout: () => {},
  removeCheckout: () => {},
  confirmRemovePath: null,
  cancelRemove: () => {},
  busy: false,
  error: null,
  activateProject: () => {},
  browseProject: () => {},
  activateBranch: () => {},
};
