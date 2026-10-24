import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import {
  RIGHT_PANEL_MAX_VIEWPORT_RATIO,
  getRightPanelWidthLimit,
  type RightPanelWidthBounds,
  type RightPanelWidthLimit,
} from "@/lib/layout-preferences";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { AppLanguage } from "@/i18n";
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
  personalCwd,
  homeDir,
  headerAction,
  suspended = false,
}: {
  activeFileTabId: string;
  fileTabs: { id: string; label: string; filePath: string; sourceSessionId?: string | null }[];
  dispatchFileTab: (
    action: { type: "select"; tabId: string } | { type: "close"; tabId: string; fallbackTabId: string },
  ) => void;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelBounds: RightPanelWidthBounds;
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
  personalCwd: string | null;
  homeDir: string;
  headerAction?: ReactNode;
  suspended?: boolean;
}) {
  const { language, t } = useI18n();
  const activeFileTab = fileTabs.find((tab) => tab.id === activeFileTabId) ?? null;
  const [lastFileTabId, setLastFileTabId] = useState<string | null>(null);
  if (activeFileTab && activeFileTab.id !== lastFileTabId) setLastFileTabId(activeFileTab.id);
  const explorerFilePath = fileTabs.find((tab) => tab.id === lastFileTabId)?.filePath ?? null;

  const widthLimit = getRightPanelWidthLimit(rightPanelWidth, rightPanelBounds);

  const panelStyle: CSSProperties = {
    display: suspended ? "none" : "flex",
    flexDirection: "column",
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
        data-limit={widthLimit ?? undefined}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
      />
      {rightPanelResizing && rightPanelOpen && (
        <PanelWidthReadout width={rightPanelWidth} bounds={rightPanelBounds} limit={widthLimit} language={language} />
      )}
      <div
        className={`right-panel-header${activeFileTabId === EXPLORER_TAB_ID ? " right-panel-header-explorer" : ""}${activeFileTabId === EXPLORER_TAB_ID && fileTabs.length === 0 ? " right-panel-header-ruled" : ""}`}
      >
        <DockSwitcher
          activeFileTabId={activeFileTabId}
          onSelect={(tabId) => dispatchFileTab({ type: "select", tabId })}
          labels={{
            [EXPLORER_TAB_ID]: t("explorer", "Explorer"),
            [BROWSER_TAB_ID]: t("browser", "Browser"),
            [PROCESSES_TAB_ID]: t("processes", "Processes"),
          }}
          count={managedProcessCount > 0 || managedProcessAttention ? managedProcessCount : null}
          attention={managedProcessAttention}
        />
        <div className="right-panel-header-spacer" />
        {activeFileTabId === EXPLORER_TAB_ID && explorerCwd && (
          <button
            type="button"
            className="right-panel-icon-button"
            onClick={onRefreshExplorer}
            title={t("refreshExplorer", "Refresh explorer")}
            aria-label={t("refreshExplorer", "Refresh explorer")}
          >
            <DockIcon kind="refresh" size={14} />
          </button>
        )}
        {headerAction}
      </div>
      {fileTabs.length > 0 && (
        <div className="right-panel-tab-strip">
          <TabBar
            tabs={fileTabs}
            activeTabId={activeFileTabId}
            onSelectTab={(tabId) => dispatchFileTab({ type: "select", tabId })}
            onCloseTab={(tabId) => dispatchFileTab({ type: "close", tabId, fallbackTabId: EXPLORER_TAB_ID })}
          />
        </div>
      )}

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
            <div
              style={{
                height: "100%",
                overflowY: "auto",
                overflowX: "hidden",
                background: "var(--fx-surface-sidebar)",
              }}
            >
              <FileExplorer
                cwd={explorerCwd}
                personalCwd={personalCwd}
                homeDir={homeDir}
                activeFilePath={explorerFilePath}
                onOpenFile={onOpenFile}
                refreshKey={explorerRefreshKey}
                onAtMention={onAtMention}
              />
            </div>
          ) : (
            <div className="right-panel-empty type-label-default">
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
          <div className="right-panel-empty type-label-default">
            {t("selectRightPanelContent", "Select Browser, Explorer, Processes or open a file")}
          </div>
        )}
      </div>
    </div>
  );
}

type DockTabId = typeof EXPLORER_TAB_ID | typeof BROWSER_TAB_ID | typeof PROCESSES_TAB_ID;
type DockIconKind = "folder" | "globe" | "terminal" | "refresh";

