import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PRIMARY_ENVIRONMENT_ID, parseQualifiedProjectKey } from "@contract/environment";
import { workspaceStore } from "@/lib/workspace-store";
import type { ProjectSpaceRef } from "@shared/project-space-state";
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
  location: ProjectSpaceRef | null;
  spaceFrozen: boolean;
  sessionLocation: (ProjectSpaceRef & { cwd: string; projectPath: string }) | null;
  draftCarrier: { enabled: boolean; take: () => string; restore: (text: string) => void };
}) {
  const { refreshKey, coordination, onCwdCommitted, location: workspaceLocation } = props;
  const { sessionLocation, draftCarrier, spaceFrozen } = props;
  const { t } = useI18n();
  const environment = useActiveEnvironment();
  const affordances = useActiveEnvironmentAffordances();
  const snapshot = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const focusedSpace = snapshot.focus.spaceKey ? parseQualifiedProjectKey(snapshot.focus.spaceKey) : null;
  const coordinatedCwd = environment.id === PRIMARY_ENVIRONMENT_ID ? coordination.spaceCwd : null;
  const frozenSpaceCwd =
    environment.id === PRIMARY_ENVIRONMENT_ID
      ? coordinatedCwd
      : (snapshot.spaces.find(
          (space) => space.key === snapshot.focus.spaceKey && space.environmentId === environment.id,
        )?.path ?? null);
  const activeSpaceCwd = spaceFrozen
    ? frozenSpaceCwd
    : workspaceLocation?.environmentId === environment.id
      ? workspaceLocation.path
      : focusedSpace?.path === coordinatedCwd || snapshot.focus.spaceKey === null
        ? coordinatedCwd
        : null;
  const generation = environment.status.phase === "connected" ? environment.status.generation : null;
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
  }, [environment.id, environment.descriptor?.platform.home, generation]);

  const draftCarry = useDraftCarry({
    enabled: draftCarrier.enabled,
    currentFolder: activeSpaceCwd,
    take: draftCarrier.take,
    restore: draftCarrier.restore,
  });

  const commitFolder = useCallback(
    (cwd: string | null, projectRoot?: string | null, origin?: "user" | "coordinator") => {
      if (origin === "coordinator") return;
      const rollback = draftCarry.carry(cwd);
      try {
        onCwdCommitted(cwd, projectRoot);
        coordination.noteExternalCwd(cwd);
      } catch (error) {
        rollback?.();
        throw error;
      }
    },
    [coordination, draftCarry, onCwdCommitted],
  );

  const sessionRoots = useSessionProjectRoots();
  const workspace = useProjectWorkspace({
    sessions: sessionRoots,
    selectedCwdProp: activeSpaceCwd,
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

  const location = useSessionLocation(sessionLocation?.environmentId ?? environment.id, sessionLocation?.cwd ?? null);
  const readOnlyBranch = location?.status === "ready" ? location.branch : null;
  const readOnlyWorktree = location?.status === "ready" ? location.isWorktree : false;
  const readOnlyPath = sessionLocation?.cwd ?? null;
  const readOnly = useMemo(
    () => (readOnlyPath ? { branch: readOnlyBranch, isWorktree: readOnlyWorktree, path: readOnlyPath } : null),
    [readOnlyBranch, readOnlyPath, readOnlyWorktree],
  );

  const goToFolder = useCallback(
    async (folder: string): Promise<FolderOutcome> => {
      const result = await workspace.openDirectory(folder, environment.id);
      if (result.status === "selected") return { ok: true };
      if (result.status === "invalid") return { ok: false, error: result.error };
      return { ok: false };
    },
    [workspace, environment.id],
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
