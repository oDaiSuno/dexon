import type { RefObject } from "react";
import { defaultSpaceFolder } from "@/lib/space-identity";
import type { SessionInfo } from "@/lib/types";
import { useComposerWorkspace } from "./composer-workspace";
import { useOpenProjects } from "./use-open-projects";
import type { SpaceCoordination } from "./use-space-coordination";
import { useSpaceOwner } from "./use-space-owner";
import { useWorkspaceCard } from "./use-workspace-card";

export function useShellSpace(props: {
  refreshKey: number;
  coordination: SpaceCoordination;
  selectedSession: SessionInfo | null;
  chatInputRef: RefObject<{ takeDraft: () => string; prependText: (text: string) => void } | null>;
  onCwdCommitted: (cwd: string | null, projectRoot?: string | null) => void;
  onCoordinatorCwd: (cwd: string | null) => void;
  onBranchSwitched: () => void;
}) {
  const {
    refreshKey,
    coordination,
    selectedSession,
    chatInputRef,
    onCwdCommitted,
    onCoordinatorCwd,
    onBranchSwitched,
  } = props;

  const space = useSpaceOwner({
    refreshKey,
    coordination,
    onCwdCommitted,
    onCoordinatorCwd,
    sessionLocation: selectedSession
      ? { cwd: selectedSession.cwd, projectPath: selectedSession.projectRoot ?? selectedSession.cwd }
      : null,
    draftCarrier: {
      enabled: selectedSession === null,
      take: () => chatInputRef.current?.takeDraft() ?? "",
      restore: (text) => chatInputRef.current?.prependText(text),
    },
  });

  const openProjects = useOpenProjects({
    defaultSpace:
      coordination.personalCwd ??
      (coordination.spacePhase.phase === "idle" ||
      (coordination.spacePhase.phase === "preparing" && coordination.spacePhase.target === "personal")
        ? null
        : defaultSpaceFolder(null, space.homeDir)),
    currentProject:
      (selectedSession ? (selectedSession.projectRoot ?? space.workspace.projectRootFor(selectedSession.cwd)) : null) ??
      space.workspace.selectedProject ??
      coordination.attemptedCwd,
    refreshKey,
    onCloseCurrent: space.handleReturnToPersonalSpace,
  });

  const card = useWorkspaceCard({
    workspace: space.workspace,
    open: space.workspace.wtDropdownOpen,
    projects: openProjects.projects,
    currentFolder: space.workspace.selectedCwd,
    currentProject: space.project ? { name: space.project.name, path: space.project.path } : null,
    isMissing: openProjects.isMissing,
    personalCwd: coordination.personalCwd,
    homeDir: space.homeDir,
    onGoToFolder: space.goToFolder,
    onReturnToPersonalSpace: space.handleReturnToPersonalSpace,
    onSwitched: onBranchSwitched,
  });

  const composerWorkspace = useComposerWorkspace({
    workspace: space.workspace,
    project: space.project,
    onSwitchProject: space.workspace.resetWorktreeDropdownForOutsideClick,
    onOpenInFinder: space.openInFinder,
    onCopyPath: space.copyPath,
    card,
    readOnly: space.readOnly,
  });

  return { space, openProjects, composerWorkspace };
}
