import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { getRecentProjects } from "@/lib/session-list";
import { abbreviateHomePath } from "@/lib/display-path";
import { isPersonalSpace, spaceFolderName } from "@/lib/space-identity";
import { createTemporarySessionId } from "@/lib/temporary-session-id";
import { worktreePathsEqual } from "@shared/worktree-path";
import { NavSidebar, type NavPage } from "../app-nav/nav-sidebar";
import { useSoftwareUpdate } from "../settings/use-software-update";
import type { SpaceOwner } from "./use-space-owner";
import { useInitialSessionRestore } from "../session-sidebar/use-initial-session-restore";
import { NavSpacePanel, type SpaceNotice } from "./nav-space-panel";
import type { SpaceCoordination } from "./use-space-coordination";
import type { RequestDeparture } from "./use-departure-guard";
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
  directory,
  workspace,
  spacePickerOpen,
  onSpacePickerOpenChange,
  onReturnToPersonalSpace,
  shownSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  onInitialRestoreDone,
  onSessionDeleted,
  requestDeparture,
}: {
  requestDeparture: RequestDeparture;
  isMobile: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  page: NavPage;
  settingsOpen: boolean;
  onNavigate: (page: NavPage) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  coordination: SpaceCoordination;
  directory: SpaceOwner["directory"];
  workspace: SpaceOwner["workspace"];
  spacePickerOpen: boolean;
  onSpacePickerOpenChange: (open: boolean) => void;
  onReturnToPersonalSpace: () => void;
  shownSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession: (sessionId: string, cwd: string) => void;
  initialSessionId: string | null;
  onInitialRestoreDone: () => void;
  onSessionDeleted: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const softwareUpdate = useSoftwareUpdate();
  const [mobileReady, setMobileReady] = useState(false);
  const [foldedSessionIds, setFoldedSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [openProjects, setOpenProjects] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [spaceError, setSpaceError] = useState<string | null>(null);

  useEffect(() => {
    setMobileReady(true);
  }, []);

  const { sessions, homeDir, refreshSessions } = directory;
  const {
    selectedCwd,
    setSelectedCwd,
    selectedProject,
    resetWorktreeDropdownForOutsideClick,
    selectDirectoryFromPicker,
  } = workspace;
  const { openCurrentFolder } = coordination;

  useInitialSessionRestore({
    sessions,
    initialSessionId,
    loading: directory.loading,
    error: directory.error,
    setSelectedCwd,
    onSelectSession,
    onInitialRestoreDone,
  });

  const expanded = isMobile || open;
  const hidden = isMobile && !open;
  const closePicker = useCallback(() => onSpacePickerOpenChange(false), [onSpacePickerOpenChange]);
  const updatePhase = softwareUpdate.state?.phase;
  const updateAvailable = updatePhase === "available" || updatePhase === "downloading" || updatePhase === "downloaded";
  const openUpdate = useCallback(() => onOpenSettings("about"), [onOpenSettings]);

  const handleToggle = useCallback(() => {
    if (expanded) {
      onSpacePickerOpenChange(false);
      resetWorktreeDropdownForOutsideClick();
    }
    onToggle();
  }, [expanded, onToggle, onSpacePickerOpenChange, resetWorktreeDropdownForOutsideClick]);

  const toggleFold = useCallback((sessionId: string) => {
    setFoldedSessionIds((current) => {
      const next = new Set(current);
      if (!next.delete(sessionId)) next.add(sessionId);
      return next;
    });
  }, []);

  const toggleProject = useCallback((key: string, open: boolean) => {
    setOpenProjects((current) => new Map(current).set(key, open));
  }, []);

  const selectSession = useCallback(
    (session: SessionInfo) => {
      requestDeparture(() => {
        if (session.cwd) setSelectedCwd(session.cwd);
        onSelectSession(session);
      });
    },
    [requestDeparture, setSelectedCwd, onSelectSession],
  );

  const createSession = useCallback(() => {
    if (!selectedCwd) return;
    requestDeparture(() => onNewSession(createTemporarySessionId(), selectedCwd));
  }, [requestDeparture, selectedCwd, onNewSession]);

  const chooseFolder = useCallback(() => {
    void selectDirectoryFromPicker().then((result) => {
      if (result.status === "invalid") setSpaceError(result.error);
      if (result.status === "selected") setSpaceError(null);
    });
  }, [selectDirectoryFromPicker]);

  const openFolder = useCallback(() => {
    openCurrentFolder().catch((error: unknown) => {
      setSpaceError(error instanceof Error ? error.message : String(error));
    });
  }, [openCurrentFolder]);

  const selectSpace = useCallback(
    (path: string) => {
      onSpacePickerOpenChange(false);
      requestDeparture(() => {
        setSpaceError(null);
        setSelectedCwd(path);
      });
    },
    [requestDeparture, setSelectedCwd, onSpacePickerOpenChange],
  );

  const backToPersonalSpace = useCallback(() => {
    requestDeparture(() => {
      setSpaceError(null);
      onReturnToPersonalSpace();
    });
  }, [requestDeparture, onReturnToPersonalSpace]);

  const spacePath = selectedCwd ?? coordination.attemptedCwd ?? "";
  const personal = (path: string) => isPersonalSpace(path, coordination.personalCwd, homeDir);
  const spaceName = spacePath && !personal(spacePath) ? spaceFolderName(spacePath) : undefined;

  const projectName = (path: string) => (personal(path) ? t("personalSpace", "Personal space") : spaceFolderName(path));
  const spaces = getRecentProjects(sessions)
    .filter((path) => !selectedProject || !worktreePathsEqual(path, selectedProject))
    .map((path) => ({ path, name: projectName(path), detail: abbreviateHomePath(path, homeDir) }));

  const phase = coordination.spacePhase;
  const notice: SpaceNotice | null =
    phase.phase === "unavailable"
      ? {
          message:
            phase.attempted === "personal"
              ? t("personalSpaceUnavailable", "The personal space couldn't be prepared.")
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
          openProjects={openProjects}
          onToggleProject={toggleProject}
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
          onOpenFolder={openFolder}
          onChooseFolder={chooseFolder}
          onSwitchSpace={() => onSpacePickerOpenChange(true)}
          onBackToPersonalSpace={backToPersonalSpace}
          foldedSessionIds={foldedSessionIds}
          onToggleFold={toggleFold}
          spacePanel={
            <NavSpacePanel
              notice={notice}
              pickerOpen={spacePickerOpen}
              spaces={spaces}
              onSelectSpace={selectSpace}
              onClosePicker={closePicker}
            />
          }
        />
      </div>
    </>
  );
}
