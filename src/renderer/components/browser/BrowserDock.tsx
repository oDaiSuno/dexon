import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { browserErrorMessage as messageOf } from "./browser-error-message";
import { BrowserTabStrip } from "./browser-tab-strip";
import { BrowserToolbar } from "./browser-toolbar";
import type {
  BrowserDownloadInfo,
  BrowserEvent,
  BrowserPermissionRequest,
  BrowserRendererState,
} from "../../../contract/browser";

export function BrowserDock({ visible, ownerSessionId }: { visible: boolean; ownerSessionId: string | null }) {
  const { t } = useI18n();
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

  if (!state) return <div style={emptyStyle}>{error || t("browserLoadingPanel", "Loading Browser…")}</div>;
  if (!state.settings.settings.enabled) {
    return (
      <div style={emptyStyle}>
        <div>{t("browserDisabled", "Built-in Browser is disabled.")}</div>
        <div style={{ marginTop: 8, color: "var(--fx-text-tertiary)" }}>
          {t("browserEnableInSettings", "Enable it in Settings → Browser.")}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--fx-surface-main)",
      }}
    >
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

      {(error || state.permissionRequests.length > 0 || activeDownload(state.downloads)) && (
        <div
          style={{
            display: "grid",
            gap: 4,
            padding: "4px 8px",
            borderBottom: "1px solid var(--fx-line-default)",
            background: "var(--fx-surface-raised)",
            fontSize: "var(--text-micro)",
          }}
        >
          {error && <div style={{ color: "var(--fx-status-danger)" }}>{error}</div>}
          {state.permissionRequests.map((request) => (
            <PermissionPrompt key={request.id} request={request} onRespond={refresh} />
          ))}
          {activeDownload(state.downloads) && <DownloadStatus download={activeDownload(state.downloads)!} />}
        </div>
      )}

      {!activeTab ? (
        <div style={emptyStyle}>
          <button style={primaryButtonStyle} onClick={() => void createTab()}>
            {t("browserOpenNewTab", "Open a new tab")}
          </button>
          <div style={{ marginTop: 8, color: "var(--fx-text-tertiary)" }}>
            {t("browserRemotePageSecurity", "Remote pages receive no Pi Desktop preload or Node access.")}
          </div>
        </div>
      ) : activeTab.crashed ? (
        <div style={emptyStyle}>
          <div>{t("browserTabCrashed", "This tab’s renderer crashed.")}</div>
          <button
            style={{ ...primaryButtonStyle, marginTop: 8 }}
            onClick={() => void window.piBridge.browserReload(activeTab.id)}
          >
            {t("browserReload", "Reload")}
          </button>
        </div>
      ) : (
        <div
          ref={surfaceRef}
          data-browser-surface
          style={{ flex: 1, minHeight: 1, position: "relative", background: "#fff" }}
        />
      )}

      {activeTab && (
        <div
          style={{
            minHeight: 22,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 8px",
            borderTop: "1px solid var(--fx-line-default)",
            color: "var(--fx-text-tertiary)",
            fontSize: "var(--text-micro)",
            background: "var(--fx-surface-raised)",
          }}
        >
          <span>
            {activeTab.control === "agent"
              ? t("browserAgentControl", "Agent is controlling this tab — click or type to take over")
              : t("browserUserControl", "User control")}
          </span>
          <span>·</span>
          <span>
            {state.settings.settings.navigation.networkIsolation === "strict"
              ? t("browserStrictIsolation", "Strict isolation")
              : t("browserBestEffortIsolation", "Best-effort network isolation")}
          </span>
          {activeTab.advanced || activeTab.advancedProfile ? (
            <Badge danger>{t("browserAdvancedModeBadge", "Advanced Browser Mode")}</Badge>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PermissionPrompt({
  request,
  onRespond,
}: {
  request: BrowserPermissionRequest;
  onRespond: () => Promise<void>;
}) {
  const { t } = useI18n();
  const respond = (decision: "allow-once" | "allow-session" | "deny") =>
    void window.piBridge.browserRespondPermission(request.id, decision).then(onRespond);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fx-text-secondary)" }}>
      <span style={{ flex: 1 }}>
        {formatMessage(t("browserPermissionRequest", "{origin} requests {permission}"), {
          origin: request.origin,
          permission: request.permission,
        })}
      </span>
      <button style={tinyButtonStyle} onClick={() => respond("deny")}>
        {t("browserDeny", "Deny")}
      </button>
      <button style={tinyButtonStyle} onClick={() => respond("allow-once")}>
        {t("browserAllowOnce", "Once")}
      </button>
      <button style={tinyButtonStyle} onClick={() => respond("allow-session")}>
        {t("browserAllowSession", "Session")}
      </button>
    </div>
  );
}

function DownloadStatus({ download }: { download: BrowserDownloadInfo }) {
  const { t } = useI18n();
  const percent = download.totalBytes > 0 ? Math.round((download.receivedBytes / download.totalBytes) * 100) : null;
  const stateLabel = downloadStateLabel(t, download.state);
  return (
    <div style={{ color: download.state === "interrupted" ? "var(--fx-status-danger)" : "var(--fx-text-tertiary)" }}>
      {formatMessage(t("browserDownloadStatus", "Download {filename}: {state}{percent}"), {
        filename: download.filename,
        state: stateLabel,
        percent: percent === null ? "" : ` ${percent}%`,
      })}
    </div>
  );
}

function Badge({ children, danger }: { children: string; danger?: boolean }) {
  return (
    <span
      style={{
        padding: "1px 4px",
        borderRadius: "var(--radius-chip)",
        color: danger ? "var(--fx-status-danger)" : "var(--fx-status-warning)",
        border: `1px solid ${danger ? "var(--fx-status-danger)" : "var(--fx-status-warning)"}`,
        fontSize: "var(--text-micro)",
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}

function activeDownload(downloads: BrowserDownloadInfo[]): BrowserDownloadInfo | undefined {
  return [...downloads]
    .reverse()
    .find(
      (download) =>
        download.state === "pending" || download.state === "progressing" || download.state === "interrupted",
    );
}

type Translate = ReturnType<typeof useI18n>["t"];

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function downloadStateLabel(t: Translate, state: BrowserDownloadInfo["state"]): string {
  switch (state) {
    case "pending":
      return t("browserDownloadPending", "pending");
    case "progressing":
      return t("browserDownloadProgressing", "progressing");
    case "completed":
      return t("browserDownloadCompleted", "completed");
    case "cancelled":
      return t("browserDownloadCancelled", "cancelled");
    default:
      return t("browserDownloadInterrupted", "interrupted");
  }
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

const emptyStyle = {
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  textAlign: "center" as const,
  color: "var(--fx-text-secondary)",
  fontSize: "var(--text-meta)",
};
const primaryButtonStyle = {
  minHeight: 32,
  padding: "0 12px",
  border: "1px solid var(--fx-accent-blue)",
  borderRadius: "var(--radius-control)",
  background: "var(--fx-accent-blue-soft)",
  color: "var(--fx-accent-blue)",
  cursor: "pointer",
  fontSize: "var(--text-meta)",
};
const tinyButtonStyle = {
  minHeight: 22,
  padding: "0 8px",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-chip)",
  background: "var(--fx-surface-main)",
  color: "var(--fx-text-secondary)",
  cursor: "pointer",
  fontSize: "var(--text-micro)",
};
