import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, act, button, byRole, click, keyDown, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { browserState, browserTab } from "../support/browser-state.mjs";
const { BrowserDock, RightPanelDock, setAppLanguage } = await loadRenderer(
  "browser-dock-behavior",
  'export {BrowserDock} from "./src/renderer/components/browser/BrowserDock.tsx"; export {RightPanelDock} from "./src/renderer/components/app-shell/right-panel-dock.tsx";',
);
after(restoreGlobals);
function mainBridge(t) {
  const state = browserState([
    browserTab("owned", "session-one"),
    browserTab("public"),
    browserTab("foreign", "session-two"),
  ]);
  const surfaces = [];
  const bounds = [];
  const listeners = new Set();
  t.mock.method(dom.window.HTMLElement.prototype, "getBoundingClientRect", () => ({
    x: 30,
    y: 42,
    width: 520,
    height: 360,
  }));
  dom.window.piBridge = {
    browserGetState: async () => structuredClone(state),
    onBrowserEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    browserSetSurfaceVisible: async (input) => {
      surfaces.push(input);
    },
    browserSetBounds: async (input) => {
      bounds.push(input);
    },
    browserActivateTab: async (id) => {
      state.activeTabId = id;
      for (const listener of listeners) listener({ type: "active-tab-changed", tabId: id });
    },
  };
  return { state, surfaces, bounds, listeners };
}

test("the Browser panel exposes only public or current-session tabs and synchronizes native bounds", async (t) => {
  const main = mainBridge(t);
  setAppLanguage("en-US");
  const view = await mount(t, BrowserDock, { visible: true, ownerSessionId: "session-one" });
  assert.match(view.container.textContent, /owned page/);
  assert.match(view.container.textContent, /public page/);
  assert.doesNotMatch(view.container.textContent, /foreign page/);
  assert.deepEqual(main.bounds.at(-1).rect, { x: 30, y: 42, width: 520, height: 360 });
  assert.deepEqual(main.surfaces.at(-1), { tabId: "owned", visible: true });
  await view.update({ visible: false, ownerSessionId: "session-one" });
  assert.equal(main.surfaces.at(-1).visible, false);
  await view.unmount();
  assert.equal(main.listeners.size, 0);
});

const noop = () => {};
function dockProps(patch = {}) {
  return {
    activeFileTabId: "browser",
    fileTabs: [],
    dispatchFileTab: noop,
    rightPanelOpen: true,
    rightPanelWidth: 520,
    rightPanelBounds: { minWidth: 300, maxWidth: 1000 },
    rightPanelResizing: false,
    onResizeStart: noop,
    onResizeKeyDown: noop,
    managedProcessCount: 0,
    onManagedProcessCountChange: noop,
    managedProcessAttention: false,
    selectedSessionId: "session-one",
    settingsOpen: false,
    browserAuthorizationOpen: false,
    isMobile: false,
    explorerCwd: null,
    explorerRefreshKey: 0,
    onRefreshExplorer: noop,
    onOpenFile: noop,
    onAtMention: noop,
    activeCwd: null,
    ...patch,
  };
}

test("the fixed Browser resource hides its native surface behind settings or authorization", async (t) => {
  const main = mainBridge(t);
  setAppLanguage("en-US");
  const view = await mount(t, RightPanelDock, dockProps());
  assert.ok([...view.container.querySelectorAll("button")].some((element) => element.textContent.trim() === "Browser"));
  assert.equal(main.surfaces.at(-1).visible, true);
  await view.update(dockProps({ settingsOpen: true }));
  assert.equal(main.surfaces.at(-1).visible, false);
  await view.update(dockProps({ browserAuthorizationOpen: true }));
  assert.equal(main.surfaces.at(-1).visible, false);
  await view.update(dockProps());
  assert.equal(main.surfaces.at(-1).visible, true);
});

test("a tab removed by Main is refreshed rather than leaving a broken Browser panel", async (t) => {
  const main = mainBridge(t);
  let reads = 0;
  dom.window.piBridge.browserGetState = async () => {
    reads++;
    return structuredClone(main.state);
  };
  dom.window.piBridge.browserSetBounds = async (input) => {
    if (input.tabId === "owned") {
      main.state.tabs = [browserTab("replacement")];
      main.state.activeTabId = "replacement";
      throw new Error("TAB_NOT_FOUND: removed");
    }
  };
  const view = await mount(t, BrowserDock, { visible: true, ownerSessionId: "session-one" });
  await act(async () => {
    await Promise.resolve();
  });
  assert.ok(reads >= 2);
  assert.match(view.container.textContent, /replacement page/);
  assert.doesNotMatch(view.container.textContent, /owned page/);
});

test("a tab shows the site's own icon once Main has one, and the globe placeholder otherwise", async (t) => {
  const main = mainBridge(t);
  main.state.tabs[0].favicon = "data:image/png;base64,AQID";
  setAppLanguage("en-US");
  const view = await mount(t, BrowserDock, { visible: true, ownerSessionId: "session-one" });
  const icons = [...view.container.querySelectorAll("img")];
  assert.equal(icons.length, 1);
  assert.equal(icons[0].getAttribute("src"), "data:image/png;base64,AQID");
  assert.equal(icons[0].getAttribute("alt"), "");
});

function agentBridge(t) {
  const main = mainBridge(t);
  main.state.tabs[0].control = "agent";
  const takeovers = [];
  dom.window.piBridge.browserTakeOver = async (tabId) => {
    takeovers.push(tabId);
  };
  return { main, takeovers };
}

test("while the Agent is working the panel offers a takeover button that hands the tab back", async (t) => {
  const { takeovers } = agentBridge(t);
  setAppLanguage("en-US");
  const view = await mount(t, BrowserDock, { visible: true, ownerSessionId: "session-one" });
  const takeOver = button(view.container, /Take over/);
  assert.ok(takeOver);
  assert.match(takeOver.textContent, /Agent is working/);
  assert.match(takeOver.textContent, /Esc/);
  await click(takeOver);
  assert.deepEqual(takeovers, ["owned"]);
});

test("pressing Esc inside the Browser panel takes over from the Agent", async (t) => {
  const { takeovers } = agentBridge(t);
  setAppLanguage("en-US");
  const view = await mount(t, BrowserDock, { visible: true, ownerSessionId: "session-one" });
  await keyDown(byRole(view.container, "textbox", "Browser address"), "Escape");
  assert.deepEqual(takeovers, ["owned"]);
});

test("the takeover button reads in Chinese as the design writes it", async (t) => {
  agentBridge(t);
  setAppLanguage("zh-CN");
  const view = await mount(t, BrowserDock, { visible: true, ownerSessionId: "session-one" });
  const takeOver = button(view.container, /接管/);
  assert.match(takeOver.textContent, /Agent 正在操作/);
  assert.match(takeOver.textContent, /点一下接管/);
});

test("when the user is in control there is no takeover button and Esc does nothing", async (t) => {
  mainBridge(t);
  const takeovers = [];
  dom.window.piBridge.browserTakeOver = async (tabId) => {
    takeovers.push(tabId);
  };
  setAppLanguage("en-US");
  const view = await mount(t, BrowserDock, { visible: true, ownerSessionId: "session-one" });
  assert.equal(button(view.container, /Take over/), undefined);
  await keyDown(byRole(view.container, "textbox", "Browser address"), "Escape");
  assert.deepEqual(takeovers, []);
});
