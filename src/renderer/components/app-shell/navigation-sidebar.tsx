import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import {
  activateEnvironmentSession,
  connectRemoteEnvironment,
  disconnectRemoteEnvironment,
  getActiveEnvironmentId,
  removeRemoteEnvironment,
  setActiveEnvironmentId,
  useActiveEnvironment,
} from "@/lib/environment-registry";
import { useRemoteEnvironmentDirectories } from "../session-sidebar/use-remote-environment-directories";
import type { RemoteEnvironmentGroup } from "../app-nav/environment-section-list";
import { isPersonalSpace, spaceDisplayName, spaceFolderName } from "@/lib/space-identity";
import { createTemporarySessionId } from "@/lib/temporary-session-id";
import { requestProjectSwitcher } from "@/lib/project-switcher-request";
import { sessionAncestorIds } from "@/lib/session-tree";
import type { RevealRequest } from "../app-nav/nav-history";
import { sessionProjectKey, sessionProjectKeyOf } from "@/lib/session-list";
import { NavSidebar, type NavPage } from "../app-nav/nav-sidebar";
import { useSoftwareUpdate } from "../settings/use-software-update";
import type { ProjectWorkspaceState, WorkspaceSelectResult } from "../session-sidebar/project-workspace";
import { useSessionDirectory } from "../session-sidebar/session-directory";
import { useInitialSessionRestore } from "../session-sidebar/use-initial-session-restore";
import { NavSpacePanel, type SpaceNotice } from "./nav-space-panel";
import type { SpaceCoordination } from "./use-space-coordination";
import type { OpenProjects } from "./use-open-projects";
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
  openProjects: OpenProjects;
  shownSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, keepSpace?: boolean) => void;
  onNewSession: (sessionId: string, cwd: string) => void;
  initialSessionId: string | null;
  onInitialRestoreDone: () => void;
  onSessionDeleted: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const softwareUpdate = useSoftwareUpdate();
  const [mobileReady, setMobileReady] = useState(false);
  const [foldedSessionIds, setFoldedSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null);
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const [enteredProject, setEnteredProject] = useState("");

  useEffect(() => {
    setMobileReady(true);
  }, []);

  const activeEnvironment = useActiveEnvironment();
  const primarySelectedSessionId = activeEnvironment.id === PRIMARY_ENVIRONMENT_ID ? shownSessionId : null;
  const remoteDirectories = useRemoteEnvironmentDirectories(shownSessionId);
  const directory = useSessionDirectory({ selectedSessionId: primarySelectedSessionId, refreshKey, onSessionDeleted });
  const { sessions, refreshSessions } = directory;
  const {
    selectedCwd,
    setSelectedCwd,
    selectedProject,
    resetWorktreeDropdownForOutsideClick,
    selectDirectoryFromPicker,
    openDirectory,
  } = workspace;

  useInitialSessionRestore({
    sessions,
    initialSessionId,
    loading: directory.loading,
    error: directory.error,
    setSelectedCwd,
    onSelectSession,
    onInitialRestoreDone,
  });

  const currentProjectKey = sessionProjectKey(selectedProject ?? selectedCwd ?? coordination.attemptedCwd ?? "");
  if (enteredProject !== currentProjectKey) {
    setEnteredProject(currentProjectKey);
    if (currentProjectKey && expandedProjects.get(currentProjectKey) === false)
      setExpandedProjects(new Map(expandedProjects).set(currentProjectKey, true));
  }

  const expanded = isMobile || open;
  const hidden = isMobile && !open;
  const updatePhase = softwareUpdate.state?.phase;
  const updateAvailable = updatePhase === "available" || updatePhase === "downloading" || updatePhase === "downloaded";
  const openUpdate = useCallback(() => onOpenSettings("about"), [onOpenSettings]);

  const handleToggle = useCallback(() => {
    if (expanded) resetWorktreeDropdownForOutsideClick();
    onToggle();
  }, [expanded, onToggle, resetWorktreeDropdownForOutsideClick]);

  const toggleFold = useCallback((sessionId: string) => {
    setFoldedSessionIds((current) => {
      const next = new Set(current);
      if (!next.delete(sessionId)) next.add(sessionId);
      return next;
    });
  }, []);

  const toggleProject = useCallback((key: string, open: boolean) => {
    setExpandedProjects((current) => new Map(current).set(key, open));
  }, []);

  const selectSession = useCallback(
    (session: SessionInfo) => {
      const environmentId = session.environmentId ?? PRIMARY_ENVIRONMENT_ID;
      activateEnvironmentSession(session.id, environmentId);
      const key = sessionProjectKeyOf(session);
      if (key)
        setExpandedProjects((current) => (current.get(key) === true ? current : new Map(current).set(key, true)));
      const members =
        environmentId === PRIMARY_ENVIRONMENT_ID
          ? sessions
          : (remoteDirectories.find((directory) => directory.environment.id === environmentId)?.sessions ?? []);
      const ancestors = sessionAncestorIds(members, session.id);
      setFoldedSessionIds((current) => {
        if (!ancestors.some((id) => current.has(id))) return current;
        const next = new Set(current);
        for (const id of ancestors) next.delete(id);
        return next;
      });
      setRevealRequest((previous) => ({ seq: (previous?.seq ?? 0) + 1, sessionId: session.id }));
      const projectRoot = session.projectRoot ?? session.cwd;
      const readableOnly = environmentId === PRIMARY_ENVIRONMENT_ID && openProjects.isMissing(projectRoot);
      if (session.cwd && !readableOnly) setSelectedCwd(session.cwd);
      onSelectSession(session, false, readableOnly);
    },
    [sessions, remoteDirectories, openProjects, setSelectedCwd, onSelectSession],
  );

  const createSession = useCallback(() => {
    if (!selectedCwd) return;
    onNewSession(createTemporarySessionId(), selectedCwd);
  }, [selectedCwd, onNewSession]);

  const reportSpaceResult = useCallback((result: WorkspaceSelectResult) => {
    if (result.status === "invalid") setSpaceError(result.error);
    if (result.status === "selected") setSpaceError(null);
  }, []);

  const chooseFolder = useCallback(() => {
    const previous = getActiveEnvironmentId();
    setActiveEnvironmentId(PRIMARY_ENVIRONMENT_ID);
    void selectDirectoryFromPicker((folder) => openProjects.add(folder)).then((result) => {
      if (result.status !== "selected") setActiveEnvironmentId(previous);
      reportSpaceResult(result);
    });
  }, [selectDirectoryFromPicker, openProjects, reportSpaceResult]);

  const openFolder = useCallback(
    (folder: string) => {
      const previous = getActiveEnvironmentId();
      setActiveEnvironmentId(PRIMARY_ENVIRONMENT_ID);
      void openDirectory(folder).then((result) => {
        if (result.status === "selected") openProjects.add(folder);
        else setActiveEnvironmentId(previous);
        reportSpaceResult(result);
      });
    },
    [openDirectory, openProjects, reportSpaceResult],
  );

  const inspectFolder = useCallback(async (typed: string) => {
    const result = await getEnvironmentApiClient(PRIMARY_ENVIRONMENT_ID).call("projects.inspectFolder", {
      path: typed,
    });
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
    setActiveEnvironmentId(PRIMARY_ENVIRONMENT_ID);
    setSpaceError(null);
    onReturnToPersonalSpace();
  }, [onReturnToPersonalSpace]);

  const spacePath = selectedCwd ?? coordination.attemptedCwd ?? "";
  const personal = (path: string) => isPersonalSpace(path, coordination.personalCwd, homeDir);
  const spaceName = spacePath && !personal(spacePath) ? spaceFolderName(spacePath) : undefined;

  const projectName = (path: string) =>
    spaceDisplayName(path, coordination.personalCwd, homeDir, t("personalSpace", "Default space"));

  const listedProjects = openProjects.projects.map((root) => ({ root, missing: openProjects.isMissing(root) }));

  const phase = coordination.spacePhase;
  const notice: SpaceNotice | null =
    phase.phase === "unavailable"
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

  const remoteGroups: RemoteEnvironmentGroup[] = remoteDirectories.map((directory) => ({
    ...directory,
    selectedSessionId: activeEnvironment.id === directory.environment.id ? shownSessionId : null,
    homeDir: directory.environment.descriptor?.platform.home ?? "",
    onSelectSession: selectSession,
    onRenamed: () => void directory.refreshSessions(),
    onSessionDeleted: (id) => {
      if (getActiveEnvironmentId() === directory.environment.id) onSessionDeleted(id);
      void directory.refreshSessions();
    },
    onConnect: () => connectRemoteEnvironment(directory.environment.id),
    onDisconnect: () => disconnectRemoteEnvironment(directory.environment.id),
    onRemove: () => removeRemoteEnvironment(directory.environment.id),
  }));
  const pendingClass = mobileReady ? "" : " sidebar-mobile-pending";

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
          spaceName={spaceName}
          spacePath={spacePath}
          sessions={sessions}
          remoteGroups={remoteGroups}
          currentProject={activeEnvironment.id === PRIMARY_ENVIRONMENT_ID ? (selectedProject ?? spacePath) : ""}
          projectName={projectName}
          isPinnedProject={personal}
          listedProjects={listedProjects}
          expandedProjects={expandedProjects}
          onToggleProject={toggleProject}
          isDefaultProject={personal}
          canMoveProject={openProjects.canMove}
          onMoveProject={openProjects.move}
          onCloseProject={openProjects.close}
          onReorderProjects={openProjects.reorder}
          loading={directory.loading}
          error={directory.error}
          selectedSessionId={primarySelectedSessionId}
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
          onRefreshSessions={() => void refreshSessions(false)}
          onOpenSettings={() => onOpenSettings("general")}
          onOpenUpdate={openUpdate}
          updateAvailable={updateAvailable}
          onSessionDeleted={(id) => {
            onSessionDeleted(id);
            void refreshSessions();
          }}
          onChooseFolder={chooseFolder}
          onOpenFolder={openFolder}
          inspectFolder={inspectFolder}
          onBackToPersonalSpace={backToPersonalSpace}
          foldedSessionIds={foldedSessionIds}
          onToggleFold={toggleFold}
          spacePanel={<NavSpacePanel notice={notice} />}
        />
      </div>
    </>
  );
}
