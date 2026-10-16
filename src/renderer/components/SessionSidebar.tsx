import { useCallback } from "react";
import type { SessionInfo } from "@/lib/types";
import { getRecentProjects } from "@/lib/session-list";
import { createTemporarySessionId } from "@/lib/temporary-session-id";
import { worktreePathsEqual } from "@shared/worktree-path";
import { useSessionDirectory } from "./session-sidebar/session-directory";
import { useProjectWorkspace } from "./session-sidebar/project-workspace";
import { SidebarHeader } from "./session-sidebar/sidebar-header";
import { ProjectPicker } from "./session-sidebar/project-picker";
import { WorktreeSwitcher } from "./session-sidebar/worktree-switcher";
import { WorktreeInactiveHint } from "./session-sidebar/worktree-inactive-hint";
import { SessionList } from "./session-sidebar/session-list";
import { useInitialSessionRestore } from "./session-sidebar/use-initial-session-restore";

// Phase 2 composition root: wires the session directory (data) and project
// workspace (space) owners into the existing sidebar presentation. The visible
// behavior is unchanged from the previous monolithic SessionSidebar.

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null, origin?: "user" | "coordinator") => void;
}

export function SessionSidebar({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  onInitialRestoreDone,
  refreshKey,
  onSessionDeleted,
  selectedCwd: selectedCwdProp,
  onCwdChange,
}: Props) {
  const directory = useSessionDirectory({ selectedSessionId, refreshKey, onSessionDeleted });
  const workspace = useProjectWorkspace({
    sessions: directory.sessions,
    selectedCwdProp,
    onCwdChange,
    refreshKey,
  });
  const {
    sessions,
    loading,
    error,
    runningSessionIds,
    unreadSessionIds,
    homeDir,
    sessionRefreshDone,
    refreshSessions,
    deferFocus,
  } = directory;
  const {
    selectedCwd,
    setSelectedCwd,
    worktreeState,
    selectedProject,
    showWorktreeSwitcher,
    inactiveWorktreeSelector,
    wtDropdownOpen,
    toggleWorktreeDropdown,
    resetWorktreeDropdownForOutsideClick,
    wtNewOpen,
    openNewWorktreeEntry,
    closeNewWorktreeEntry,
    wtNewBranch,
    setNewWorktreeBranch,
    wtBusy,
    wtError,
    wtConfirmRemove,
    cancelWorktreeRemove,
    handleCreateWorktree,
    handleRemoveWorktree,
    handleSelectWorktree,
  } = workspace;

  // Auto-select cwd and restore session from URL on first load
  const restoredRef = useInitialSessionRestore({
    sessions,
    initialSessionId,
    loading,
    error,
    setSelectedCwd,
    onSelectSession,
    onInitialRestoreDone,
  });

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback(
    (s: SessionInfo) => {
      if (s.cwd) setSelectedCwd(s.cwd);
      onSelectSession(s);
    },
    [setSelectedCwd, onSelectSession],
  );

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    onNewSession?.(createTemporarySessionId(), selectedCwd);
  }, [selectedCwd, onNewSession]);

  // Sessions of every worktree in the selected project are shown together.
  // Paths come from mixed sources (session files, git output) and may differ
  // in separators/casing on Windows, so compare with worktreePathsEqual.
  const projectSessions = selectedProject
    ? sessions.filter((s) => worktreePathsEqual(s.projectRoot ?? s.cwd, selectedProject))
    : sessions;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <SidebarHeader
          selectedCwd={selectedCwd}
          sessionRefreshDone={sessionRefreshDone}
          onRefresh={() => void refreshSessions(false)}
          onNewSession={handleNewSession}
        />

        <ProjectPicker
          selectedCwd={selectedCwd}
          selectedProject={selectedProject}
          homeDir={homeDir}
          recentProjects={getRecentProjects(sessions)}
          suppressPlaceholder={Boolean(initialSessionId) && !restoredRef.current}
          onSelectProject={setSelectedCwd}
          selectCustomCwd={workspace.selectCustomCwd}
          selectDefaultCwd={workspace.selectDefaultCwd}
          selectDirectoryFromPicker={workspace.selectDirectoryFromPicker}
          deferFocus={deferFocus}
        />

        {/* Worktree switcher — shown only for git projects at a checkout top
            level (repo subdirs keep their own project identity, so switching
            from them would jump projects). Rendered whenever the selected cwd
            belongs to the loaded project (not just when forCwd matches), so
            switching between worktrees of one project keeps the row mounted
            instead of flickering while data refetches: all worktrees of a
            project share the same list anyway. */}
        {showWorktreeSwitcher && worktreeState && (
          <WorktreeSwitcher
            worktreeState={worktreeState}
            selectedCwd={selectedCwd}
            homeDir={homeDir}
            dropdownOpen={wtDropdownOpen}
            onToggleDropdown={toggleWorktreeDropdown}
            onOutsideClickClose={resetWorktreeDropdownForOutsideClick}
            newOpen={wtNewOpen}
            onOpenNewEntry={openNewWorktreeEntry}
            onCloseNewEntry={closeNewWorktreeEntry}
            newBranch={wtNewBranch}
            onNewBranchChange={setNewWorktreeBranch}
            busy={wtBusy}
            error={wtError}
            confirmRemovePath={wtConfirmRemove}
            onCancelRemove={cancelWorktreeRemove}
            onCreateWorktree={handleCreateWorktree}
            onRemoveWorktree={handleRemoveWorktree}
            onSelectWorktree={handleSelectWorktree}
            deferFocus={deferFocus}
          />
        )}
        <WorktreeInactiveHint hint={inactiveWorktreeSelector} />
      </div>

      <SessionList
        projectSessions={projectSessions}
        loading={loading}
        error={error}
        selectedSessionId={selectedSessionId}
        runningSessionIds={runningSessionIds}
        unreadSessionIds={unreadSessionIds}
        homeDir={homeDir}
        onSelectSession={handleSelectSessionFromList}
        onRenamed={() => void refreshSessions()}
        onSessionDeleted={(id) => {
          onSessionDeleted?.(id);
          void refreshSessions();
        }}
      />
    </div>
  );
}
