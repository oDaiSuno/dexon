import { useEffect, useMemo, useState, type RefObject } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { automationSpaceFolder, defaultSpaceFolder } from "@/lib/space-identity";
import { automationProjectPath, useAutomationProjectSpaces } from "@/hooks/use-project-spaces";
import { useI18n } from "@/i18n";
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
  const { t } = useI18n();

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

  const personalFolder = defaultSpaceFolder(coordination.personalCwd, isPrimary ? space.homeDir : localHomeDir);
  const automationFolder = automationSpaceFolder(coordination.automationCwd, personalFolder);
  const currentCwd = automationProjectPath(space.workspace.selectedCwd ?? "", automationFolder, environment.id);
  const currentProject =
    currentCwd === automationFolder
      ? currentCwd
      : automationProjectPath(
          (selectedSession && !spaceFrozen
            ? (selectedSession.projectRoot ?? space.workspace.projectRootFor(selectedSession.cwd))
            : null) ??
            space.workspace.selectedProject ??
            coordination.attemptedCwd ??
            "",
          automationFolder,
          environment.id,
        );
  const projects = useProjectSpaces({
    defaultSpace: personalFolder,
    currentProject: isPrimary ? currentProject || null : null,
    refreshKey,
    onCloseCurrent: space.handleReturnToPersonalSpace,
  });
  const openProjects = useAutomationProjectSpaces({
    projects,
    automationCwd: coordination.automationCwd,
    personalCwd: coordination.personalCwd,
  });

  const { spaces, isMissing } = openProjects;
  const workspaceCard = useWorkspaceCard({
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

  const automationLabel = t("autoNavSpaceName", "Automation space");
  const card = useMemo(() => {
    const browsedAutomation =
      workspaceCard.browsedEnvironmentId === PRIMARY_ENVIRONMENT_ID &&
      automationProjectPath(workspaceCard.folder, automationFolder) === automationFolder;
    return {
      ...workspaceCard,
      projects: workspaceCard.projects.map((project) =>
        project.environmentId === PRIMARY_ENVIRONMENT_ID &&
        automationProjectPath(project.path, automationFolder) === automationFolder
          ? {
              ...project,
              name: automationLabel,
              current: isPrimary && currentProject === automationFolder,
              browsed: browsedAutomation,
            }
          : project,
      ),
      browsedName: browsedAutomation ? automationLabel : workspaceCard.browsedName,
    };
  }, [workspaceCard, automationFolder, automationLabel, isPrimary, currentProject]);
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
