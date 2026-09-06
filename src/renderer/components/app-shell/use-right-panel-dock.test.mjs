import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out right panel dock owner of AppShell:
// managed process badge, auto-activation, empty-tab collapse, per-kind width
// persistence, keyboard resize, and browser tab surface requests.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { useRightPanelDock } = await importTestBundle("app-shell-right-panel-dock", {
  stdin: {
    contents: 'export { useRightPanelDock } from "./src/renderer/components/app-shell/use-right-panel-dock.ts";',
    resolveDir: projectRoot,
    sourcefile: "right-panel-dock-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "right-panel-dock-stubs",
      setup(build) {
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "right-panel-dock" }));
        build.onLoad({ filter: /.*/, namespace: "right-panel-dock" }, () => ({
          contents:
            "export const call = (method, params) => globalThis.__dockHarness.call(method, params);\n" +
            "export const subscribe = (topic, key, listener) =>\n" +
            "  globalThis.__dockHarness.subscribe(topic, key, listener);",
          loader: "js",
        }));
      },
    },
  ],
});

const EXPLORER_TAB_ID = "explorer";
const BROWSER_TAB_ID = "browser";
const PROCESSES_TAB_ID = "processes";
const FILES_WIDTH_KEY = "dexon:right-panel-width:v2";
const BROWSER_WIDTH_KEY = "dexon.browser-panel-width";

function createStorage(preset = {}) {
  const store = new Map(Object.entries(preset));
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

const GLOBAL_NAMES = ["window", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ innerWidth = 1400, storage } = {}) {
  const originals = new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const store = storage ?? createStorage();
  const windowListeners = new Map();
  const activateTabCalls = [];
  let browserSettings = { settings: { panel: { openOnAgentUse: true } } };
  const harness = {
    processList: [],
    browserEventHandlers: [],
    processChangedHandlers: [],
    async call(method) {
      if (method === "processes.list") return { processes: harness.processList };
      throw new Error(`unexpected rpc ${method}`);
    },
    async subscribe(topic, key, listener) {
      if (topic !== "processes.changed") throw new Error(`unexpected subscription ${topic}`);
      harness.processChangedHandlers.push(listener);
      return Promise.resolve(() => {});
    },
  };
  globalThis.__dockHarness = harness;
  globalThis.window = {
    innerWidth,
    localStorage: store,
    addEventListener: (name, handler) => {
      const list = windowListeners.get(name) ?? [];
      list.push(handler);
      windowListeners.set(name, list);
    },
    removeEventListener: (name, handler) => {
      const list = windowListeners.get(name) ?? [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    piBridge: {
      onBrowserEvent: (handler) => {
        harness.browserEventHandlers.push(handler);
        return () => {
          const index = harness.browserEventHandlers.indexOf(handler);
          if (index >= 0) harness.browserEventHandlers.splice(index, 1);
        };
      },
      browserGetSettings: async () => browserSettings,
      browserActivateTab: async (tabId) => {
        activateTabCalls.push(tabId);
      },
    },
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    store,
    windowListeners,
    harness,
    activateTabCalls,
    setBrowserSettings(next) {
      browserSettings = next;
    },
    async restore() {
      delete globalThis.__dockHarness;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

async function withEnvironment(options, run) {
  const env = installEnvironment(options);
  try {
    await run(env);
  } finally {
    env.restore();
  }
}

async function mountDock({ isMobile = false, sidebarOpen = true } = {}) {
  const calls = { collapseSidebar: 0 };
  // Stable identity mirrors the real wiring (a useCallback in AppShell); an
  // unstable callback would re-subscribe the process stream on every render.
  const onCollapseSidebar = () => {
    calls.collapseSidebar += 1;
  };
  const state = { value: undefined };
  function Probe() {
    state.value = useRightPanelDock({ isMobile, sidebarOpen, onCollapseSidebar });
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  return {
    state,
    calls,
    unmount: async () => {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}

test("tracks the managed process badge from availability snapshots", async () => {
  await withEnvironment({}, async (env) => {
    env.harness.processList = [{ state: "running" }, { state: "failed" }, { state: "exited", exit: { code: 0 } }];
    const mounted = await mountDock();
    assert.equal(mounted.state.value.managedProcessCount, 1);
    assert.equal(mounted.state.value.managedProcessAttention, true);
    env.harness.processList = [{ state: "ready" }];
    await act(async () => {
      env.harness.processChangedHandlers[0]({ reason: "updated" });
    });
    assert.equal(mounted.state.value.managedProcessCount, 1);
    assert.equal(mounted.state.value.managedProcessAttention, false);
    await mounted.unmount();
  });
});

test("auto-opens the processes tab when a process requests UI activation", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock({ isMobile: true });
    assert.equal(mounted.state.value.rightPanelOpen, false);
    await act(async () => {
      env.harness.processChangedHandlers[0]({ reason: "created", activateUi: true });
    });
    assert.equal(mounted.state.value.activeFileTabId, PROCESSES_TAB_ID);
    assert.equal(mounted.state.value.rightPanelOpen, true);
    assert.equal(mounted.calls.collapseSidebar, 1);
    await mounted.unmount();
  });
});

test("does not collapse the sidebar for desktop process activation", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock();
    await act(async () => {
      env.harness.processChangedHandlers[0]({ reason: "created", activateUi: true });
    });
    assert.equal(mounted.state.value.activeFileTabId, PROCESSES_TAB_ID);
    assert.equal(mounted.state.value.rightPanelOpen, true);
    assert.equal(mounted.calls.collapseSidebar, 0);
    await mounted.unmount();
  });
});

test("closes the panel when the last file tab closes on the files tab", async () => {
  await withEnvironment({}, async () => {
    const mounted = await mountDock();
    await act(async () => {
      mounted.state.value.openRightPanel();
    });
    assert.equal(mounted.state.value.rightPanelOpen, true);
    await act(async () => {
      mounted.state.value.dispatchFileTab({
        type: "open",
        tab: { id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" },
      });
    });
    assert.equal(mounted.state.value.activeFileTabId, "file:/a.ts");
    await act(async () => {
      mounted.state.value.dispatchFileTab({ type: "close", tabId: "file:/a.ts", fallbackTabId: EXPLORER_TAB_ID });
    });
    assert.equal(mounted.state.value.fileTabs.length, 0);
    assert.equal(mounted.state.value.activeFileTabId, EXPLORER_TAB_ID);
    assert.equal(mounted.state.value.rightPanelOpen, false);
    await mounted.unmount();
  });
});

test("keeps the panel open when a file tab closes while a tool tab is active", async () => {
  await withEnvironment({}, async () => {
    const mounted = await mountDock();
    await act(async () => {
      mounted.state.value.openRightPanel();
      mounted.state.value.dispatchFileTab({
        type: "open",
        tab: { id: "file:/a.ts", label: "a.ts", filePath: "/a.ts" },
      });
      mounted.state.value.dispatchFileTab({ type: "select", tabId: BROWSER_TAB_ID });
    });
    await act(async () => {
      mounted.state.value.dispatchFileTab({ type: "close", tabId: "file:/a.ts", fallbackTabId: EXPLORER_TAB_ID });
    });
    assert.equal(mounted.state.value.fileTabs.length, 0);
    assert.equal(mounted.state.value.activeFileTabId, BROWSER_TAB_ID);
    assert.equal(mounted.state.value.rightPanelOpen, true);
    await mounted.unmount();
  });
});

test("restores per-kind preferred widths when the panel kind changes", async () => {
  await withEnvironment({ storage: createStorage({ [BROWSER_WIDTH_KEY]: "420" }) }, async (env) => {
    const mounted = await mountDock();
    assert.equal(mounted.state.value.rightPanelWidth, 360);
    await act(async () => {
      mounted.state.value.dispatchFileTab({ type: "select", tabId: BROWSER_TAB_ID });
    });
    assert.equal(mounted.state.value.rightPanelWidth, 420);
    await act(async () => {
      mounted.state.value.dispatchFileTab({ type: "select", tabId: EXPLORER_TAB_ID });
    });
    assert.equal(mounted.state.value.rightPanelWidth, 360);
    assert.equal(env.store.getItem(BROWSER_WIDTH_KEY), "420");
    assert.equal(env.store.getItem(FILES_WIDTH_KEY), "360");
    await mounted.unmount();
  });
});

test("adjusts and persists the width from the keyboard", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock();
    await act(async () => {
      mounted.state.value.handleRightPanelResizeKeyDown({ key: "ArrowRight", shiftKey: false, preventDefault() {} });
    });
    assert.equal(mounted.state.value.rightPanelWidth, 344);
    assert.equal(env.store.getItem(FILES_WIDTH_KEY), "344");
    await act(async () => {
      mounted.state.value.dispatchFileTab({ type: "select", tabId: BROWSER_TAB_ID });
    });
    await act(async () => {
      mounted.state.value.handleRightPanelResizeKeyDown({ key: "ArrowLeft", shiftKey: false, preventDefault() {} });
    });
    assert.equal(mounted.state.value.rightPanelWidth, 536);
    assert.equal(env.store.getItem(BROWSER_WIDTH_KEY), "536");
    await mounted.unmount();
  });
});

