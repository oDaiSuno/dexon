import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PRIMARY_ENVIRONMENT_ID, qualifySessionKey, type EnvironmentId } from "@contract/environment";
import { projectKeyOf, type ProjectSpaceRef } from "@shared/project-space-state";
import { workspaceStore } from "@/lib/workspace-store";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { useActiveEnvironment, getActiveEnvironmentId, runEnvironmentCommand } from "@/lib/environment-registry";
import { ProjectReconnectContext } from "../app-nav/project-menu";
import { subscribeResourcesRequest } from "@/lib/settings-request";
import type { ResourceTab, ResourceView } from "../app-nav/resource-page";
import { useEnvironmentDirectories } from "../session-sidebar/use-environment-directories";
import {
  automationSpaceFolder,
  defaultSpaceFolder,
  isAutomationSpace,
  isPersonalSpace,
  spaceDisplayName,
  spaceFolderName,
} from "@/lib/space-identity";
import { automationProjectKey, automationProjectPath, useProjectSpaceExpansion } from "@/hooks/use-project-spaces";
import { useAutomationSidebarBadge } from "@/lib/automation-badge-store";
import { createTemporarySessionId } from "@/lib/temporary-session-id";
import { requestProjectSwitcher } from "@/lib/project-switcher-request";
import { copyText } from "@/lib/clipboard";
import { presentConnection } from "@/lib/connection-presentation";
import { buildProjectSpaceRows } from "../app-nav/project-space-rows";
import { NavSidebar, type NavPage } from "../app-nav/nav-sidebar";
import { useSoftwareUpdate } from "../settings/use-software-update";
import type { ProjectWorkspaceState, WorkspaceSelectResult } from "../session-sidebar/project-workspace";
import { useInitialSessionRestore } from "../session-sidebar/use-initial-session-restore";
import { RemoteFolderPickerDialog } from "../remote-folder-picker/remote-folder-picker-dialog";
import { NavSpacePanel, type SpaceNotice } from "./nav-space-panel";
import { useShownSessionReveal } from "./use-shown-session-reveal";
import type { SpaceCoordination } from "./use-space-coordination";
import type { ProjectSpaces } from "./use-project-spaces";
import type { SettingsTab } from "../SettingsConfig";

