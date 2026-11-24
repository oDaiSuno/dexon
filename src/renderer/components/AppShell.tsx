import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ChatWindow } from "./ChatWindow";
import { SettingsConfig, type SettingsTab } from "./SettingsConfig";
import { BrowserAuthorizationDialog } from "./browser/BrowserAuthorizationDialog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getFileName } from "@/lib/file-paths";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import { ReadingPositionRegistry } from "@/lib/reading-position-store";
import { ThinkingExpansionRegistry } from "@/lib/thinking-expansion-store";
import { SessionProfiler } from "./SessionProfiler";
import type { ChatInputHandle } from "./ChatInput";
import type { ChatAppearancePreferences } from "@shared/chat-appearance";
import { useWorkspaceNavigation } from "./app-shell/use-workspace-navigation";
import { useSpaceCoordination } from "./app-shell/use-space-coordination";
import { EXPLORER_TAB_ID, useRightPanelDock } from "./app-shell/use-right-panel-dock";
import { useBrowserAuthorization } from "./app-shell/use-browser-authorization";
import { useChannelSnapshot } from "./app-shell/use-channel-snapshot";
import { useSessionInfo } from "./app-shell/use-session-info";
import { TopBar } from "./app-shell/top-bar";
import { NavigationSidebar, useSidebarNavigation } from "./app-shell/navigation-sidebar";
import { useSettingsDialog } from "./app-shell/use-settings-dialog";
import { ChatPlaceholder } from "./app-shell/chat-placeholder";
import { RightPanelDock } from "./app-shell/right-panel-dock";
import { RightPanelToggle, useRightPanelToggleFocus } from "./app-shell/right-panel-toggle";
import { ResourcePage } from "./app-nav/resource-page";
import { RemotePage } from "./app-nav/remote-page";
import { useMissingFolderRecovery } from "./app-shell/use-missing-folder-recovery";
import { useShellSpace } from "./app-shell/use-shell-space";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { resolveWorkspaceLocation, workspaceStore } from "@/lib/workspace-store";
export function AppShell({
  chatAppearance,
  chatAppearanceSaving,
  onChatAppearanceChange,
}: {
  chatAppearance: ChatAppearancePreferences;
  chatAppearanceSaving: boolean;
  onChatAppearanceChange: (preferences: ChatAppearancePreferences) => Promise<void>;
}) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTopPanel, setActiveTopPanel] = useState<"session" | null>(null);
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const thinkingExpansionRegistryRef = useRef(new ThinkingExpansionRegistry());
  const processDetailsExpansionRegistryRef = useRef(new ThinkingExpansionRegistry());
  const readingPositionRegistryRef = useRef(new ReadingPositionRegistry());
  const collapseMobileSidebar = useCallback(() => setSidebarOpen(false), []);
  const openSidebarForSwitchSession = useCallback(() => setSidebarOpen(true), []);
  const {
    settingsOpen,
    settingsInitialTab,
    settingsEnvironmentId,
    settingsNavigationRequestId,
    openSettings,
    closeSettings,
  } = useSettingsDialog();
  const {
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
  } = useSidebarNavigation(
    useCallback(() => {
      setActiveTopPanel(null);
      if (isMobile) setSidebarOpen(false);
      closeSettings();
    }, [isMobile, closeSettings]),
  );
  const showChatPage = useCallback(() => {
    closeSettings();
    setRemoteOpen(false);
    setPage("chat");
  }, [closeSettings, setPage, setRemoteOpen]);
  const [authorizationSettingsSessionId, setAuthorizationSettingsSessionId] = useState<string | null>(null);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const dismissTopPanel = useCallback(() => setActiveTopPanel(null), []);
  const toggleTopPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => (cur === "session" ? null : "session"));
  }, [isMobile]);
  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);
  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile]);
  const navigation = useWorkspaceNavigation({
    isMobile,
    onMobileSidebarClose: collapseMobileSidebar,
    onTopPanelDismiss: dismissTopPanel,
    onSwitchSessionRequested: openSidebarForSwitchSession,
    onShowChat: showChatPage,
    onBeforeSessionDeleted: useCallback((sessionId: string) => {
      thinkingExpansionRegistryRef.current.delete(sessionId);
      processDetailsExpansionRegistryRef.current.delete(sessionId);
      readingPositionRegistryRef.current.delete(sessionId);
    }, []),
  });
  const {
    environmentId,
    workspaceSnapshot,
    selectedSession,
    spaceFrozenSessionId,
    newSessionCwd,
    location: navigationLocation,
    sessionKey,
    refreshKey,
    initialSessionId,
    initialSessionRestored,
    handleCwdChange,
    handleSelectSession,
    handleNewSession,
    handleSessionCreated,
    handleSessionForked,
    handleSessionDeleted,
    handleInitialRestoreDone,
    bumpSessionKey,
    bumpRefresh,
  } = navigation;
  const sessionSpaceCwd =
    selectedSession === null
      ? (newSessionCwd ?? null)
      : selectedSession.id === spaceFrozenSessionId
        ? null
        : selectedSession.cwd;
  const coordination = useSpaceCoordination({
    sessionIntent: initialSessionId,
    sessionResolved: initialSessionRestored,
    sessionFound: selectedSession !== null,
    sessionCwd: sessionSpaceCwd,
  });
  const handleOpenSettings = useCallback(
    (tab: SettingsTab = "general") => {
      setActiveTopPanel(null);
      if (isMobile) setSidebarOpen(false);
      openSettings(tab);
    },
    [isMobile, openSettings],
  );
  const openResources = useCallback(() => handleNavigate("resources"), [handleNavigate]);
  const openModelSettings = useCallback(() => {
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    openSettings("models");
  }, [isMobile, openSettings]);
  const composerNavigation = useMemo(
    () => ({ openResources, openRemote, openModelSettings }),
    [openResources, openRemote, openModelSettings],
  );
  const onResources = page === "resources";
  const remoteShown = onResources && remoteOpen && !settingsOpen;
  const mainCovered = settingsOpen || remoteShown;
  const mainSuspended = onResources || settingsOpen;
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const handleExplorerRefresh = useCallback(() => {
    bumpRefresh();
    setExplorerRefreshKey((k) => k + 1);
  }, [bumpRefresh]);
  const { space, openProjects, composerWorkspace } = useShellSpace({
    refreshKey,
    coordination,
    selectedSession,
    spaceFrozenSessionId,
    location: selectedSession === null && newSessionCwd ? { environmentId, path: newSessionCwd } : navigationLocation,
    chatInputRef,
    onCwdCommitted: handleCwdChange,
    onBranchSwitched: handleExplorerRefresh,
  });
  const folderRecovery = useMissingFolderRecovery({
    session: selectedSession,
    workspace: space.workspace,
    coordination,
    onNewSession: handleNewSession,
    onOpenSettings: () => handleOpenSettings("servers"),
  });
  const startupSpaceSyncedRef = useRef(false);
  useEffect(() => {
    if (startupSpaceSyncedRef.current || !workspaceSnapshot.loaded || coordination.spacePhase.phase !== "ready") return;
    startupSpaceSyncedRef.current = true;
    if (
      workspaceSnapshot.focus.environmentId === PRIMARY_ENVIRONMENT_ID &&
      workspaceSnapshot.focus.spaceKey === null &&
      workspaceSnapshot.focus.sessionId === null &&
      selectedSession === null
    ) {
      workspaceStore.openSpace({ environmentId: PRIMARY_ENVIRONMENT_ID, path: coordination.spacePhase.cwd });
    }
  }, [workspaceSnapshot.loaded, workspaceSnapshot.focus, coordination.spacePhase, selectedSession]);
  const location = resolveWorkspaceLocation(workspaceSnapshot, selectedSession, openProjects.spaces);
  const draftLocation =
    selectedSession === null && newSessionCwd
      ? { environmentId, path: newSessionCwd }
      : selectedSession === null
        ? location
        : null;
  const activeLocation = draftLocation ?? location;
  const settingsTarget =
    settingsEnvironmentId ?? activeLocation?.environmentId ?? workspaceSnapshot.focus.environmentId;
  const resourcesTarget =
    resourcesEnvironmentId ?? activeLocation?.environmentId ?? workspaceSnapshot.focus.environmentId;
  const resourcesCwd =
    activeLocation?.environmentId === resourcesTarget
      ? activeLocation.path
      : (workspaceSnapshot.spaces.find((space) => space.environmentId === resourcesTarget)?.path ?? "");
  const dock = useRightPanelDock({
    environmentId,
    isMobile,
    sidebarOpen,
    onCollapseSidebar: collapseMobileSidebar,
    suspended: mainSuspended,
  });
  const panelToggle = useRightPanelToggleFocus(dock.handleRightPanelToggle);
  const authorization = useBrowserAuthorization({
    onResolved: useCallback(() => setAuthorizationSettingsSessionId(null), []),
  });
  const channels = useChannelSnapshot();
  const info = useSessionInfo();
  const handleAgentEnd = handleExplorerRefresh;
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);
  const { dispatchFileTab, openRightPanel } = dock;
  const handleOpenFile = useCallback(
    (
      filePath: string,
      fileName: string,
      sourceSessionId?: string | null,
      sourceEnvironmentId: EnvironmentId = environmentId,
    ) => {
      dispatchFileTab({
        type: "open",
        tab: { id: `file:${filePath}`, label: fileName, filePath, sourceSessionId, environmentId: sourceEnvironmentId },
      });
      openRightPanel();
    },
    [dispatchFileTab, openRightPanel, environmentId],
  );

  const handleOpenLinkedFile = useCallback(
    (filePath: string, sourceEnvironmentId?: EnvironmentId) => {
      handleOpenFile(
        filePath,
        getFileName(filePath),
        selectedSession?.id ?? null,
        sourceEnvironmentId ?? selectedSession?.environmentId ?? environmentId,
      );
    },
    [handleOpenFile, selectedSession?.id, selectedSession?.environmentId, environmentId],
  );

  const effectiveNewSessionCwd = draftLocation?.path ?? null;
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const showPlaceholder = initialSessionRestored && !showChat;

  const explorerCwd = activeLocation?.path ?? null;
  const authorizationRequest = authorization.browserAuthorization;

  const previousExplorer = useRef({ environmentId, path: explorerCwd, isMobile });
  useEffect(() => {
    const before = previousExplorer.current;
    previousExplorer.current = { environmentId, path: explorerCwd, isMobile };
    if (explorerCwd && !isMobile && before.environmentId === environmentId) {
      if (before.path !== explorerCwd || before.isMobile !== isMobile)
        dispatchFileTab({ type: "select", tabId: EXPLORER_TAB_ID });
    }
  }, [environmentId, explorerCwd, isMobile, dispatchFileTab]);

  return (
    <>
      <div style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--fx-surface-main)" }}>
        <NavigationSidebar
          isMobile={isMobile}
          open={sidebarOpen}
          onToggle={handleSidebarToggle}
          onClose={collapseMobileSidebar}
          page={page}
          settingsOpen={settingsOpen}
          onNavigate={handleNavigate}
          onOpenSettings={handleOpenSettings}
          coordination={coordination}
          homeDir={space.homeDir}
          refreshKey={refreshKey}
          workspace={space.workspace}
          onReturnToPersonalSpace={space.handleReturnToPersonalSpace}
          openProjects={openProjects}
          shownSessionId={mainSuspended ? null : (selectedSession?.id ?? null)}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          initialSessionId={initialSessionId}
          onInitialRestoreDone={handleInitialRestoreDone}
          onSessionDeleted={handleSessionDeleted}
        />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
            position: "relative",
          }}
        >
          {remoteShown && (
            <RemotePage
              isMobile={isMobile}
              onOpenResources={() => setRemoteOpen(false)}
              onClose={showChatPage}
              onSnapshotChange={channels.setChannelSnapshot}
              currentSessionId={selectedSession?.id ?? null}
            />
          )}
          {settingsOpen && (
            <SettingsConfig
              environmentId={settingsTarget}
              cwd={activeLocation?.environmentId === settingsTarget ? activeLocation.path : null}
              sessionId={
                authorizationSettingsSessionId ??
                (selectedSession?.environmentId === settingsTarget ? selectedSession.id : null)
              }
              initialTab={settingsInitialTab}
              navigationRequestId={settingsNavigationRequestId}
              onClose={closeSettings}
              onModelsChanged={() => setModelsRefreshKey((key) => key + 1)}
              chatAppearance={chatAppearance}
              chatAppearanceSaving={chatAppearanceSaving}
              onChatAppearanceChange={onChatAppearanceChange}
            />
          )}
          <div
            hidden={mainCovered}
            aria-hidden={mainCovered ? true : undefined}
            inert={mainCovered ? true : undefined}
            style={{
              flex: 1,
              display: mainCovered ? "none" : "flex",
              flexDirection: "column",
              overflow: "hidden",
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <TopBar
              sidebarOpen={sidebarOpen}
              onToggleSidebar={handleSidebarToggle}
              showSidebarToggle={isMobile}
              isMobile={isMobile}
              selectedSession={onResources ? null : selectedSession}
              projectName={space.project?.name ?? null}
              activeTopPanel={activeTopPanel}
              onToggleTopPanel={toggleTopPanel}
              sessionStats={info.sessionStats}
              contextUsage={info.contextUsage}
              modelId={info.modelId}
              compaction={info.compaction}
              copyFeedback={info.sessionCopyFeedback}
              onCopyField={info.handleCopySessionField}
              trailing={
                !mainSuspended && !dock.rightPanelOpen ? (
                  <RightPanelToggle
                    placement="top-bar"
                    onToggle={() => panelToggle.toggleFrom("top-bar")}
                    focusRequested={panelToggle.focusTarget === "top-bar"}
                    onFocusHandled={panelToggle.clearFocusTarget}
                  />
                ) : null
              }
              showChat={showChat && !onResources}
            />

            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              {onResources && (
                <ResourcePage
                  environmentId={resourcesTarget}
                  onScopeChange={setResourcesEnvironmentId}
                  cwd={resourcesCwd}
                  sessionId={selectedSession?.environmentId === resourcesTarget ? selectedSession.id : null}
                  view={resourceView}
                  onViewChange={setResourceView}
                  activeTab={resourceTab}
                  onTabChange={setResourceTab}
                  onPluginsReloaded={bumpSessionKey}
                  channelSnapshot={channels.channelSnapshot}
                  onOpenRemote={openRemote}
                />
              )}
              {showChat ? (
                <SessionProfiler key={`${environmentId}:${sessionKey}`} id="ChatWindow">
                  <ChatWindow
                    visible={!mainSuspended}
                    environmentId={environmentId}
                    session={selectedSession}
                    sessionFolderMissing={
                      selectedSession !== null &&
                      openProjects.isMissing(selectedSession.cwd, selectedSession.environmentId)
                    }
                    missingFolderRecovery={folderRecovery.recovery}
                    readingPositions={readingPositionRegistryRef.current}
                    newSessionCwd={effectiveNewSessionCwd}
                    onAgentEnd={handleAgentEnd}
                    onSessionCreated={handleSessionCreated}
                    onSessionForked={handleSessionForked}
                    modelsRefreshKey={modelsRefreshKey}
                    chatInputRef={chatInputRef}
                    onSessionStatsChange={info.setSessionStats}
                    onSessionStatsPanelOpen={openSessionStatsPanel}
                    onContextUsageChange={info.setContextUsage}
                    onCompactionChange={info.setCompaction}
                    onModelIdChange={info.setModelId}
                    onOpenFile={handleOpenLinkedFile}
                    channelSnapshot={channels.channelSnapshot}
                    onChannelSnapshotChange={channels.setChannelSnapshot}
                    navigation={composerNavigation}
                    workspace={composerWorkspace}
                    thinkingExpansionStore={thinkingExpansionRegistryRef.current.get(
                      selectedSession?.id ?? `new:${effectiveNewSessionCwd ?? "untitled"}`,
                    )}
                    processDetailsExpansionStore={processDetailsExpansionRegistryRef.current.get(
                      selectedSession?.id ?? `new:${effectiveNewSessionCwd ?? "untitled"}`,
                    )}
                  />
                </SessionProfiler>
              ) : showPlaceholder && !onResources ? (
                <ChatPlaceholder cwd={explorerCwd} />
              ) : null}
            </div>
          </div>
        </div>

        <RightPanelDock
          activeFileTabId={dock.activeFileTabId}
          fileTabs={dock.fileTabs}
          dispatchFileTab={dock.dispatchFileTab}
          rightPanelOpen={dock.rightPanelOpen}
          rightPanelWidth={dock.rightPanelWidth}
          rightPanelBounds={dock.rightPanelBounds}
          rightPanelResizing={dock.rightPanelResizing}
          onResizeStart={dock.handleRightPanelResizeStart}
          onResizeKeyDown={dock.handleRightPanelResizeKeyDown}
          managedProcessCount={dock.managedProcessCount}
          onManagedProcessCountChange={dock.setManagedProcessCount}
          managedProcessAttention={dock.managedProcessAttention}
          selectedSessionId={selectedSession?.id ?? null}
          settingsOpen={settingsOpen}
          browserAuthorizationOpen={Boolean(authorization.browserAuthorization)}
          isMobile={isMobile}
          environmentId={environmentId}
          location={activeLocation}
          explorerRefreshKey={explorerRefreshKey}
          onRefreshExplorer={() => setExplorerRefreshKey((key) => key + 1)}
          onOpenFile={handleOpenFile}
          onAtMention={handleAtMention}
          personalCwd={coordination.personalCwd}
          homeDir={space.homeDir}
          headerAction={
            <RightPanelToggle
              placement="panel"
              onToggle={() => panelToggle.toggleFrom("panel")}
              focusRequested={panelToggle.focusTarget === "panel" && dock.rightPanelOpen}
              onFocusHandled={panelToggle.clearFocusTarget}
            />
          }
          suspended={mainSuspended}
        />
      </div>
      {folderRecovery.picker}
      {authorizationRequest && !settingsOpen && (
        <BrowserAuthorizationDialog
          request={authorizationRequest}
          sessionTitle={
            selectedSession?.id === authorizationRequest.sessionId
              ? getSessionDisplayTitle(selectedSession, 240)
              : authorizationRequest.sessionId
          }
          onRespond={authorization.respondToBrowserAuthorization}
          onManage={() => {
            setAuthorizationSettingsSessionId(authorizationRequest.sessionId);
            openSettings("browser");
          }}
        />
      )}
    </>
  );
}
