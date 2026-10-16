import { useCallback, useEffect, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { getRecentProjects } from "@/lib/session-list";
import { abbreviateHomePath } from "@/lib/display-path";
import { isPersonalSpace, spaceFolderName } from "@/lib/space-identity";
import { createTemporarySessionId } from "@/lib/temporary-session-id";
import { worktreePathsEqual } from "@shared/worktree-path";
import { NavSidebar, type NavPage } from "../app-nav/nav-sidebar";
import { useSessionDirectory } from "../session-sidebar/session-directory";
import { useProjectWorkspace } from "../session-sidebar/project-workspace";
import { useInitialSessionRestore } from "../session-sidebar/use-initial-session-restore";
import { NavSpacePanel, type SpaceNotice } from "./nav-space-panel";
import type { SpaceCoordination } from "./use-space-coordination";

export function NavigationSidebar({
  isMobile,
  open,
  onToggle,
  onClose,
  page,
  onNavigate,
  onOpenSettings,
  coordination,
  onCwdChange,
  onReturnToPersonalSpace,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  onInitialRestoreDone,
  refreshKey,
  onSessionDeleted,
}: {
  isMobile: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  page: NavPage;
  onNavigate: (page: NavPage) => void;
  onOpenSettings: () => void;
  coordination: SpaceCoordination;
  onCwdChange: (cwd: string | null, projectRoot?: string | null, origin?: "user" | "coordinator") => void;
  onReturnToPersonalSpace: () => void;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession: (sessionId: string, cwd: string) => void;
  initialSessionId: string | null;
  onInitialRestoreDone: () => void;
  refreshKey: number;
  onSessionDeleted: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [mobileReady, setMobileReady] = useState(false);
  const [foldedSessionIds, setFoldedSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [spaceError, setSpaceError] = useState<string | null>(null);

  useEffect(() => {
    setMobileReady(true);
  }, []);

  const directory = useSessionDirectory({ selectedSessionId, refreshKey, onSessionDeleted });
  const workspace = useProjectWorkspace({
    sessions: directory.sessions,
    selectedCwdProp: coordination.spaceCwd,
    onCwdChange,
    refreshKey,
  });
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
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const handleToggle = useCallback(() => {
    if (expanded) {
      setPickerOpen(false);
      resetWorktreeDropdownForOutsideClick();
    }
    onToggle();
  }, [expanded, onToggle, resetWorktreeDropdownForOutsideClick]);

  const toggleFold = useCallback((sessionId: string) => {
    setFoldedSessionIds((current) => {
      const next = new Set(current);
      if (!next.delete(sessionId)) next.add(sessionId);
      return next;
    });
  }, []);

  const selectSession = useCallback(
    (session: SessionInfo) => {
      if (session.cwd) setSelectedCwd(session.cwd);
      onSelectSession(session);
    },
    [setSelectedCwd, onSelectSession],
  );

  const createSession = useCallback(() => {
    if (selectedCwd) onNewSession(createTemporarySessionId(), selectedCwd);
  }, [selectedCwd, onNewSession]);

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
      setPickerOpen(false);
      setSpaceError(null);
      setSelectedCwd(path);
    },
    [setSelectedCwd],
  );

  const backToPersonalSpace = useCallback(() => {
    setSpaceError(null);
    onReturnToPersonalSpace();
  }, [onReturnToPersonalSpace]);

  const spacePath = selectedCwd ?? coordination.attemptedCwd ?? "";
  const personal = (path: string) => isPersonalSpace(path, coordination.personalCwd, homeDir);
  const spaceName = spacePath && !personal(spacePath) ? spaceFolderName(spacePath) : undefined;

  const spaces = getRecentProjects(sessions)
    .filter((path) => !selectedProject || !worktreePathsEqual(path, selectedProject))
    .map((path) => ({
      path,
      name: personal(path) ? t("personalSpace", "Personal space") : spaceFolderName(path),
      detail: abbreviateHomePath(path, homeDir),
    }));

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

  const projectSessions = selectedProject
    ? sessions.filter((session) => worktreePathsEqual(session.projectRoot ?? session.cwd, selectedProject))
    : [];

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
          background: "rgba(0,0,0,0.4)",
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
          spaceName={spaceName}
          spacePath={spacePath}
          sessions={projectSessions}
          loading={directory.loading}
          error={directory.error}
          selectedSessionId={selectedSessionId}
          runningSessionIds={directory.runningSessionIds}
          unreadSessionIds={directory.unreadSessionIds}
          homeDir={homeDir}
          onToggleExpanded={handleToggle}
          onNavigate={onNavigate}
          onSelectSession={selectSession}
          onNewSession={createSession}
          onRefreshSessions={() => void refreshSessions(false)}
          onOpenSettings={onOpenSettings}
          onSessionDeleted={(id) => {
            onSessionDeleted(id);
            void refreshSessions();
          }}
          onOpenFolder={openFolder}
          onChooseFolder={chooseFolder}
          onSwitchSpace={() => setPickerOpen(true)}
          onBackToPersonalSpace={backToPersonalSpace}
          foldedSessionIds={foldedSessionIds}
          onToggleFold={toggleFold}
          spacePanel={
            <NavSpacePanel
              workspace={workspace}
              homeDir={homeDir}
              deferFocus={directory.deferFocus}
              notice={notice}
              pickerOpen={pickerOpen}
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
