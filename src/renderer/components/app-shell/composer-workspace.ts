import { useMemo } from "react";
import { worktreePathsEqual } from "@shared/worktree-path";
import type { ComposerCheckout, ComposerProject, ComposerWorkspace } from "../chat-input/types";
import type { ProjectWorkspaceState } from "../session-sidebar/project-workspace";

export function useComposerWorkspace({
  workspace,
  project,
  onSwitchProject,
  onOpenInFinder,
  onCopyPath,
}: {
  workspace: ProjectWorkspaceState;
  project: ComposerProject | null;
  onSwitchProject: () => void;
  onOpenInFinder: () => Promise<void>;
  onCopyPath: () => Promise<void>;
}): ComposerWorkspace | null {
  const {
    showWorktreeSwitcher,
    worktreeState,
    selectedCwd,
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
    handleRemoveWorktree,
    handleSelectWorktree,
  } = workspace;

  return useMemo(() => {
    if (!project) return null;
    const checkouts: ComposerCheckout[] = showWorktreeSwitcher ? (worktreeState?.worktrees ?? []) : [];
    const current =
      checkouts.length === 0
        ? null
        : ((selectedCwd ? checkouts.find((entry) => worktreePathsEqual(entry.path, selectedCwd)) : undefined) ??
          checkouts.find((entry) => entry.isMain) ??
          null);
    return {
      project,
      checkouts,
      current,
      currentPath: selectedCwd ?? worktreeState?.projectRoot ?? null,
      menuOpen: wtDropdownOpen,
      newEntryOpen: wtNewOpen,
      newBranch: wtNewBranch,
      busy: wtBusy,
      error: wtError,
      confirmRemovePath: wtConfirmRemove,
      toggleMenu: toggleWorktreeDropdown,
      closeMenu: resetWorktreeDropdownForOutsideClick,
      selectCheckout: handleSelectWorktree,
      openNewEntry: openNewWorktreeEntry,
      closeNewEntry: closeNewWorktreeEntry,
      setNewBranch: setNewWorktreeBranch,
      createCheckout: handleCreateWorktree,
      removeCheckout: (path, force) => void handleRemoveWorktree(path, force),
      cancelRemove: cancelWorktreeRemove,
      switchProject: onSwitchProject,
      openInFinder: onOpenInFinder,
      copyPath: onCopyPath,
    };
  }, [
    project,
    showWorktreeSwitcher,
    worktreeState,
    selectedCwd,
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
    handleRemoveWorktree,
    handleSelectWorktree,
    onSwitchProject,
    onOpenInFinder,
    onCopyPath,
  ]);
}