const DOCK_TABS: { id: DockTabId; icon: DockIconKind }[] = [
  { id: EXPLORER_TAB_ID, icon: "folder" },
  { id: BROWSER_TAB_ID, icon: "globe" },
  { id: PROCESSES_TAB_ID, icon: "terminal" },
];

const PIXEL_UNIT = "px";

function DockIcon({ kind, size }: { kind: DockIconKind; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "folder" && (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
      {kind === "globe" && (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </>
      )}
      {kind === "terminal" && (
        <>
          <path d="m7 11 2-2-2-2" />
          <path d="M11 13h4" />
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        </>
      )}
      {kind === "refresh" && (
        <>
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </>
      )}
    </svg>
  );
}

function DockSwitcher({
  activeFileTabId,
  onSelect,
  labels,
  count,
  attention,
}: {
  activeFileTabId: string;
  onSelect: (tabId: DockTabId) => void;
  labels: Record<DockTabId, string>;
  count: number | null;
  attention: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [gliding, setGliding] = useState(false);
  const activeIndex = DOCK_TABS.findIndex((tab) => tab.id === activeFileTabId);
  const layoutKey = `${DOCK_TABS.map((tab) => labels[tab.id]).join("|")}|${count ?? ""}`;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const button = activeIndex >= 0 ? root.querySelectorAll<HTMLElement>("[data-dock-tab]")[activeIndex] : null;
      if (!button || button.offsetWidth === 0) return;
      setPill((current) =>
        current?.left === button.offsetLeft && current.width === button.offsetWidth
          ? current
          : { left: button.offsetLeft, width: button.offsetWidth },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [activeIndex, layoutKey]);

  useLayoutEffect(() => {
    if (pill && !gliding) setGliding(true);
  }, [pill, gliding]);

  return (
    <div ref={rootRef} className="dock-switcher">
      {pill && (
        <span
          className={`dock-switcher-pill${activeIndex < 0 ? " dock-switcher-pill-hidden" : ""}${gliding ? " dock-switcher-pill-gliding" : ""}`}
          style={{ width: pill.width, transform: `translateX(${pill.left}px)` }}
          aria-hidden="true"
        />
      )}
      {DOCK_TABS.map((tab) => {
        const active = tab.id === activeFileTabId;
        return (
          <button
            key={tab.id}
            type="button"
            data-dock-tab
            className={`dock-switcher-tab ${active ? "type-label-medium" : "type-label-default"}`}
            onClick={() => onSelect(tab.id)}
            aria-pressed={active}
          >
            <DockIcon kind={tab.icon} size={13} />
            {labels[tab.id]}
            {tab.id === PROCESSES_TAB_ID && count !== null && (
              <span
                className={`dock-switcher-count type-mono-meta${attention ? " dock-switcher-count-attention" : ""}`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function readoutNote(
  bounds: RightPanelWidthBounds,
  limit: RightPanelWidthLimit | null,
  language: AppLanguage,
  t: (key: string, fallback: string) => string,
): string {
  if (limit === "min") return t("rightPanelWidthAtMin", "Minimum width reached");
  if (limit === "max") {
    if (bounds.maxLimitedBy === "chat") {
      return t("rightPanelWidthAtChatMax", "Maximum · chat needs its minimum width");
    }
    const percent = formatNumber(Math.round(RIGHT_PANEL_MAX_VIEWPORT_RATIO * 100), language);
    return t("rightPanelWidthAtWindowMax", "Maximum · {percent}% of window").replace("{percent}", percent);
  }
  return `${formatNumber(bounds.minWidth, language)} – ${formatNumber(bounds.maxWidth, language)}`;
}

function PanelWidthReadout({
  width,
  bounds,
  limit,
  language,
}: {
  width: number;
  bounds: RightPanelWidthBounds;
  limit: RightPanelWidthLimit | null;
  language: AppLanguage;
}) {
  const { t } = useI18n();
  const rounded = Math.round(width);
  return (
    <div className="panel-width-readout" aria-hidden="true">
      <span className="panel-width-readout-value type-mono-label">{formatNumber(rounded, language)}</span>
      <span className="panel-width-readout-meta type-mono-meta">{PIXEL_UNIT}</span>
      <span className="panel-width-readout-separator" />
      <span className="panel-width-readout-meta type-mono-meta">{readoutNote(bounds, limit, language, t)}</span>
    </div>
  );
}
