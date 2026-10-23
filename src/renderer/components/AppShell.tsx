import { useState, useCallback, useRef, useEffect } from "react";
import { ChatWindow } from "./ChatWindow";
import { SettingsConfig } from "./SettingsConfig";
import { BrowserAuthorizationDialog } from "./browser/BrowserAuthorizationDialog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getFileName } from "@/lib/file-paths";
import { getSessionDisplayTitle } from "@/lib/session-list";
import { buildAtMentionText } from "@/lib/file-fuzzy";
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
import { NavigationSidebar } from "./app-shell/navigation-sidebar";
import { useSettingsDialog } from "./app-shell/use-settings-dialog";
import { SessionBreadcrumb } from "./app-shell/session-breadcrumb";
import type { NavPage } from "./app-nav/nav-sidebar";
import { ChatPlaceholder } from "./app-shell/chat-placeholder";
import { RightPanelDock } from "./app-shell/right-panel-dock";
import { RightPanelToggle, useRightPanelToggleFocus } from "./app-shell/right-panel-toggle";
import { ResourcePage, type ResourceTab } from "./app-nav/resource-page";
import { useDepartureGuard } from "./app-shell/use-departure-guard";

// Phase 2 composition root: assembles the app shell from the navigation,
// right-panel, browser-authorization, channel and session-info owners. The
// layout, chat area and settings modal remain here; everything stateful lives
// in the split modules.

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
  const [page, setPage] = useState<NavPage>("chat");
  const [resourceTab, setResourceTab] = useState<ResourceTab>("plugins");
  const showChatPage = useCallback(() => setPage("chat"), []);
  const { leaveRef, requestDeparture } = useDepartureGuard();
  const changeResourceTab = useCallback(
    (tab: ResourceTab) => requestDeparture(() => setResourceTab(tab)),
    [requestDeparture],
  );

  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const thinkingExpansionRegistryRef = useRef(new ThinkingExpansionRegistry());
  const processDetailsExpansionRegistryRef = useRef(new ThinkingExpansionRegistry());

  const collapseMobileSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);
  const openSidebarForSwitchSession = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const { settingsOpen, settingsInitialTab, settingsNavigationRequestId, openSettings, closeSettings } =
    useSettingsDialog();
  const [authorizationSettingsSessionId, setAuthorizationSettingsSessionId] = useState<string | null>(null);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [activeTopPanel, setActiveTopPanel] = useState<"session" | null>(null);
  const dismissTopPanel = useCallback(() => {
    setActiveTopPanel(null);
  }, []);
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
    requestDeparture,
    onBeforeSessionDeleted: useCallback((sessionId: string) => {
      thinkingExpansionRegistryRef.current.delete(sessionId);
      processDetailsExpansionRegistryRef.current.delete(sessionId);
    }, []),
  });
  const {
    selectedSession,
    newSessionCwd,
    activeCwd,
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
    noteCoordinatorCwd,
  } = navigation;

  // Phase 6: the shell's space coordinator owns the current space — the
  // startup decision (explicit session → last space → personal space),
  // directory validation/retry, and last-space persistence. The sidebar's
  // picker and worktree operations flow up through the combined cwd callback;
  // the coordinator's committed space flows back down as the sidebar's cwd.
  // Echoes of pushed values are tagged "coordinator" by the sidebar and must
  // adopt the cwd without user-space or session-close semantics.
  const coordination = useSpaceCoordination({
    sessionIntent: initialSessionId,
    sessionResolved: initialSessionRestored,
    sessionFound: selectedSession !== null,
    sessionCwd: selectedSession?.cwd ?? newSessionCwd ?? null,
  });
  const handleSidebarCwdChange = useCallback(
    (cwd: string | null, projectRoot?: string | null, origin?: "user" | "coordinator") => {
      if (origin === "coordinator") {
        noteCoordinatorCwd(cwd);
        return;
      }
      handleCwdChange(cwd, projectRoot);
      coordination.noteExternalCwd(cwd);
    },
    [handleCwdChange, noteCoordinatorCwd, coordination],
  );
  const { returnToPersonalSpace } = coordination;
  const handleReturnToPersonalSpace = useCallback(() => {
    void returnToPersonalSpace().then((cwd) => {
      if (cwd) handleCwdChange(cwd, cwd);
    });
  }, [returnToPersonalSpace, handleCwdChange]);
  const handleNavigate = useCallback(
    (target: NavPage) => {
      setActiveTopPanel(null);
      if (isMobile) setSidebarOpen(false);
      setPage(target);
    },
    [isMobile],
  );
  const onResources = page === "resources";

  const dock = useRightPanelDock({
    isMobile,
    sidebarOpen,
    onCollapseSidebar: collapseMobileSidebar,
    suspended: onResources,
  });

  const panelToggle = useRightPanelToggleFocus(dock.handleRightPanelToggle);

  const authorization = useBrowserAuthorization({
    onResolved: useCallback(() => setAuthorizationSettingsSessionId(null), []),
  });

  const channels = useChannelSnapshot();

  const info = useSessionInfo();

  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const handleAgentEnd = useCallback(() => {
    bumpRefresh();
    setExplorerRefreshKey((k) => k + 1);
  }, [bumpRefresh]);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const { dispatchFileTab, openRightPanel } = dock;
  const handleOpenFile = useCallback(
    (filePath: string, fileName: string, sourceSessionId?: string | null) => {
      dispatchFileTab({
        type: "open",
        tab: { id: `file:${filePath}`, label: fileName, filePath, sourceSessionId },
      });
      openRightPanel();
    },
    [dispatchFileTab, openRightPanel],
  );

  const handleOpenLinkedFile = useCallback(
    (filePath: string) => {
      handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null);
    },
    [handleOpenFile, selectedSession?.id],
  );

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  const explorerCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd;

  useEffect(() => {
    if (!activeCwd || isMobile) return;
    dispatchFileTab({ type: "select", tabId: EXPLORER_TAB_ID });
  }, [activeCwd, isMobile, dispatchFileTab]);

  return (
    <>
      <style>{`
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover {
          animation: none;
        }
      }
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(-100%);
          box-shadow: none;
        }
      }
    `}</style>
      <div style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--fx-surface-main)" }}>
        <NavigationSidebar
          isMobile={isMobile}
          open={sidebarOpen}
          onToggle={handleSidebarToggle}
          onClose={collapseMobileSidebar}
          page={page}
          onNavigate={handleNavigate}
          onOpenSettings={() => openSettings("general")}
          coordination={coordination}
          onCwdChange={handleSidebarCwdChange}
          onReturnToPersonalSpace={handleReturnToPersonalSpace}
          shownSessionId={onResources ? null : (selectedSession?.id ?? null)}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          initialSessionId={initialSessionId}
          onInitialRestoreDone={handleInitialRestoreDone}
          refreshKey={refreshKey}
          onSessionDeleted={handleSessionDeleted}
          requestDeparture={requestDeparture}
        />

        {/* Center: chat */}
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
          <TopBar
            sidebarOpen={sidebarOpen}
            onToggleSidebar={handleSidebarToggle}
            showSidebarToggle={isMobile}
            isMobile={isMobile}
            selectedSession={onResources ? null : selectedSession}
            channelSnapshot={channels.channelSnapshot}
            onChannelSnapshotChange={channels.setChannelSnapshot}
            activeTopPanel={activeTopPanel}
            onToggleTopPanel={toggleTopPanel}
            sessionStats={info.sessionStats}
            contextUsage={info.contextUsage}
            copyFeedback={info.sessionCopyFeedback}
            onCopyField={info.handleCopySessionField}
            trailing={
              !onResources && !dock.rightPanelOpen ? (
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

          {selectedSession && !onResources && <SessionBreadcrumb session={selectedSession} />}

          {/* Chat content */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {onResources && (
              <ResourcePage
                cwd={activeCwd ?? coordination.spaceCwd ?? ""}
                sessionId={selectedSession?.id ?? null}
                activeTab={resourceTab}
                onTabChange={changeResourceTab}
                skillsRef={leaveRef}
                onPluginsReloaded={bumpSessionKey}
              />
            )}
            {showChat ? (
              <SessionProfiler key={sessionKey} id="ChatWindow">
                <ChatWindow
                  visible={!onResources}
                  session={selectedSession}
                  newSessionCwd={effectiveNewSessionCwd}
                  onAgentEnd={handleAgentEnd}
                  onSessionCreated={handleSessionCreated}
                  onSessionForked={handleSessionForked}
                  modelsRefreshKey={modelsRefreshKey}
                  chatInputRef={chatInputRef}
                  onSessionStatsChange={info.setSessionStats}
                  onSessionStatsPanelOpen={openSessionStatsPanel}
                  onContextUsageChange={info.setContextUsage}
                  onOpenFile={handleOpenLinkedFile}
                  thinkingExpansionStore={thinkingExpansionRegistryRef.current.get(
                    selectedSession?.id ?? `new:${effectiveNewSessionCwd ?? "untitled"}`,
                  )}
                  processDetailsExpansionStore={processDetailsExpansionRegistryRef.current.get(
                    selectedSession?.id ?? `new:${effectiveNewSessionCwd ?? "untitled"}`,
                  )}
                />
              </SessionProfiler>
            ) : showPlaceholder && !onResources ? (
              <ChatPlaceholder activeCwd={activeCwd} />
            ) : null}
          </div>
        </div>

        {/* Right panel: Browser, Explorer, managed processes and file previews */}
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
          explorerCwd={explorerCwd}
          explorerRefreshKey={explorerRefreshKey}
          onRefreshExplorer={() => setExplorerRefreshKey((key) => key + 1)}
          onOpenFile={handleOpenFile}
          onAtMention={handleAtMention}
          activeCwd={activeCwd}
          headerAction={
            <RightPanelToggle
              placement="panel"
              onToggle={() => panelToggle.toggleFrom("panel")}
              focusRequested={panelToggle.focusTarget === "panel" && dock.rightPanelOpen}
              onFocusHandled={panelToggle.clearFocusTarget}
            />
          }
          suspended={onResources}
        />
      </div>
      {settingsOpen && (
        <SettingsConfig
          cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
          sessionId={authorizationSettingsSessionId ?? selectedSession?.id ?? null}
          initialTab={settingsInitialTab}
          navigationRequestId={settingsNavigationRequestId}
          onClose={closeSettings}
          onModelsChanged={() => setModelsRefreshKey((key) => key + 1)}
          onChannelsChanged={channels.setChannelSnapshot}
          chatAppearance={chatAppearance}
          chatAppearanceSaving={chatAppearanceSaving}
          onChatAppearanceChange={onChatAppearanceChange}
        />
      )}
      {(() => {
        const authorizationRequest = authorization.browserAuthorization;
        if (!authorizationRequest || settingsOpen) return null;
        return (
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
        );
      })()}
    </>
  );
}
