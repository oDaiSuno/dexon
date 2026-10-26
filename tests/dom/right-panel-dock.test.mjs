import assert from "node:assert/strict";
import test, { after } from "node:test";
import { byRole, button, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";

const { RightPanelDock, setAppLanguage } = await loadRenderer(
  "right-panel-dock-frame",
  'export {RightPanelDock} from "./src/renderer/components/app-shell/right-panel-dock.tsx";',
);
setAppLanguage("zh-CN");
after(restoreGlobals);

const noop = () => {};
const WINDOW_CAPPED = { minWidth: 280, maxWidth: 576, maxLimitedBy: "window" };
const CHAT_CAPPED = { minWidth: 280, maxWidth: 308, maxLimitedBy: "chat" };
const NO_ROOM = { minWidth: 208, maxWidth: 208, maxLimitedBy: "chat" };

function dockProps(patch = {}) {
  return {
    activeFileTabId: "explorer",
    fileTabs: [],
    dispatchFileTab: noop,
    rightPanelOpen: true,
    rightPanelWidth: 412,
    rightPanelBounds: WINDOW_CAPPED,
    rightPanelResizing: false,
    onResizeStart: noop,
    onResizeKeyDown: noop,
    managedProcessCount: 0,
    onManagedProcessCountChange: noop,
    managedProcessAttention: false,
    selectedSessionId: null,
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

const dragging = (width, bounds = WINDOW_CAPPED) =>
  dockProps({ rightPanelWidth: width, rightPanelBounds: bounds, rightPanelResizing: true });
const handle = (view) => byRole(view.container, "separator", "调整右侧面板宽度");

test("while dragging inside the allowed range, the readout shows the width and the range", async (t) => {
  const view = await mount(t, RightPanelDock, dragging(412));
  assert.ok(text(view.container, "412"));
  assert.ok(text(view.container, "px"));
  assert.ok(text(view.container, "280 – 576"));
});

test("dragging to the narrowest width replaces the range with 已到最小宽度", async (t) => {
  const view = await mount(t, RightPanelDock, dragging(280));
  assert.ok(text(view.container, "280"));
  assert.ok(text(view.container, "已到最小宽度"));
  assert.doesNotMatch(view.container.textContent, /280 – 576/);
});

test("dragging to the widest width allowed by the 40% window cap says the window is the limit", async (t) => {
  const view = await mount(t, RightPanelDock, dragging(576));
  assert.ok(text(view.container, "576"));
  assert.ok(text(view.container, "已到最大 · 窗口 40%"));
  assert.doesNotMatch(view.container.textContent, /280 – 576/);
});

test("when the chat column's minimum width caps the panel, the readout blames the chat column, not the window", async (t) => {
  const view = await mount(t, RightPanelDock, dragging(308, CHAT_CAPPED));
  assert.ok(text(view.container, "已到最大 · 聊天区最小宽度"));
  assert.doesNotMatch(view.container.textContent, /窗口/);
});

test("when the window leaves no room to resize at all, the readout explains the chat column limit", async (t) => {
  const view = await mount(t, RightPanelDock, dragging(208, NO_ROOM));
  assert.ok(text(view.container, "已到最大 · 聊天区最小宽度"));
  assert.doesNotMatch(view.container.textContent, /已到最小宽度/);
});

test("a width that lands on a bound marks the handle at that edge even without dragging, as after a keyboard resize", async (t) => {
  const view = await mount(t, RightPanelDock, dockProps({ rightPanelWidth: 576 }));
  assert.equal(handle(view).getAttribute("data-limit"), "max");
  await view.update(dockProps({ rightPanelWidth: 280 }));
  assert.equal(handle(view).getAttribute("data-limit"), "min");
  await view.update(dockProps({ rightPanelWidth: 412 }));
  assert.equal(handle(view).hasAttribute("data-limit"), false);
  await view.update(dragging(576));
  assert.equal(handle(view).getAttribute("data-limit"), "max");
});

test("a failed process with nothing running keeps the danger badge on 进程 and shows the count 0 instead of !", async (t) => {
  const view = await mount(t, RightPanelDock, dockProps({ managedProcessAttention: true }));
  assert.ok(button(view.container, "进程0"));
  assert.doesNotMatch(view.container.textContent, /!/);
  await view.update(dockProps({ managedProcessAttention: true, managedProcessCount: 2 }));
  assert.ok(button(view.container, "进程2"));
  await view.update(dockProps());
  assert.ok(button(view.container, "进程"));
});
