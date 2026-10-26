import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { copyText } from "@/lib/clipboard";
import { spaceDisplayName } from "@/lib/space-identity";
import { useSessionProjectRoots } from "@/lib/session-catalog";
import { useProjectWorkspace } from "../session-sidebar/project-workspace";
import { useComposerWorkspace } from "./composer-workspace";
import type { SpaceCoordination } from "./use-space-coordination";

export function useSpaceOwner({
  refreshKey,
  coordination,
  onCwdCommitted,
  onCoordinatorCwd,
  onOpenSidebar,
}: {
  refreshKey: number;
  coordination: SpaceCoordination;
  onCwdCommitted: (cwd: string | null, projectRoot?: string | null) => void;
  onCoordinatorCwd: (cwd: string | null) => void;
  onOpenSidebar: () => void;
}) {
  const { t } = useI18n();
  const [homeDir, setHomeDir] = useState("");
  useEffect(() => {
    fetch("/api/home")
      .then((r) => r.json())
      .then((d: { home?: string }) => {
        if (d.home) setHomeDir(d.home);
      })
      .catch(() => {});
  }, []);

  const handleCwdChange = useCallback(
    (cwd: string | null, projectRoot?: string | null, origin?: "user" | "coordinator") => {
      if (origin === "coordinator") {
        onCoordinatorCwd(cwd);
        return;
      }
      onCwdCommitted(cwd, projectRoot);
      coordination.noteExternalCwd(cwd);
    },
    [onCwdCommitted, onCoordinatorCwd, coordination],
  );
  const sessionRoots = useSessionProjectRoots();
  const workspace = useProjectWorkspace({
    sessions: sessionRoots,
    selectedCwdProp: coordination.spaceCwd,
    onCwdChange: handleCwdChange,
    refreshKey,
  });
  const handleReturnToPersonalSpace = useCallback(() => {
    void coordination.returnToPersonalSpace().then((cwd) => {
      if (cwd) onCwdCommitted(cwd, cwd);
    });
  }, [coordination, onCwdCommitted]);

  const closeWorktreeMenu = workspace.resetWorktreeDropdownForOutsideClick;
  const projectPath = workspace.selectedProject;
  const personalLabel = t("personalSpace", "Personal space");
  const project = useMemo(
    () =>
      projectPath
        ? {
            path: projectPath,
            name: spaceDisplayName(projectPath, coordination.personalCwd, homeDir, personalLabel),
            displayPath: abbreviateHomePath(projectPath, homeDir),
          }
        : null,
    [projectPath, coordination.personalCwd, homeDir, personalLabel],
  );
  const openProjectTree = useCallback(() => {
    closeWorktreeMenu();
    onOpenSidebar();
  }, [closeWorktreeMenu, onOpenSidebar]);

  const copyPath = useCallback(() => (projectPath ? copyText(projectPath) : Promise.resolve()), [projectPath]);
  const composerWorkspace = useComposerWorkspace({
    workspace,
    project,
    onSwitchProject: openProjectTree,
    onOpenInFinder: coordination.openCurrentFolder,
    onCopyPath: copyPath,
  });

  return {
    homeDir,
    workspace,
    project,
    composerWorkspace,
    handleReturnToPersonalSpace,
  };
}
