import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installApiHostBridge } from "../../../../tests/support/api-host.mjs";
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

const { resetRpc, useRightPanelDock } = await importTestBundle("app-shell-right-panel-dock", {
  stdin: {
    contents:
      'export { useRightPanelDock } from "./src/renderer/components/app-shell/use-right-panel-dock.ts";' +
      '\nexport {resetRpc} from "./src/renderer/lib/api-client.ts";',
    resolveDir: projectRoot,
    sourcefile: "right-panel-dock-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
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
  const cleanups = [];
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
  const hostBoundary = installApiHostBridge(globalThis.window, () => globalThis.__dockHarness, resetRpc);
  return {
    store,
    windowEvent(type, event) {
      for (const handler of [...(windowListeners.get(type) ?? [])]) handler(event);
    },
    browserEvent(event) {
      for (const handler of [...harness.browserEventHandlers]) handler(event);
    },
    processChanged(event) {
      for (const handler of [...harness.processChangedHandlers]) handler(event);
    },
    ownCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    harness,
    activateTabCalls,
    setBrowserSettings(next) {
      browserSettings = next;
    },
    async restore() {
      const errors = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        hostBoundary.close();
      } catch (error) {
        errors.push(error);
      }
      delete globalThis.__dockHarness;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      if (errors.length) throw new AggregateError(errors, "Dock cleanup failed");
    },
  };
}

async function withEnvironment(options, run) {
  const env = installEnvironment(options);
  try {
    await run(env);
  } finally {
    await env.restore();
  }
}

async function mountDock(env, { isMobile = false, sidebarOpen = true } = {}) {
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
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => renderer?.unmount());
  };
  env.ownCleanup(unmount);
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  return {
    state,
    calls,
    unmount,
  };
}

test("tracks the managed process badge from availability snapshots", async () => {
  await withEnvironment({}, async (env) => {
    env.harness.processList = [{ state: "running" }, { state: "failed" }, { state: "exited", exit: { code: 0 } }];
    const mounted = await mountDock(env);
    assert.equal(mounted.state.value.managedProcessCount, 1);
    assert.equal(mounted.state.value.managedProcessAttention, true);
    env.harness.processList = [{ state: "ready" }];
    await act(async () => {
      env.processChanged({ reason: "updated" });
    });
    assert.equal(mounted.state.value.managedProcessCount, 1);
    assert.equal(mounted.state.value.managedProcessAttention, false);
    await mounted.unmount();
  });
});

test("auto-opens the processes tab when a process requests UI activation", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock(env, { isMobile: true });
    assert.equal(mounted.state.value.rightPanelOpen, false);
    await act(async () => {
      env.processChanged({ reason: "created", activateUi: true });
    });
    assert.equal(mounted.state.value.activeFileTabId, PROCESSES_TAB_ID);
    assert.equal(mounted.state.value.rightPanelOpen, true);
    assert.equal(mounted.calls.collapseSidebar, 1);
    await mounted.unmount();
  });
});

test("does not collapse the sidebar for desktop process activation", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock(env);
    await act(async () => {
      env.processChanged({ reason: "created", activateUi: true });
    });
    assert.equal(mounted.state.value.activeFileTabId, PROCESSES_TAB_ID);
    assert.equal(mounted.state.value.rightPanelOpen, true);
    assert.equal(mounted.calls.collapseSidebar, 0);
    await mounted.unmount();
  });
});

test("closes the panel when the last file tab closes on the files tab", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock(env);
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
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock(env);
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
    const mounted = await mountDock(env);
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
    const mounted = await mountDock(env);
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
    const mounted = await mountDock(env);
    await act(async () => {
      env.windowEvent("dexon:open-browser-tab", { detail: { tabId: "t1" } });
    });
    assert.equal(mounted.state.value.activeFileTabId, BROWSER_TAB_ID);
    assert.equal(mounted.state.value.rightPanelOpen, true);
    assert.deepEqual(env.activateTabCalls, ["t1"]);
    await mounted.unmount();
  });
});

test("follows the open-on-agent-use setting for agent tab creation", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountDock(env);
    await act(async () => {
      env.browserEvent({ type: "tab-created", tab: { ownerSessionId: "s1" } });
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
    const mounted = await mountDock(env);
    await act(async () => {
      env.browserEvent({ type: "tab-created", tab: { ownerSessionId: "s1" } });
    });
    await act(async () => {});
    assert.equal(mounted.state.value.rightPanelOpen, false);
    await mounted.unmount();
  });
});

test("collapses the sidebar when the viewport is too narrow for both panels", async () => {
  await withEnvironment({ innerWidth: 900 }, async (env) => {
    const mounted = await mountDock(env);
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
