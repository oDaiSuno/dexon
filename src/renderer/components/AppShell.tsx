import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ChatWindow } from "./ChatWindow";
import { SettingsConfig, type SettingsTab } from "./SettingsConfig";
import { BrowserAuthorizationDialog } from "./browser/BrowserAuthorizationDialog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLinkedFileOpener } from "./app-shell/use-linked-file-opener";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import { ReadingPositionRegistry } from "@/lib/reading-position-store";
import { ThinkingExpansionRegistry } from "@/lib/thinking-expansion-store";
import { SessionProfiler } from "./SessionProfiler";
import type { ChatInputHandle } from "./ChatInput";
import type { ChatAppearancePreferences } from "@shared/chat-appearance";
import { useAutomationNavigation, useWorkspaceNavigation } from "./app-shell/use-workspace-navigation";
import { useSpaceCoordination, useStartupSpaceSync } from "./app-shell/use-space-coordination";
import { useAutomationProjectSpaces } from "@/hooks/use-project-spaces";
import { AutomationPage } from "@/components/automation/AutomationPage";
import { clearAutomationSessionIntent } from "@/lib/automation-session-intent";
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
import type { EnvironmentId } from "@contract/environment";
import { resolveWorkspaceLocation } from "@/lib/workspace-store";
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
  const settings = useSettingsDialog();
  const { settingsOpen, openSettings, closeSettings } = settings;
  const sidebar = useSidebarNavigation(
    useCallback(() => {
      clearAutomationSessionIntent();
      setActiveTopPanel(null);
      if (isMobile) setSidebarOpen(false);
      closeSettings();
    }, [isMobile, closeSettings]),
  );
  const { page, setPage, setRemoteOpen, handleNavigate, openRemote } = sidebar;
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
  const { environmentId, workspaceSnapshot, selectedSession, spaceFrozenSessionId, newSessionCwd, refreshKey } =
    navigation;
  const sessionSpaceCwd = selectedSession?.id === spaceFrozenSessionId ? null : (selectedSession?.cwd ?? newSessionCwd);
  const coordination = useSpaceCoordination({
    sessionIntent: navigation.initialSessionId,
    sessionResolved: navigation.initialSessionRestored,
    sessionFound: selectedSession !== null,
    sessionCwd: sessionSpaceCwd,
  });
  const handleOpenSettings = useCallback(
    (tab: SettingsTab = "general") => {
      clearAutomationSessionIntent();
      setActiveTopPanel(null);
      if (isMobile) setSidebarOpen(false);
      openSettings(tab);
    },
    [isMobile, openSettings],
  );
  const openResources = useCallback(() => handleNavigate("resources"), [handleNavigate]);
  const openModelSettings = useCallback(() => handleOpenSettings("models"), [handleOpenSettings]);
  const composerNavigation = useMemo(
    () => ({ openResources, openRemote, openModelSettings }),
    [openResources, openRemote, openModelSettings],
  );
  const onResources = page === "resources";
  const remoteShown = onResources && sidebar.remoteOpen && !settingsOpen;
  const automationShown = page === "automation" && !settingsOpen;
  const mainCovered = settingsOpen || remoteShown || automationShown;
  const mainSuspended = page !== "chat" || settingsOpen;
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const { bumpRefresh } = navigation;
  const handleExplorerRefresh = useCallback(() => {
    bumpRefresh();
    setExplorerRefreshKey((k) => k + 1);
  }, [bumpRefresh]);
  const newSessionLocation = !selectedSession && newSessionCwd ? { environmentId, path: newSessionCwd } : null;
  const {
    space,
    openProjects: projects,
    composerWorkspace,
  } = useShellSpace({
    refreshKey,
    coordination,
    selectedSession,
    spaceFrozenSessionId,
    location: newSessionLocation ?? navigation.location,
    chatInputRef,
    onCwdCommitted: navigation.handleCwdChange,
    onBranchSwitched: handleExplorerRefresh,
  });
  const openProjects = useAutomationProjectSpaces({
    projects,
    automationCwd: coordination.automationCwd,
    personalCwd: coordination.personalCwd,
  });
  const { automationTarget, consumeAutomationTarget, overviewResetKey, handleSidebarNavigate, handleCloseAutomation } =
    useAutomationNavigation({
      page,
      settingsOpen,
      automationCwd: coordination.automationCwd,
      prepareAutomationSpace: coordination.prepareAutomationSpace,
      onNavigate: handleNavigate,
      onShowChat: showChatPage,
      onNewSession: navigation.handleNewSession,
      onOpenSession: navigation.openSessionById,
    });
  const folderRecovery = useMissingFolderRecovery({
    session: selectedSession,
    workspace: space.workspace,
    coordination,
    onNewSession: navigation.handleNewSession,
    onOpenSettings: () => handleOpenSettings("servers"),
  });
  useStartupSpaceSync(workspaceSnapshot, coordination.spacePhase, selectedSession !== null);
  const location = resolveWorkspaceLocation(workspaceSnapshot, selectedSession, openProjects.spaces);
  const draftLocation = selectedSession === null ? (newSessionLocation ?? location) : null;
  const activeLocation = draftLocation ?? location;
  const settingsTarget =
    settings.settingsEnvironmentId ?? activeLocation?.environmentId ?? workspaceSnapshot.focus.environmentId;
  const resourcesTarget =
    sidebar.resourcesEnvironmentId ?? activeLocation?.environmentId ?? workspaceSnapshot.focus.environmentId;
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

  const handleOpenLinkedFile = useLinkedFileOpener({
    environmentId,
    selectedSession,
    resourceLocation: onResources ? { environmentId: resourcesTarget, path: resourcesCwd } : null,
    onShowChat: showChatPage,
    onOpenFile: handleOpenFile,
  });
  const effectiveNewSessionCwd = draftLocation?.path ?? null;
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const showPlaceholder = navigation.initialSessionRestored && !showChat;
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
          onNavigate={handleSidebarNavigate}
          onOpenSettings={handleOpenSettings}
          coordination={coordination}
          homeDir={space.homeDir}
          refreshKey={refreshKey}
          workspace={space.workspace}
          onReturnToPersonalSpace={space.handleReturnToPersonalSpace}
          openProjects={openProjects}
          shownSessionId={mainSuspended ? null : (selectedSession?.id ?? null)}
          onSelectSession={navigation.handleSelectSession}
          onNewSession={navigation.handleNewSession}
          initialSessionId={navigation.initialSessionId}
          onInitialRestoreDone={navigation.handleInitialRestoreDone}
          onSessionDeleted={navigation.handleSessionDeleted}
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
          {automationShown && (
            <AutomationPage
              initialTarget={automationTarget}
              onConsumeTarget={consumeAutomationTarget}
              overviewResetKey={overviewResetKey}
              onClose={handleCloseAutomation}
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
              initialTab={settings.settingsInitialTab}
              navigationRequestId={settings.settingsNavigationRequestId}
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
              {...info}
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
                  onScopeChange={sidebar.setResourcesEnvironmentId}
                  cwd={resourcesCwd}
                  sessionId={selectedSession?.environmentId === resourcesTarget ? selectedSession.id : null}
                  view={sidebar.resourceView}
                  onViewChange={sidebar.setResourceView}
                  activeTab={sidebar.resourceTab}
                  onTabChange={sidebar.setResourceTab}
                  onPluginsReloaded={navigation.bumpSessionKey}
                  channelSnapshot={channels.channelSnapshot}
                  onOpenRemote={openRemote}
                  onOpenFile={handleOpenLinkedFile}
                />
              )}
              {showChat ? (
                <SessionProfiler key={`${environmentId}:${navigation.sessionKey}`} id="ChatWindow">
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
                    onAgentEnd={handleExplorerRefresh}
                    onSessionCreated={navigation.handleSessionCreated}
                    onSessionForked={navigation.handleSessionForked}
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
          {...dock}
          onResizeStart={dock.handleRightPanelResizeStart}
          onResizeKeyDown={dock.handleRightPanelResizeKeyDown}
          onManagedProcessCountChange={dock.setManagedProcessCount}
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