test("opens the browser tab on a desktop open-browser-tab request", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock();
    const handlers = env.windowListeners.get("dexon:open-browser-tab") ?? [];
    assert.equal(handlers.length, 1);
    await act(async () => {
      handlers[0]({ detail: { tabId: "t1" } });
    });
    assert.equal(mounted.state.value.activeFileTabId, BROWSER_TAB_ID);
    assert.equal(mounted.state.value.rightPanelOpen, true);
    assert.deepEqual(env.activateTabCalls, ["t1"]);
    await mounted.unmount();
  });
});

test("follows the open-on-agent-use setting for agent tab creation", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock();
    assert.equal(env.harness.browserEventHandlers.length, 1);
    await act(async () => {
      env.harness.browserEventHandlers[0]({ type: "tab-created", tab: { ownerSessionId: "s1" } });
    });
    await act(async () => {});
    assert.equal(mounted.state.value.rightPanelOpen, true);
    assert.equal(mounted.state.value.activeFileTabId, BROWSER_TAB_ID);
    await mounted.unmount();
  });
});

test("ignores agent tab creation when the panel open setting is disabled", async () => {
  await withEnvironment({}, async (env) => {
    env.setBrowserSettings({ settings: { panel: { openOnAgentUse: false } } });
    const mounted = await mountDock();
    await act(async () => {
      env.harness.browserEventHandlers[0]({ type: "tab-created", tab: { ownerSessionId: "s1" } });
    });
    await act(async () => {});
    assert.equal(mounted.state.value.rightPanelOpen, false);
    await mounted.unmount();
  });
});

test("collapses the sidebar when the viewport is too narrow for both panels", async () => {
  await withEnvironment({ innerWidth: 900 }, async () => {
    const mounted = await mountDock();
    await act(async () => {
      mounted.state.value.openRightPanel();
    });
    assert.equal(mounted.state.value.rightPanelOpen, true);
    assert.equal(mounted.calls.collapseSidebar, 1);
    assert.equal(mounted.state.value.rightPanelWidth, 360);
    assert.equal(mounted.state.value.rightPanelBounds.maxWidth, 360);
    await mounted.unmount();
  });
});
