import { call, subscribe } from "@/lib/api-client";
import {
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { reduceFileTabState } from "@/lib/file-tab-state";
import {
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  clampRightPanelWidth,
  getKeyboardAdjustedRightPanelWidth,
  getRightPanelWidthBounds,
  loadRightPanelPreferredWidth,
  saveRightPanelPreferredWidth,
  shouldCollapseSidebarForRightPanel,
  type RightPanelResizeKey,
} from "@/lib/layout-preferences";
import { isManagedProcessActiveState } from "@contract/processes";

// Split from AppShell.tsx in Phase 2: the right panel's state owner. Owns the
// file tabs, panel geometry and resize interaction, the browser tab surface
// requests, and the managed-process badge with its auto-activation.

export const EXPLORER_TAB_ID = "explorer";
export const BROWSER_TAB_ID = "browser";
export const PROCESSES_TAB_ID = "processes";
export const BROWSER_PANEL_WIDTH_KEY = "dexon.browser-panel-width";

function initialRightPanelPreferredWidth(): number {
  try {
    return loadRightPanelPreferredWidth(window.localStorage);
  } catch {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
}

function persistRightPanelPreferredWidth(width: number, browser = false): void {
  try {
    if (browser) window.localStorage.setItem(BROWSER_PANEL_WIDTH_KEY, String(Math.round(width)));
    else saveRightPanelPreferredWidth(window.localStorage, width);
  } catch {
    // Storage can become unavailable after startup; keep the in-memory preference.
  }
}

function loadBrowserPanelPreferredWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(BROWSER_PANEL_WIDTH_KEY));
    return Number.isFinite(value) && value >= RIGHT_PANEL_MIN_WIDTH ? value : 520;
  } catch {
    return 520;
  }
}

