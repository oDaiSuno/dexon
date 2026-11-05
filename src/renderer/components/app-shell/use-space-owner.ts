import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { copyText } from "@/lib/clipboard";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { useActiveEnvironment, useActiveEnvironmentAffordances } from "@/lib/environment-registry";
import { spaceDisplayName } from "@/lib/space-identity";
import { useSessionProjectRoots } from "@/lib/session-catalog";
import { useProjectWorkspace } from "../session-sidebar/project-workspace";
import { useDraftCarry } from "./use-draft-carry";
import { useSessionLocation } from "./use-session-location";
import type { SpaceCoordination } from "./use-space-coordination";
import type { FolderOutcome } from "./use-workspace-card";

export function useSpaceOwner(props: {
  refreshKey: number;
  coordination: SpaceCoordination;
  onCwdCommitted: (cwd: string | null, projectRoot?: string | null) => void;
  onCoordinatorCwd: (cwd: string | null) => void;
  sessionLocation: { cwd: string; projectPath: string } | null;
  draftCarrier: { enabled: boolean; take: () => string; restore: (text: string) => void };
}) {
  const { refreshKey, coordination, onCwdCommitted, onCoordinatorCwd } = props;
  const { sessionLocation, draftCarrier } = props;
  const { t } = useI18n();
  const environment = useActiveEnvironment();
  const affordances = useActiveEnvironmentAffordances();
  const [homeDir, setHomeDir] = useState("");
  useEffect(() => {
    let disposed = false;
    setHomeDir(environment.descriptor?.platform.home ?? "");
    void getEnvironmentApiClient(environment.id)
      .getHome()
      .then((d: { home?: string }) => {
        if (!disposed && d.home) setHomeDir(d.home);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [environment.id, environment.descriptor?.platform.home]);

  const draftCarry = useDraftCarry({
    enabled: draftCarrier.enabled,
    currentFolder: coordination.spaceCwd,
    take: draftCarrier.take,
    restore: draftCarrier.restore,
  });

  const commitFolder = useCallback(
    (cwd: string | null, projectRoot?: string | null, origin?: "user" | "coordinator") => {
      if (origin === "coordinator") {
        onCoordinatorCwd(cwd);
        return;
      }
      const rollback = draftCarry.carry(cwd);
      try {
        onCwdCommitted(cwd, projectRoot);
        coordination.noteExternalCwd(cwd);
      } catch (error) {
        rollback?.();
        throw error;
      }
    },
    [coordination, draftCarry, onCwdCommitted, onCoordinatorCwd],
  );

  const sessionRoots = useSessionProjectRoots();
  const workspace = useProjectWorkspace({
    sessions: sessionRoots,
    selectedCwdProp: coordination.spaceCwd,
    onCwdChange: commitFolder,
    refreshKey,
  });

  const handleReturnToPersonalSpace = useCallback(() => {
    void coordination.returnToPersonalSpace().then((cwd) => {
      if (cwd) commitFolder(cwd, cwd);
    });
  }, [coordination, commitFolder]);

  const spacePath = workspace.selectedProject;
  const personalLabel = t("personalSpace", "Default space");
  const composerProjectPath = sessionLocation?.projectPath ?? spacePath;
  const project = useMemo(
    () =>
      composerProjectPath
        ? {
            path: composerProjectPath,
            name: spaceDisplayName(composerProjectPath, coordination.personalCwd, homeDir, personalLabel),
            displayPath: abbreviateHomePath(composerProjectPath, homeDir),
          }
        : null,
    [composerProjectPath, coordination.personalCwd, homeDir, personalLabel],
  );

  const location = useSessionLocation(sessionLocation?.cwd ?? null);
  const readOnlyBranch = location?.branch ?? null;
  const readOnlyWorktree = location?.isWorktree ?? false;
  const readOnlyPath = sessionLocation?.cwd ?? null;
  const readOnly = useMemo(
    () => (readOnlyPath ? { branch: readOnlyBranch, isWorktree: readOnlyWorktree, path: readOnlyPath } : null),
    [readOnlyBranch, readOnlyPath, readOnlyWorktree],
  );

  const goToFolder = useCallback(
    async (folder: string): Promise<FolderOutcome> => {
      const result = await workspace.openDirectory(folder);
      if (result.status === "selected") return { ok: true };
      if (result.status === "invalid") return { ok: false, error: result.error };
      return { ok: false };
    },
    [workspace],
  );

  const openInFinder = useCallback(
    () =>
      affordances.revealInFileManager
        ? readOnly
          ? coordination.openFolder(readOnly.path)
          : coordination.openCurrentFolder()
        : Promise.resolve(),
    [coordination, readOnly, affordances.revealInFileManager],
  );
  const copyPath = useCallback(() => {
    const folder = readOnly ? readOnly.path : (workspace.selectedCwd ?? spacePath);
    return folder ? copyText(folder) : Promise.resolve();
  }, [readOnly, spacePath, workspace.selectedCwd]);

  return {
    homeDir,
    workspace,
    project,
    readOnly,
    goToFolder,
    openInFinder,
    copyPath,
    handleReturnToPersonalSpace,
  };
}
