import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { resolveSessionTitle, useSessionCatalog } from "@/lib/session-catalog";
import { browserErrorMessage as messageOf } from "./browser-error-message";
import { BrowserCrashedState, BrowserEmptyState, BrowserNoTabState } from "./browser-empty-state";
import { BrowserNotice, BrowserPermissionBar, activeDownload } from "./browser-notices";
import { BrowserStatusBar } from "./browser-status-bar";
import { BrowserTabStrip } from "./browser-tab-strip";
import { BrowserToolbar } from "./browser-toolbar";
import type { BrowserEvent, BrowserRendererState } from "../../../contract/browser";

export function BrowserDock({ visible, ownerSessionId }: { visible: boolean; ownerSessionId: string | null }) {
  const { t } = useI18n();
  const sessionCatalog = useSessionCatalog();
  const [state, setState] = useState<BrowserRendererState | null>(null);
  const [address, setAddress] = useState("");
  const [profileId, setProfileId] = useState("temporary");
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const refresh = useCallback(async () => {
    try {
      const next = await window.piBridge.browserGetState();
      if (!stateRef.current) setProfileId(next.settings.settings.panel.defaultProfileId);
      setState(next);
      const active = next.tabs.find((tab) => tab.id === next.activeTabId);
      if (active) setAddress(active.url);
      setError("");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  const reportError = useCallback((cause: unknown) => setError(messageOf(cause)), []);

  const handleTabSyncError = useCallback(
    (cause: unknown) => {
      // Decide recovery from the protocol error, not its localized display text.
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("TAB_NOT_FOUND")) {
        void refresh();
        return;
      }
      setError(messageOf(cause));
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    return window.piBridge.onBrowserEvent((event) => {
      setState((current) => (current ? applyBrowserEvent(current, event) : current));
      if (event.type === "active-tab-changed") {
        const tab = stateRef.current?.tabs.find((candidate) => candidate.id === event.tabId);
        if (tab) setAddress(tab.url);
      } else if (event.type === "tab-updated" && event.tab.id === stateRef.current?.activeTabId) {
        setAddress(event.tab.url);
      }
    });
  }, [refresh]);

  const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  const visibleTabs =
    state?.tabs.filter((tab) => tab.ownerSessionId === null || tab.ownerSessionId === ownerSessionId) ?? [];

  useEffect(() => {
    if (!state || !visible || !state.activeTabId) return;
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!active || active.ownerSessionId === null || active.ownerSessionId === ownerSessionId) return;
    const replacement = [...state.tabs]
      .filter((tab) => tab.ownerSessionId === null || tab.ownerSessionId === ownerSessionId)
      .sort((left, right) => right.lastActiveAt - left.lastActiveAt)[0];
    if (replacement) void window.piBridge.browserActivateTab(replacement.id).catch(handleTabSyncError);
    else void window.piBridge.browserSetSurfaceVisible({ visible: false });
  }, [handleTabSyncError, ownerSessionId, state, visible]);

  useEffect(() => {
    const tabId = activeTab?.id;
    void window.piBridge
      .browserSetSurfaceVisible({ ...(tabId ? { tabId } : {}), visible: visible && Boolean(tabId) })
      .catch(handleTabSyncError);
    return () => {
      void window.piBridge.browserSetSurfaceVisible({ visible: false }).catch(() => undefined);
    };
  }, [activeTab?.id, handleTabSyncError, visible]);

  useLayoutEffect(() => {
    const element = surfaceRef.current;
    const tabId = activeTab?.id;
    if (!element || !tabId || !visible) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        void window.piBridge
          .browserSetBounds({
            tabId,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            scaleFactorVersion: Math.round(window.devicePixelRatio * 1000),
          })
          .catch(handleTabSyncError);
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [activeTab?.id, handleTabSyncError, visible]);

  const createTab = async () => {
    try {
      const tab = await window.piBridge.browserCreateUserTab({
        profileId,
        ownerSessionId,
        activate: true,
      });
      setAddress(tab.url);
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const navigate = async () => {
    if (!activeTab) return;
    try {
      await window.piBridge.browserNavigateUser(activeTab.id, address);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  if (!state) {
    return (
      <div style={columnStyle}>
        {error ? (
          <BrowserEmptyState
            icon="triangle-alert"
            iconColor="var(--fx-status-danger)"
            title={t("browserLoadFailed", "Couldn't load the Browser")}
            description={error}
          />
        ) : (
          <BrowserEmptyState icon="loader" spinning title={t("browserLoadingPanel", "Loading Browser…")} />
        )}
      </div>
    );
  }
  if (!state.settings.settings.enabled) {
    return (
      <div style={columnStyle}>
        <BrowserEmptyState
          icon="globe"
          title={t("browserDisabled", "Built-in Browser is off")}
          description={t("browserEnableInSettings", "Enable it in Settings → Browser.")}
        />
      </div>
    );
  }

  const agentControl = activeTab?.control === "agent";
  const tabOwnerId = activeTab?.ownerSessionId ?? null;
  const resolvedTitle = tabOwnerId ? resolveSessionTitle(tabOwnerId, undefined, sessionCatalog) : null;
  const sessionTitle = resolvedTitle && resolvedTitle !== tabOwnerId ? resolvedTitle : null;

  return (
    <div style={columnStyle}>
      <BrowserTabStrip
        tabs={visibleTabs}
        activeTabId={state.activeTabId}
        onActivate={(tabId) => void window.piBridge.browserActivateTab(tabId).catch(reportError)}
        onClose={(tabId) => void window.piBridge.browserCloseTab(tabId).catch(reportError)}
        onCreate={() => void createTab()}
      />
      <BrowserToolbar
        activeTab={activeTab}
        address={address}
        profiles={state.profiles}
        newTabProfileId={profileId}
        menuOpen={menuOpen}
        onAddressChange={setAddress}
        onNavigate={() => void navigate()}
        onNewTabProfileChange={setProfileId}
        onMenuOpenChange={setMenuOpen}
        onError={reportError}
      />
      {state.permissionRequests.map((request) => (
        <BrowserPermissionBar key={request.id} request={request} onRespond={refresh} />
      ))}
      <BrowserNotice error={error} download={activeDownload(state.downloads)} />

      {!activeTab ? (
        <BrowserNoTabState onCreate={() => void createTab()} />
      ) : activeTab.crashed ? (
        <BrowserCrashedState onReload={() => void window.piBridge.browserReload(activeTab.id)} />
      ) : (
        <div
          data-agent-control={agentControl || undefined}
          style={{
            display: "flex",
            flex: 1,
            minHeight: 1,
            padding: agentControl ? 2 : 0,
            background: agentControl ? "var(--fx-accent-blue-border)" : undefined,
          }}
        >
          <div
            ref={surfaceRef}
            data-browser-surface
            style={{ flex: 1, minWidth: 0, minHeight: 1, position: "relative", background: "#fff" }}
          />
        </div>
      )}

      <BrowserStatusBar
        agentControl={agentControl}
        strictIsolation={state.settings.settings.navigation.networkIsolation === "strict"}
        advanced={Boolean(activeTab?.advanced || activeTab?.advancedProfile)}
        sessionTitle={sessionTitle}
      />
    </div>
  );
}

function applyBrowserEvent(state: BrowserRendererState, event: BrowserEvent): BrowserRendererState {
  if (event.type === "tab-created") return { ...state, tabs: [...state.tabs, event.tab] };
  if (event.type === "tab-updated")
    return { ...state, tabs: state.tabs.map((tab) => (tab.id === event.tab.id ? event.tab : tab)) };
  if (event.type === "tab-closed")
    return {
      ...state,
      tabs: state.tabs.filter((tab) => tab.id !== event.tabId),
      activeTabId: state.activeTabId === event.tabId ? null : state.activeTabId,
    };
  if (event.type === "active-tab-changed") return { ...state, activeTabId: event.tabId };
  if (event.type === "permission-request")
    return {
      ...state,
      permissionRequests: [
        ...state.permissionRequests.filter((request) => request.id !== event.request.id),
        event.request,
      ],
    };
  if (event.type === "permission-resolved")
    return {
      ...state,
      permissionRequests: state.permissionRequests.filter((request) => request.id !== event.requestId),
    };
  if (event.type === "download")
    return {
      ...state,
      downloads: [...state.downloads.filter((download) => download.id !== event.download.id), event.download].slice(
        -100,
      ),
    };
  if (event.type === "policy-changed")
    return {
      ...state,
      capabilities: event.snapshot,
      settings: { ...state.settings, runtime: { ...state.settings.runtime, policyRevision: event.revision } },
    };
  return state;
}

const columnStyle = {
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column" as const,
  background: "var(--fx-surface-main)",
};
