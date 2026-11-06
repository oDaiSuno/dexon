import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PRIMARY_ENVIRONMENT_ID, qualifySessionKey } from "@contract/environment";
import { projectKeyOf, type ProjectSpaceRef } from "@shared/project-space-state";
import { workspaceStore } from "@/lib/workspace-store";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { useActiveEnvironment, getActiveEnvironmentId } from "@/lib/environment-registry";
import { useEnvironmentDirectories } from "../session-sidebar/use-environment-directories";
import { isPersonalSpace, spaceDisplayName, spaceFolderName } from "@/lib/space-identity";
import { createTemporarySessionId } from "@/lib/temporary-session-id";
import { requestProjectSwitcher } from "@/lib/project-switcher-request";
import { sessionAncestorIds } from "@/lib/session-tree";
import { copyText } from "@/lib/clipboard";
import { presentConnection } from "@/lib/connection-presentation";
import type { RevealRequest } from "../app-nav/nav-history";
import { buildProjectSpaceRows } from "../app-nav/project-space-rows";
import { NavSidebar, type NavPage } from "../app-nav/nav-sidebar";
import { useSoftwareUpdate } from "../settings/use-software-update";
import type { ProjectWorkspaceState, WorkspaceSelectResult } from "../session-sidebar/project-workspace";
import { useInitialSessionRestore } from "../session-sidebar/use-initial-session-restore";
import { RemoteFolderPickerDialog } from "../remote-folder-picker/remote-folder-picker-dialog";
import { NavSpacePanel, type SpaceNotice } from "./nav-space-panel";
import type { SpaceCoordination } from "./use-space-coordination";
import type { ProjectSpaces } from "./use-project-spaces";
import type { SettingsTab } from "../SettingsConfig";

