import { useCallback, useState } from "react";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { copyText } from "@/lib/clipboard";
import { isPersonalSpace, spaceFolderName } from "@/lib/space-identity";
import { useSessionDirectory } from "../session-sidebar/session-directory";
import { useProjectWorkspace } from "../session-sidebar/project-workspace";
import type { ComposerWorkspace } from "../chat-input/types";
import type { SpaceCoordination } from "./use-space-coordination";
import type { RequestDeparture } from "./use-departure-guard";

/** Owns the current space's sessions and worktrees above both surfaces that use
 *  them: the sidebar (session list, project picker, worktree notices) and the
 *  composer footer's workspace trigger. */
export function useSpaceOwner({
  selectedSessionId,
  sessionCwd,
  newSessionCwd,
  refreshKey,
  onSessionDeleted,
  coordination,
  onCwdCommitted,
  onCoordinatorCwd,
  requestDeparture,
  onOpenSidebar,
}: {
  selectedSessionId: string | null;
  sessionCwd: string | null;
  newSessionCwd: string | null;
  refreshKey: number;
  onSessionDeleted: (sessionId: string) => void;
  coordination: SpaceCoordination;
  /** Commits a user-chosen cwd to session navigation. */
  onCwdCommitted: (cwd: string | null, projectRoot?: string | null) => void;
  /** Adopts a cwd this owner already pushed down, without user semantics. */
  onCoordinatorCwd: (cwd: string | null) => void;
  requestDeparture: RequestDeparture;
  onOpenSidebar: () => void;
}) {
  const { t } = useI18n();
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const directory = useSessionDirectory({ selectedSessionId, refreshKey, onSessionDeleted });
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
  const workspace = useProjectWorkspace({
    sessions: directory.sessions,
    selectedCwdProp: coordination.spaceCwd,
    onCwdChange: handleCwdChange,
    refreshKey,
    requestDeparture,
  });
  const handleReturnToPersonalSpace = useCallback(() => {
    void coordination.returnToPersonalSpace().then((cwd) => {
      if (cwd) onCwdCommitted(cwd, cwd);
    });
  }, [coordination, onCwdCommitted]);

  const closeWorktreeMenu = workspace.resetWorktreeDropdownForOutsideClick;
  const projectPath =
    workspace.worktreeState?.projectRoot ??
    workspace.selectedCwd ??
    coordination.spaceCwd ??
    sessionCwd ??
    newSessionCwd ??
    "";
  const openPicker = useCallback(() => {
    closeWorktreeMenu();
    onOpenSidebar();
    setSpacePickerOpen(true);
  }, [closeWorktreeMenu, onOpenSidebar]);

  const composerWorkspace: ComposerWorkspace | null = projectPath
    ? {
        workspace,
        project: {
          name: isPersonalSpace(projectPath, coordination.personalCwd, directory.homeDir)
            ? t("personalSpace", "Personal space")
            : spaceFolderName(projectPath),
          path: projectPath,
          displayPath: abbreviateHomePath(projectPath, directory.homeDir),
        },
        onSwitchProject: openPicker,
        onOpenInFinder: () => {
          closeWorktreeMenu();
          void window.piBridge?.openDirectory?.(projectPath);
        },
        onCopyPath: () => {
          closeWorktreeMenu();
          void copyText(projectPath).catch(() => undefined);
        },
        deferFocus: directory.deferFocus,
      }
    : null;

  return {
    directory,
    workspace,
    composerWorkspace,
    spacePickerOpen,
    setSpacePickerOpen,
    handleReturnToPersonalSpace,
  };
}

export type SpaceOwner = ReturnType<typeof useSpaceOwner>;
