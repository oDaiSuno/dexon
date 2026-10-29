import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { isPersonalSpace, spaceDisplayName, spaceFolderName } from "@/lib/space-identity";
import { createTemporarySessionId } from "@/lib/temporary-session-id";
import { subscribeModelSettingsRequest } from "@/lib/model-settings-request";
import { requestProjectSwitcher } from "@/lib/project-switcher-request";
import { sessionProjectKey } from "@/lib/session-list";
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
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const [enteredProject, setEnteredProject] = useState("");

  useEffect(() => {
    setMobileReady(true);
  }, []);

  const directory = useSessionDirectory({ selectedSessionId: shownSessionId, refreshKey, onSessionDeleted });
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
      const projectRoot = session.projectRoot ?? session.cwd;
      const readableOnly = openProjects.isMissing(projectRoot);
      if (session.cwd && !readableOnly) setSelectedCwd(session.cwd);
      onSelectSession(session, false, readableOnly);
    },
    [openProjects, setSelectedCwd, onSelectSession],
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
    void selectDirectoryFromPicker((folder) => openProjects.add(folder)).then(reportSpaceResult);
  }, [selectDirectoryFromPicker, openProjects, reportSpaceResult]);

  const openFolder = useCallback(
    (folder: string) =>
      void openDirectory(folder).then((result) => {
        if (result.status === "selected") openProjects.add(folder);
        reportSpaceResult(result);
      }),
    [openDirectory, openProjects, reportSpaceResult],
  );

  const inspectFolder = useCallback(async (typed: string) => {
    const result = await call("projects.inspectFolder", { path: typed });
    return result.ok && result.path ? result.path : null;
  }, []);

  useEffect(() => subscribeModelSettingsRequest(() => onOpenSettings("models")), [onOpenSettings]);

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
          page={page}
          settingsOpen={settingsOpen}
          spaceName={spaceName}
          spacePath={spacePath}
          sessions={sessions}
          currentProject={selectedProject ?? spacePath}
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
          selectedSessionId={shownSessionId}
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
