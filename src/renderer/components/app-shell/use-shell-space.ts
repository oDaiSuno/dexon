import { useEffect, useState, type RefObject } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { defaultSpaceFolder } from "@/lib/space-identity";
import type { ProjectSpaceRef } from "@shared/project-space-state";
import type { SessionInfo } from "@/lib/types";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { useActiveEnvironment, useEnvironments } from "@/lib/environment-registry";
import { useComposerWorkspace } from "./composer-workspace";
import { useProjectSpaces } from "./use-project-spaces";
import type { SpaceCoordination } from "./use-space-coordination";
import { useSpaceOwner } from "./use-space-owner";
import { useWorkspaceCard } from "./use-workspace-card";

export function useShellSpace(props: {
  refreshKey: number;
  coordination: SpaceCoordination;
  selectedSession: SessionInfo | null;
  spaceFrozenSessionId: string | null;
  chatInputRef: RefObject<{ takeDraft: () => string; prependText: (text: string) => void } | null>;
  onCwdCommitted: (cwd: string | null, projectRoot?: string | null) => void;
  location: ProjectSpaceRef | null;
  onBranchSwitched: () => void;
}) {
  const {
    refreshKey,
    coordination,
    selectedSession,
    spaceFrozenSessionId,
    chatInputRef,
    onCwdCommitted,
    location,
    onBranchSwitched,
  } = props;
  const spaceFrozen = selectedSession !== null && selectedSession.id === spaceFrozenSessionId;

  const environment = useActiveEnvironment();
  const environments = useEnvironments();
  const primary = environments.find((view) => view.id === PRIMARY_ENVIRONMENT_ID);
  const primaryGeneration = primary?.status.phase === "connected" ? primary.status.generation : null;
  const isPrimary = environment.id === PRIMARY_ENVIRONMENT_ID;
  const [localHomeDir, setLocalHomeDir] = useState("");
  useEffect(() => {
    let cancelled = false;
    void getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID)
      .getHome()
      .then(({ home }) => {
        if (!cancelled) setLocalHomeDir(home);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [primaryGeneration]);
  const space = useSpaceOwner({
    refreshKey,
    coordination,
    onCwdCommitted,
    location,
    spaceFrozen,
    sessionLocation: selectedSession
      ? {
          environmentId: selectedSession.environmentId,
          path: selectedSession.cwd,
          cwd: selectedSession.cwd,
          projectPath: selectedSession.projectRoot ?? selectedSession.cwd,
        }
      : null,
    draftCarrier: {
      enabled: selectedSession === null,
      take: () => chatInputRef.current?.takeDraft() ?? "",
      restore: (text) => chatInputRef.current?.prependText(text),
    },
  });

  const openProjects = useProjectSpaces({
    defaultSpace: coordination.personalCwd ?? defaultSpaceFolder(null, isPrimary ? space.homeDir : localHomeDir),
    currentProject: isPrimary
      ? ((selectedSession && !spaceFrozen
          ? (selectedSession.projectRoot ?? space.workspace.projectRootFor(selectedSession.cwd))
          : null) ??
        space.workspace.selectedProject ??
        coordination.attemptedCwd)
      : null,
    refreshKey,
    onCloseCurrent: space.handleReturnToPersonalSpace,
  });

  const { spaces, isMissing } = openProjects;
  const card = useWorkspaceCard({
    environmentId: environment.id,
    workspace: space.workspace,
    open: space.workspace.wtDropdownOpen,
    spaces,
    environments,
    currentFolder: space.workspace.selectedCwd,
    currentProject: space.project ? { name: space.project.name, path: space.project.path } : null,
    isMissing,
    personalCwd: coordination.personalCwd,
    homeDir: isPrimary ? space.homeDir : localHomeDir,
    onGoToFolder: space.goToFolder,
    onReturnToPersonalSpace: space.handleReturnToPersonalSpace,
    onSwitched: onBranchSwitched,
  });

  const composerWorkspace = useComposerWorkspace({
    environmentId: environment.id,
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
