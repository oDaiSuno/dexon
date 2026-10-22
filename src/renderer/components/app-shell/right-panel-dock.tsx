import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { BrowserDock } from "../browser/BrowserDock";
import { FileExplorer } from "../FileExplorer";
import { FileViewer } from "../FileViewer";
import { ProcessPanel } from "../ProcessPanel";
import { TabBar } from "../TabBar";
import { BROWSER_TAB_ID, EXPLORER_TAB_ID, PROCESSES_TAB_ID } from "./use-right-panel-dock";

// Split from AppShell.tsx in Phase 2: the right panel's presentation. Geometry,
// tabs and open state arrive from the right-panel dock hook; visibility inputs
// (settings open, browser authorization) arrive from the composition root.

export function RightPanelDock({
  activeFileTabId,
  fileTabs,
  dispatchFileTab,
  rightPanelOpen,
  rightPanelWidth,
  rightPanelBounds,
  rightPanelResizing,
  onResizeStart,
  onResizeKeyDown,
  managedProcessCount,
  onManagedProcessCountChange,
  managedProcessAttention,
  selectedSessionId,
  settingsOpen,
  browserAuthorizationOpen,
  isMobile,
  explorerCwd,
  explorerRefreshKey,
  onRefreshExplorer,
  onOpenFile,
  onAtMention,
  activeCwd,
  suspended = false,
}: {
  activeFileTabId: string;
  fileTabs: { id: string; label: string; filePath: string; sourceSessionId?: string | null }[];
  dispatchFileTab: (
    action: { type: "select"; tabId: string } | { type: "close"; tabId: string; fallbackTabId: string },
  ) => void;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelBounds: { minWidth: number; maxWidth: number };
  rightPanelResizing: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  managedProcessCount: number;
  onManagedProcessCountChange: (count: number) => void;
  managedProcessAttention: boolean;
  selectedSessionId: string | null;
  settingsOpen: boolean;
  browserAuthorizationOpen: boolean;
  isMobile: boolean;
  explorerCwd: string | null;
  explorerRefreshKey: number;
  onRefreshExplorer: () => void;
  onOpenFile: (filePath: string, fileName: string, sourceSessionId?: string | null) => void;
  onAtMention: (relativePath: string, isDir: boolean) => void;
  activeCwd: string | null;
  suspended?: boolean;
}) {
  const { language, t } = useI18n();
  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;

  const panelStyle: CSSProperties = {
    display: suspended ? "none" : "flex",
    flexDirection: "column",
    borderLeft: "1px solid var(--fx-line-default)",
    background: "var(--fx-surface-main)",
    "--right-panel-width": `${rightPanelWidth}px`,
    "--right-panel-min-width": `${rightPanelBounds.minWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelResizing ? " right-panel-resizing" : ""}`}
      style={panelStyle}
      hidden={suspended}
      aria-hidden={suspended || !rightPanelOpen ? true : undefined}
      inert={suspended || !rightPanelOpen ? true : undefined}
    >
      <div
        className="right-panel-resizer"
        role="separator"
        aria-label={t("resizeRightPanel", "Resize right panel")}
        aria-orientation="vertical"
        aria-valuemin={rightPanelBounds.minWidth}
        aria-valuemax={rightPanelBounds.maxWidth}
        aria-valuenow={Math.round(rightPanelWidth)}
        aria-valuetext={t("rightPanelWidthPixels", "{width} pixels").replace(
          "{width}",
          formatNumber(Math.round(rightPanelWidth), language),
        )}
        tabIndex={isMobile ? -1 : 0}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
      />
      {/* Right panel tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          background: "var(--fx-surface-raised)",
          borderBottom: "1px solid var(--fx-line-default)",
          height: 36,
          paddingRight: 36,
          boxSizing: "border-box",
        }}
      >
        <button
          type="button"
          onClick={() => dispatchFileTab({ type: "select", tabId: EXPLORER_TAB_ID })}
          aria-pressed={activeFileTabId === EXPLORER_TAB_ID}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 36,
            padding: "0 12px",
            flexShrink: 0,
            background: activeFileTabId === EXPLORER_TAB_ID ? "var(--fx-surface-main)" : "var(--fx-surface-raised)",
            border: "none",
            borderRight: "1px solid var(--fx-line-default)",
            color: activeFileTabId === EXPLORER_TAB_ID ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
            cursor: "pointer",
            fontSize: "var(--text-label)",
            fontWeight: activeFileTabId === EXPLORER_TAB_ID ? 500 : 400,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
          {t("explorer", "Explorer")}
        </button>
        <button
          type="button"
          onClick={() => dispatchFileTab({ type: "select", tabId: BROWSER_TAB_ID })}
          aria-pressed={activeFileTabId === BROWSER_TAB_ID}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 36,
            padding: "0 12px",
            flexShrink: 0,
            background: activeFileTabId === BROWSER_TAB_ID ? "var(--fx-surface-main)" : "var(--fx-surface-raised)",
            border: "none",
            borderRight: "1px solid var(--fx-line-default)",
            color: activeFileTabId === BROWSER_TAB_ID ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
            cursor: "pointer",
            fontSize: "var(--text-label)",
            fontWeight: activeFileTabId === BROWSER_TAB_ID ? 500 : 400,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
          </svg>
          {t("browser", "Browser")}
        </button>
        <button
          type="button"
          onClick={() => dispatchFileTab({ type: "select", tabId: PROCESSES_TAB_ID })}
          aria-pressed={activeFileTabId === PROCESSES_TAB_ID}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 36,
            padding: "0 12px",
            flexShrink: 0,
            background: activeFileTabId === PROCESSES_TAB_ID ? "var(--fx-surface-main)" : "var(--fx-surface-raised)",
            border: "none",
            borderRight: "1px solid var(--fx-line-default)",
            color: activeFileTabId === PROCESSES_TAB_ID ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
            cursor: "pointer",
            fontSize: "var(--text-label)",
            fontWeight: activeFileTabId === PROCESSES_TAB_ID ? 500 : 400,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="m7 9 3 3-3 3M13 15h4" />
          </svg>
          {t("processes", "Processes")}
          {(managedProcessCount > 0 || managedProcessAttention) && (
            <span
              style={{
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                display: "inline-grid",
                placeItems: "center",
                borderRadius: "var(--radius-card)",
                background: managedProcessAttention ? "var(--fx-status-danger)" : "var(--fx-accent-blue)",
                color: "var(--fx-text-on-danger)",
                fontSize: "var(--text-micro)",
                fontWeight: 700,
              }}
            >
              {managedProcessCount > 0 ? managedProcessCount : "!"}
            </span>
          )}
        </button>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <TabBar
            tabs={fileTabs}
            activeTabId={activeFileTabId}
            onSelectTab={(tabId) => dispatchFileTab({ type: "select", tabId })}
            onCloseTab={(tabId) => dispatchFileTab({ type: "close", tabId, fallbackTabId: EXPLORER_TAB_ID })}
          />
        </div>
        {activeFileTabId === EXPLORER_TAB_ID && explorerCwd && (
          <button
            type="button"
            onClick={onRefreshExplorer}
            title={t("refreshExplorer", "Refresh explorer")}
            aria-label={t("refreshExplorer", "Refresh explorer")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              padding: 0,
              marginRight: 2,
              flexShrink: 0,
              background: "none",
              border: "none",
              color: "var(--fx-text-tertiary)",
              cursor: "pointer",
              borderRadius: "var(--radius-control)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--fx-text-primary)";
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--fx-text-tertiary)";
              e.currentTarget.style.background = "none";
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
      </div>

      {/* Browser, Explorer, Processes or file content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {activeFileTabId === BROWSER_TAB_ID ? (
          <BrowserDock
            visible={rightPanelOpen && !suspended && !settingsOpen && !browserAuthorizationOpen}
            ownerSessionId={selectedSessionId}
          />
        ) : activeFileTabId === PROCESSES_TAB_ID ? (
          <ProcessPanel
            onActiveCountChange={onManagedProcessCountChange}
            onOpenBrowser={() => dispatchFileTab({ type: "select", tabId: BROWSER_TAB_ID })}
          />
        ) : activeFileTabId === EXPLORER_TAB_ID ? (
          explorerCwd ? (
            <div style={{ height: "100%", overflowY: "auto", overflowX: "hidden", paddingTop: 4 }}>
              <FileExplorer
                cwd={explorerCwd}
                onOpenFile={onOpenFile}
                refreshKey={explorerRefreshKey}
                onAtMention={onAtMention}
              />
            </div>
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--fx-text-tertiary)",
                fontSize: "var(--text-label)",
              }}
            >
              {t("selectProjectToBrowseFiles", "Select a project to browse files")}
            </div>
          )
        ) : activeFileTab?.filePath ? (
          <FileViewer
            key={activeFileTab.id ?? activeFileTab.filePath}
            filePath={activeFileTab.filePath}
            cwd={activeCwd ?? undefined}
            sourceSessionId={activeFileTab.sourceSessionId}
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--fx-text-tertiary)",
              fontSize: "var(--text-label)",
            }}
          >
            {t("selectRightPanelContent", "Select Browser, Explorer, Processes or open a file")}
          </div>
        )}
      </div>
    </div>
  );
}