export function useSidebarNavigation(beforeNavigate: () => void) {
  const [page, setPage] = useState<NavPage>("chat");
  const [resourceTab, setResourceTab] = useState<ResourceTab>("plugins");
  const [resourceView, setResourceView] = useState<ResourceView>("overview");
  const [resourcesEnvironmentId, setResourcesEnvironmentId] = useState<EnvironmentId | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const handleNavigate = useCallback(
    (target: NavPage) => {
      beforeNavigate();
      setRemoteOpen(false);
      if (target === "resources" && page !== "resources") {
        setResourceView("overview");
        setResourcesEnvironmentId(null);
      }
      setPage(target);
    },
    [beforeNavigate, page],
  );
  useEffect(
    () =>
      subscribeResourcesRequest((request) => {
        handleNavigate("resources");
        setResourceView("overview");
        setResourcesEnvironmentId(request.environmentId ?? null);
      }),
    [handleNavigate],
  );
  const openRemote = useCallback(() => {
    beforeNavigate();
    setPage("resources");
    setRemoteOpen(true);
  }, [beforeNavigate]);
  return {
    page,
    setPage,
    resourceTab,
    setResourceTab,
    resourceView,
    setResourceView,
    resourcesEnvironmentId,
    setResourcesEnvironmentId,
    remoteOpen,
    setRemoteOpen,
    handleNavigate,
    openRemote,
  };
}

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
  const automationBadge = useAutomationSidebarBadge();
  const snapshot = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const activeEnvironment = useActiveEnvironment();
  const [mobileReady, setMobileReady] = useState(false);
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
    onSelectSession,
    onInitialRestoreDone,
  });
  const automationFolder = automationSpaceFolder(
    coordination.automationCwd,
    defaultSpaceFolder(coordination.personalCwd, homeDir),
  );
  const currentCwd = automationProjectPath(selectedCwd ?? "", automationFolder, activeEnvironment.id);
  const currentProject =
    currentCwd === automationFolder
      ? currentCwd
      : automationProjectPath(
          selectedProject ?? selectedCwd ?? coordination.attemptedCwd ?? "",
          automationFolder,
          activeEnvironment.id,
        );
  const focusedKey = automationProjectKey(snapshot.focus.spaceKey, automationFolder);
  const projectKey = currentProject
    ? projectKeyOf({ environmentId: activeEnvironment.id, path: currentProject })
    : null;
  const currentKey =
    currentCwd === automationFolder
      ? projectKey
      : ((openProjects.spaces.some((space) => space.key === focusedKey) ? focusedKey : null) ?? projectKey);
  const { expandedSessionIds, expandedProjects, revealRequest, toggleExpand, toggleProject, revealSession } =
    useProjectSpaceExpansion({ currentKey, automationCwd: automationFolder, directories });
  const expanded = isMobile || open;
  const hidden = isMobile && !open;
  const updatePhase = softwareUpdate.state?.phase;
  const updateAvailable = updatePhase === "available" || updatePhase === "downloading" || updatePhase === "downloaded";
  const openUpdate = useCallback(() => onOpenSettings("about"), [onOpenSettings]);
  const handleToggle = useCallback(() => {
    if (expanded) resetWorktreeDropdownForOutsideClick();
    onToggle();
  }, [expanded, onToggle, resetWorktreeDropdownForOutsideClick]);
  const shownDirectory = directories.find((item) => item.environment.id === activeEnvironment.id);
  const shownSession = shownDirectory?.sessions.find((session) => session.id === shownSessionId);
  useShownSessionReveal(
    shownSessionId ? qualifySessionKey(activeEnvironment.id, shownSessionId) : null,
    shownSession,
    shownDirectory?.sessions ?? [],
    revealSession,
  );
  const selectSession = useCallback(
    (session: SessionInfo) => {
      revealSession(session);
      const environmentId = session.environmentId;
      const root = session.projectRoot ?? session.cwd;
      const readableOnly = openProjects.isMissing(root, environmentId);
      onSelectSession(session, false, readableOnly);
    },
    [revealSession, openProjects, onSelectSession],
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
  const automation = (path: string) =>
    isAutomationSpace(automationProjectPath(path, automationFolder), automationFolder, homeDir);
  const projectName = (path: string) =>
    automation(path)
      ? t("autoNavSpaceName", "Automation space")
      : spaceDisplayName(path, coordination.personalCwd, homeDir, t("personalSpace", "Default space"));
  const rows = buildProjectSpaceRows({
    spaces: openProjects.spaces,
    directories,
    focus: { ...snapshot.focus, spaceKey: currentKey },
    missing: openProjects.missing,
    pinned: openProjects.pinned,
    automationCwd: automationFolder,
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
  const reconnectProjectServer = useCallback(
    async (environmentId: string) => {
      setSpaceError(null);
      try {
        await runEnvironmentCommand({ type: "connect", environmentId });
      } catch (error) {
        setSpaceError(t("remoteAttributionReconnectFailed", "Reconnect failed."));
        throw error;
      }
    },
    [t],
  );
  return (
    <ProjectReconnectContext.Provider value={reconnectProjectServer}>
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
          automationBadge={{ count: automationBadge.count, severity: automationBadge.severity }}
          spaceName={
            spacePath && !(activeEnvironment.id === PRIMARY_ENVIRONMENT_ID && personal(spacePath))
              ? activeEnvironment.id === PRIMARY_ENVIRONMENT_ID
                ? projectName(spacePath)
                : spaceFolderName(spacePath)
              : undefined
          }
          spacePath={spacePath}
          sessions={directory.sessions}
          projectRows={rows}
          selectedEnvironmentId={activeEnvironment.id}
          currentProject={currentProject}
          projectName={activeEnvironment.id === PRIMARY_ENVIRONMENT_ID ? projectName : spaceFolderName}
          isPinnedProject={(path) => personal(path) || automation(path)}
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
          expandedSessionIds={expandedSessionIds}
          onToggleExpand={toggleExpand}
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
    </ProjectReconnectContext.Provider>
  );
}
