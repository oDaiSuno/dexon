import { useCallback, useMemo, type RefObject } from "react";
import { defaultSpaceFolder } from "@/lib/space-identity";
import type { SessionInfo } from "@/lib/types";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { useActiveEnvironment } from "@/lib/environment-registry";
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

  const environment = useActiveEnvironment();
  const isPrimary = environment.id === PRIMARY_ENVIRONMENT_ID;
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
    currentProject: isPrimary
      ? ((selectedSession
          ? (selectedSession.projectRoot ?? space.workspace.projectRootFor(selectedSession.cwd))
          : null) ??
        space.workspace.selectedProject ??
        coordination.attemptedCwd)
      : null,
    refreshKey,
    onCloseCurrent: space.handleReturnToPersonalSpace,
  });

  const projectPath = space.project?.path;
  const { projects: primaryProjects, isMissing: primaryMissing } = openProjects;
  const cardProjects = useMemo(
    () => (isPrimary ? primaryProjects : projectPath ? [projectPath] : []),
    [isPrimary, primaryProjects, projectPath],
  );
  const isMissing = useCallback(
    (folder: string | null | undefined) => isPrimary && primaryMissing(folder),
    [isPrimary, primaryMissing],
  );
  const card = useWorkspaceCard({
    workspace: space.workspace,
    open: space.workspace.wtDropdownOpen,
    projects: cardProjects,
    currentFolder: space.workspace.selectedCwd,
    currentProject: space.project ? { name: space.project.name, path: space.project.path } : null,
    isMissing,
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