export function NavigationSidebar({
  isMobile,
  open,
  onToggle,
  onClose,
  page,
  settingsOpen,
  onNavigate,
  onOpenSettings,
  coordination,
  homeDir,
  refreshKey,
  workspace,
  onReturnToPersonalSpace,
  openProjects,
  shownSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  onInitialRestoreDone,
  onSessionDeleted,
}: {
  isMobile: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  page: NavPage;
  settingsOpen: boolean;
  onNavigate: (page: NavPage) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  coordination: SpaceCoordination;
  homeDir: string;
  refreshKey: number;
  workspace: ProjectWorkspaceState;
  onReturnToPersonalSpace: () => void;
  openProjects: ProjectSpaces;
  shownSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, keepSpace?: boolean) => void;
  onNewSession: (sessionId: string, cwd: string) => void;
  initialSessionId: string | null;
  onInitialRestoreDone: () => void;
  onSessionDeleted: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const softwareUpdate = useSoftwareUpdate();
  const snapshot = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const activeEnvironment = useActiveEnvironment();
  const [mobileReady, setMobileReady] = useState(false);
  const [foldedSessionIds, setFoldedSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null);
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const pickerOrigin = useRef<string | null>(null);
  const directories = useEnvironmentDirectories({
    selectedSessionId: shownSessionId,
    refreshKey,
    onSessionDeleted: (id, environmentId) => {
      if (getActiveEnvironmentId() === environmentId) onSessionDeleted(id);
    },
  });
  const directory = directories.find((item) => item.environment.id === PRIMARY_ENVIRONMENT_ID)!;
  const {
    selectedCwd,
    setSelectedCwd,
    selectedProject,
    resetWorktreeDropdownForOutsideClick,
    selectDirectoryFromPicker,
    openDirectory,
  } = workspace;
  useEffect(() => setMobileReady(true), []);
  const restoreDirectory = directories.find((item) => item.sessions.some((session) => session.id === initialSessionId));
  useInitialSessionRestore({
    sessions: directories.flatMap((item) => item.sessions),
    initialSessionId,
    loading: restoreDirectory ? restoreDirectory.loading : directories.some((item) => item.loading),
    error: restoreDirectory ? restoreDirectory.error : directory.error,
    setSelectedCwd,
    onSelectSession,
    onInitialRestoreDone,
  });
  const currentProject = selectedProject ?? selectedCwd ?? coordination.attemptedCwd ?? "";
  const currentKey =
    (openProjects.spaces.some((space) => space.key === snapshot.focus.spaceKey) ? snapshot.focus.spaceKey : null) ??
    (currentProject ? projectKeyOf({ environmentId: activeEnvironment.id, path: currentProject }) : null);
  useEffect(() => {
    if (currentKey)
      setExpandedProjects((current) =>
        current.get(currentKey) === false ? new Map(current).set(currentKey, true) : current,
      );
  }, [currentKey]);
  const expanded = isMobile || open;
  const hidden = isMobile && !open;
  const updatePhase = softwareUpdate.state?.phase;
  const updateAvailable = updatePhase === "available" || updatePhase === "downloading" || updatePhase === "downloaded";
  const openUpdate = useCallback(() => onOpenSettings("about"), [onOpenSettings]);
  const handleToggle = useCallback(() => {
    if (expanded) resetWorktreeDropdownForOutsideClick();
    onToggle();
  }, [expanded, onToggle, resetWorktreeDropdownForOutsideClick]);
  const toggleFold = useCallback(
    (sessionId: string) =>
      setFoldedSessionIds((current) => {
        const next = new Set(current);
        if (!next.delete(sessionId)) next.add(sessionId);
        return next;
      }),
    [],
  );
  const toggleProject = useCallback(
    (key: string, nextOpen: boolean) => setExpandedProjects((current) => new Map(current).set(key, nextOpen)),
    [],
  );
  const selectSession = useCallback(
    (session: SessionInfo) => {
      const environmentId = session.environmentId ?? PRIMARY_ENVIRONMENT_ID;
      const root = session.projectRoot ?? session.cwd;
      if (root)
        setExpandedProjects((current) => new Map(current).set(projectKeyOf({ environmentId, path: root }), true));
      const members = directories.find((item) => item.environment.id === environmentId)?.sessions ?? [];
      const ancestors = sessionAncestorIds(members, session.id).map((id) => qualifySessionKey(environmentId, id));
      setFoldedSessionIds((current) => {
        if (!ancestors.some((id) => current.has(id))) return current;
        const next = new Set(current);
        for (const id of ancestors) next.delete(id);
        return next;
      });
      setRevealRequest((previous) => ({ seq: (previous?.seq ?? 0) + 1, sessionId: session.id, environmentId }));
      const readableOnly = openProjects.isMissing(root, environmentId);
      if (session.cwd && !readableOnly) setSelectedCwd(session.cwd);
      onSelectSession(session, false, readableOnly);
    },
    [directories, openProjects, setSelectedCwd, onSelectSession],
  );
  const createSession = useCallback(() => {
    if (
      !selectedCwd ||
      !presentConnection(activeEnvironment, Date.now()).canSend ||
      openProjects.isMissing(selectedProject ?? selectedCwd, activeEnvironment.id)
    )
      return;
    onNewSession(createTemporarySessionId(), selectedCwd);
  }, [selectedCwd, selectedProject, activeEnvironment, openProjects, onNewSession]);
  const reportSpaceResult = useCallback((result: WorkspaceSelectResult) => {
    if (result.status === "invalid") setSpaceError(result.error);
    if (result.status === "selected") setSpaceError(null);
  }, []);
  const chooseFolder = useCallback(() => {
    void selectDirectoryFromPicker((folder) => {
      openProjects.add(folder);
    }, PRIMARY_ENVIRONMENT_ID).then(reportSpaceResult);
  }, [selectDirectoryFromPicker, openProjects, reportSpaceResult]);
  const openProject = useCallback(
    (space: ProjectSpaceRef, startSession = false) => {
      void openDirectory(space.path, space.environmentId).then((result) => {
        reportSpaceResult(result);
        if (result.status !== "selected") return;
        openProjects.add(space.path, space.environmentId);
        if (startSession) onNewSession(createTemporarySessionId(), space.path);
      });
    },
    [openDirectory, openProjects, reportSpaceResult, onNewSession],
  );
  const openFolder = useCallback(
    (folder: string) => openProject({ environmentId: PRIMARY_ENVIRONMENT_ID, path: folder }),
    [openProject],
  );
  const inspectFolder = useCallback(async (typed: string) => {
    const result = await getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID).call("projects.browse", { path: typed });
    return result.ok && result.path ? result.path : null;
  }, []);
  useEffect(() => {
    const offToggle = window.piBridge?.onMenu?.("toggle-sidebar", handleToggle);
    const offSwitcher = window.piBridge?.onMenu?.("open-project-switcher", () => {
      if (!open) onToggle();
      requestProjectSwitcher();
    });
    const offAdd = window.piBridge?.onMenu?.("add-project", chooseFolder);
    return () => {
      offToggle?.();
      offSwitcher?.();
      offAdd?.();
    };
  }, [handleToggle, open, onToggle, chooseFolder]);
  const backToPersonalSpace = useCallback(() => {
    workspaceStore.openSpace({ environmentId: PRIMARY_ENVIRONMENT_ID, path: coordination.personalCwd ?? "/" });
    setSpaceError(null);
    onReturnToPersonalSpace();
  }, [onReturnToPersonalSpace, coordination.personalCwd]);
  const chooseRemoteFolder = useCallback(() => {
    pickerOrigin.current = workspaceStore.getSnapshot().focus.spaceKey;
    setRemotePickerOpen(true);
  }, []);
  const closeRemotePicker = useCallback(() => {
    setRemotePickerOpen(false);
    const focus = workspaceStore.getSnapshot().focus;
    if (focus.sessionId || focus.spaceKey === pickerOrigin.current) return;
    const mounted = workspaceStore.getSnapshot().spaces.find((space) => space.key === focus.spaceKey);
    if (mounted) openProject(mounted);
  }, [openProject]);
  const serverSettings = useCallback(() => {
    setRemotePickerOpen(false);
    onOpenSettings("servers");
  }, [onOpenSettings]);
  const spacePath = selectedCwd ?? coordination.attemptedCwd ?? "";
  const personal = (path: string) => isPersonalSpace(path, coordination.personalCwd, homeDir);
  const projectName = (path: string) =>
    spaceDisplayName(path, coordination.personalCwd, homeDir, t("personalSpace", "Default space"));
  const rows = buildProjectSpaceRows({
    spaces: openProjects.spaces,
    directories,
    focus: { ...snapshot.focus, spaceKey: currentKey },
    missing: openProjects.missing,
    pinned: openProjects.pinned,
    now: Date.now(),
    projectName: (space) =>
      space.key === openProjects.pinned
        ? t("personalSpace", "Default space")
        : space.environmentId === PRIMARY_ENVIRONMENT_ID
          ? projectName(space.path)
          : spaceFolderName(space.path),
  });
  const phase = coordination.spacePhase;
  const notice: SpaceNotice | null =
    activeEnvironment.id === PRIMARY_ENVIRONMENT_ID && phase.phase === "unavailable"
      ? {
          message:
            phase.attempted === "personal"
              ? t("personalSpaceUnavailable", "The default space couldn't be prepared.")
              : t("spaceUnavailable", "This space can't be opened."),
          reason: phase.reason,
          onRetry: coordination.retry,
        }
      : spaceError
        ? { message: spaceError }
        : null;
  const pendingClass = mobileReady ? "" : " sidebar-mobile-pending";
  const refreshEnvironment = (environmentId: string) => {
    void directories.find((item) => item.environment.id === environmentId)?.refreshSessions();
  };
  return (
    <>
      <div
        className={`sidebar-overlay-backdrop${pendingClass}`}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "var(--fx-surface-scrim)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />
      <div
        className={`sidebar-container${open ? " sidebar-open" : " sidebar-closed"}${pendingClass}`}
        aria-hidden={hidden ? true : undefined}
        inert={hidden ? true : undefined}
        style={{ display: "flex", flexDirection: "column", flexShrink: 0, zIndex: 200 }}
      >
        <NavSidebar
          expanded={expanded}
          visible={!hidden}
          page={page}
          settingsOpen={settingsOpen}
          spaceName={
            spacePath && !(activeEnvironment.id === PRIMARY_ENVIRONMENT_ID && personal(spacePath))
              ? spaceFolderName(spacePath)
              : undefined
          }
          spacePath={spacePath}
          sessions={directory.sessions}
          projectRows={rows}
          selectedEnvironmentId={activeEnvironment.id}
          currentProject={currentProject}
          projectName={activeEnvironment.id === PRIMARY_ENVIRONMENT_ID ? projectName : spaceFolderName}
          isPinnedProject={personal}
          expandedProjects={expandedProjects}
          onToggleProject={toggleProject}
          canMoveProject={openProjects.canMove}
          onMoveProject={openProjects.move}
          onCloseProject={openProjects.close}
          onReorderProjects={openProjects.reorder}
          loading={directory.loading}
          error={directory.error}
          selectedSessionId={shownSessionId}
          revealRequest={revealRequest}
          activity={directory.activity}
          liveStatuses={directory.liveStatuses}
          runningSessionIds={directory.runningSessionIds}
          unreadSessionIds={directory.unreadSessionIds}
          homeDir={homeDir}
          onToggleExpanded={handleToggle}
          onNavigate={onNavigate}
          onSelectSession={selectSession}
          onNewSession={createSession}
          onRefreshSessions={() => refreshEnvironment(PRIMARY_ENVIRONMENT_ID)}
          onOpenSettings={() => onOpenSettings("general")}
          onOpenUpdate={openUpdate}
          updateAvailable={updateAvailable}
          onSessionDeleted={onSessionDeleted}
          onEnvironmentRefresh={refreshEnvironment}
          onEnvironmentSessionDeleted={(environmentId, id) => {
            if (getActiveEnvironmentId() === environmentId) onSessionDeleted(id);
            refreshEnvironment(environmentId);
          }}
          onChooseFolder={chooseFolder}
          onChooseRemoteFolder={chooseRemoteFolder}
          onOpenServerSettings={serverSettings}
          onlineServerCount={
            directories.filter(
              (item) => item.environment.id !== PRIMARY_ENVIRONMENT_ID && item.environment.status.phase === "connected",
            ).length
          }
          onOpenFolder={openFolder}
          onOpenProject={openProject}
          onNewProjectSession={(space) => openProject(space, true)}
          onCopyProjectPath={(space) => {
            void copyText(space.path);
          }}
          onRevealProject={(space) => {
            if (space.environmentId === PRIMARY_ENVIRONMENT_ID) void window.piBridge?.openDirectory(space.path);
          }}
          inspectFolder={inspectFolder}
          onBackToPersonalSpace={backToPersonalSpace}
          foldedSessionIds={foldedSessionIds}
          onToggleFold={toggleFold}
          spacePanel={<NavSpacePanel notice={notice} />}
        />
      </div>
      {remotePickerOpen && (
        <RemoteFolderPickerDialog
          initialEnvironmentId={activeEnvironment.id}
          onClose={closeRemotePicker}
          onOpenSettings={serverSettings}
        />
      )}
    </>
  );
}