export function useRightPanelDock({
  isMobile,
  sidebarOpen,
  onCollapseSidebar,
  suspended = false,
}: {
  isMobile: boolean;
  sidebarOpen: boolean;
  onCollapseSidebar: () => void;
  suspended?: boolean;
}) {
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  // Right panel — file tabs only
  const [{ tabs: fileTabs, activeTabId: activeFileTabId }, dispatchFileTab] = useReducer(reduceFileTabState, {
    tabs: [],
    activeTabId: EXPLORER_TAB_ID,
  });
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelBounds, setRightPanelBounds] = useState(() =>
    getRightPanelWidthBounds(window.innerWidth, sidebarOpen),
  );
  const rightPanelPreferredWidthRef = useRef(RIGHT_PANEL_DEFAULT_WIDTH);
  const rightPanelKindRef = useRef<"files" | "browser" | "processes">("files");
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const preferredWidth = initialRightPanelPreferredWidth();
    rightPanelPreferredWidthRef.current = preferredWidth;
    return clampRightPanelWidth(preferredWidth, window.innerWidth, sidebarOpen);
  });
  const [rightPanelResizing, setRightPanelResizing] = useState(false);
  const rightPanelResizeCleanupRef = useRef<(() => void) | null>(null);
  const [managedProcessCount, setManagedProcessCount] = useState(0);
  const [managedProcessAttention, setManagedProcessAttention] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const refreshCount = () => {
      void call("processes.list", { includeExited: true })
        .then((snapshot) => {
          if (!disposed) {
            setManagedProcessCount(
              snapshot.processes.filter((process) => isManagedProcessActiveState(process.state)).length,
            );
            setManagedProcessAttention(
              snapshot.processes.some(
                (process) => process.state === "failed" || process.state === "lost" || process.exit?.code,
              ),
            );
          }
        })
        .catch(() => undefined);
    };
    refreshCount();
    void subscribe("processes.changed", "*", (event) => {
      refreshCount();
      if (event.reason === "created" && event.activateUi && !suspendedRef.current) {
        if (isMobile) onCollapseSidebar();
        dispatchFileTab({ type: "select", tabId: PROCESSES_TAB_ID });
        setRightPanelOpen(true);
      }
    }).then((value) => {
      if (disposed) value();
      else unsubscribe = value;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [isMobile, onCollapseSidebar]);

  const handleRightPanelResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isMobile || event.button !== 0) return;
      event.preventDefault();
      rightPanelResizeCleanupRef.current?.();

      const startX = event.clientX;
      const startWidth = rightPanelWidth;
      let finalWidth = startWidth;
      let didResize = false;

      const handleMove = (moveEvent: PointerEvent) => {
        if (moveEvent.clientX !== startX) didResize = true;
        finalWidth = clampRightPanelWidth(startWidth + startX - moveEvent.clientX, window.innerWidth, sidebarOpen);
        setRightPanelBounds(getRightPanelWidthBounds(window.innerWidth, sidebarOpen));
        setRightPanelWidth(finalWidth);
      };
      const cleanup = (commit: boolean) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setRightPanelResizing(false);
        rightPanelResizeCleanupRef.current = null;
        if (commit && didResize && finalWidth >= RIGHT_PANEL_MIN_WIDTH) {
          rightPanelPreferredWidthRef.current = finalWidth;
          persistRightPanelPreferredWidth(finalWidth, activeFileTabId === BROWSER_TAB_ID);
        }
      };
      const handlePointerUp = () => cleanup(true);
      const handlePointerCancel = () => cleanup(false);

      rightPanelResizeCleanupRef.current = () => cleanup(false);
      setRightPanelResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
    },
    [activeFileTabId, isMobile, rightPanelWidth, sidebarOpen],
  );

  useEffect(() => () => rightPanelResizeCleanupRef.current?.(), []);

  useEffect(() => {
    if (isMobile) return;
    const nextKind =
      activeFileTabId === BROWSER_TAB_ID ? "browser" : activeFileTabId === PROCESSES_TAB_ID ? "processes" : "files";
    if (rightPanelKindRef.current === nextKind) return;
    persistRightPanelPreferredWidth(rightPanelPreferredWidthRef.current, rightPanelKindRef.current === "browser");
    rightPanelKindRef.current = nextKind;
    const preferred = nextKind === "browser" ? loadBrowserPanelPreferredWidth() : initialRightPanelPreferredWidth();
    rightPanelPreferredWidthRef.current = preferred;
    setRightPanelWidth(clampRightPanelWidth(preferred, window.innerWidth, sidebarOpen));
  }, [activeFileTabId, isMobile, sidebarOpen]);

  useEffect(() => {
    if (isMobile) return;
    const fitToWindow = () => {
      setRightPanelBounds(getRightPanelWidthBounds(window.innerWidth, sidebarOpen));
      setRightPanelWidth(clampRightPanelWidth(rightPanelPreferredWidthRef.current, window.innerWidth, sidebarOpen));
    };
    fitToWindow();
    window.addEventListener("resize", fitToWindow);
    return () => window.removeEventListener("resize", fitToWindow);
  }, [isMobile, sidebarOpen]);

  const openRightPanel = useCallback(() => {
    const closeSidebar = isMobile || shouldCollapseSidebarForRightPanel(window.innerWidth);
    const nextSidebarOpen = closeSidebar ? false : sidebarOpen;
    if (closeSidebar) onCollapseSidebar();
    if (!isMobile) {
      setRightPanelBounds(getRightPanelWidthBounds(window.innerWidth, nextSidebarOpen));
      setRightPanelWidth(clampRightPanelWidth(rightPanelPreferredWidthRef.current, window.innerWidth, nextSidebarOpen));
    }
    setRightPanelOpen(true);
  }, [isMobile, sidebarOpen, onCollapseSidebar]);

  const handleRightPanelToggle = useCallback(() => {
    if (rightPanelOpen) setRightPanelOpen(false);
    else openRightPanel();
  }, [openRightPanel, rightPanelOpen]);

  useEffect(() => {
    const openBrowserTab = (event: Event) => {
      if (suspendedRef.current) return;
      const tabId = (event as CustomEvent<{ tabId?: string }>).detail?.tabId;
      dispatchFileTab({ type: "select", tabId: BROWSER_TAB_ID });
      openRightPanel();
      if (tabId) void window.piBridge.browserActivateTab(tabId).catch(() => undefined);
    };
    window.addEventListener("dexon:open-browser-tab", openBrowserTab);
    return () => window.removeEventListener("dexon:open-browser-tab", openBrowserTab);
  }, [openRightPanel]);

  useEffect(
    () =>
      window.piBridge.onBrowserEvent((event) => {
        if (event.type !== "tab-created" || !event.tab.ownerSessionId) return;
        void window.piBridge.browserGetSettings().then((settings) => {
          if (!settings.settings.panel.openOnAgentUse || suspendedRef.current) return;
          dispatchFileTab({ type: "select", tabId: BROWSER_TAB_ID });
          openRightPanel();
        });
      }),
    [openRightPanel],
  );

  const handleRightPanelResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        isMobile ||
        !(["ArrowLeft", "ArrowRight", "Home", "End"] as const).includes(event.key as RightPanelResizeKey)
      ) {
        return;
      }
      event.preventDefault();
      const nextWidth = getKeyboardAdjustedRightPanelWidth(
        rightPanelWidth,
        event.key as RightPanelResizeKey,
        window.innerWidth,
        sidebarOpen,
        event.shiftKey,
      );
      setRightPanelBounds(getRightPanelWidthBounds(window.innerWidth, sidebarOpen));
      setRightPanelWidth(nextWidth);
      if (nextWidth >= RIGHT_PANEL_MIN_WIDTH) {
        rightPanelPreferredWidthRef.current = nextWidth;
        persistRightPanelPreferredWidth(nextWidth, activeFileTabId === BROWSER_TAB_ID);
      }
    },
    [activeFileTabId, isMobile, rightPanelWidth, sidebarOpen],
  );

  const previousFileTabCountRef = useRef(fileTabs.length);
  useEffect(() => {
    if (
      previousFileTabCountRef.current > 0 &&
      fileTabs.length === 0 &&
      activeFileTabId !== BROWSER_TAB_ID &&
      activeFileTabId !== PROCESSES_TAB_ID
    ) {
      setRightPanelOpen(false);
    }
    previousFileTabCountRef.current = fileTabs.length;
  }, [activeFileTabId, fileTabs.length]);

  return {
    fileTabs,
    activeFileTabId,
    dispatchFileTab,
    rightPanelOpen,
    rightPanelWidth,
    rightPanelBounds,
    rightPanelResizing,
    openRightPanel,
    handleRightPanelToggle,
    handleRightPanelResizeStart,
    handleRightPanelResizeKeyDown,
    managedProcessCount,
    setManagedProcessCount,
    managedProcessAttention,
  };
}
