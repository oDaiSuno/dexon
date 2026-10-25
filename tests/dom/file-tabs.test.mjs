import assert from "node:assert/strict";
import test, { after } from "node:test";
import { byRole, click, dom, keyDown, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { allByRole } from "../support/dom-queries.mjs";

const { TabBar, setAppLanguage } = await loadRenderer(
  "file-tab-bar",
  'export {TabBar} from "./src/renderer/components/TabBar.tsx";',
);
setAppLanguage("zh-CN");
after(restoreGlobals);

const FILE_TABS = [
  { id: "f1", label: "FileExplorer.tsx", filePath: "/workspace/src/FileExplorer.tsx" },
  { id: "f2", label: "TabBar.tsx", filePath: "/workspace/src/TabBar.tsx" },
];

function tabBar(patch = {}) {
  return { tabs: FILE_TABS, activeTabId: "f2", onSelectTab() {}, onCloseTab() {}, ...patch };
}

test("each open file is a button named after the file, and only the active one is marked current", async (t) => {
  const view = await mount(t, TabBar, tabBar());
  const active = byRole(view.container, "button", "TabBar.tsx");
  const other = byRole(view.container, "button", "FileExplorer.tsx");
  assert.ok(active, "the active file tab is a button");
  assert.ok(other, "an inactive file tab is a button");
  assert.equal(active.getAttribute("aria-current"), "page");
  assert.equal(other.hasAttribute("aria-current"), false);
  assert.equal(active.getAttribute("title"), "/workspace/src/TabBar.tsx");
});

test("pressing an inactive file tab selects that file", async (t) => {
  const selected = [];
  const view = await mount(t, TabBar, tabBar({ onSelectTab: (id) => selected.push(id) }));
  await click(byRole(view.container, "button", "FileExplorer.tsx"));
  assert.deepEqual(selected, ["f1"]);
});

test("the close button says in Chinese which file it closes, and closing does not also select the file", async (t) => {
  const selected = [];
  const closed = [];
  const view = await mount(
    t,
    TabBar,
    tabBar({ onSelectTab: (id) => selected.push(id), onCloseTab: (id) => closed.push(id) }),
  );
  assert.equal(byRole(view.container, "button", "Close"), undefined);
  const close = byRole(view.container, "button", "关闭 FileExplorer.tsx");
  assert.ok(close, "the close button has a translated name that includes the file name");
  assert.ok(byRole(view.container, "button", "关闭 TabBar.tsx"));
  await click(close);
  assert.deepEqual(closed, ["f1"]);
  assert.deepEqual(selected, []);
});

const MENU_TABS = [...FILE_TABS, { id: "f3", label: "DESIGN.md", filePath: "/workspace/DESIGN.md" }];
const body = () => dom.window.document.body;
const tabsMenu = () => byRole(body(), "menu", "全部标签");
const menuFile = (name) => byRole(tabsMenu(), "menuitemradio", name);

test("the all-tabs button lists every open file in order and ticks only the active one", async (t) => {
  const view = await mount(t, TabBar, tabBar({ tabs: MENU_TABS }));
  const trigger = byRole(view.container, "button", "全部标签");
  assert.ok(trigger, "the tab strip ends with a button named 全部标签");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  await click(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const items = allByRole(tabsMenu(), "menuitemradio");
  assert.deepEqual(
    items.map((item) => item.textContent.trim()),
    ["FileExplorer.tsx", "TabBar.tsx", "DESIGN.md"],
  );
  assert.deepEqual(
    items.map((item) => item.getAttribute("aria-checked")),
    ["false", "true", "false"],
  );
});

test("choosing a file in the all-tabs menu switches to it, closes the menu and returns focus to the button", async (t) => {
  const selected = [];
  const view = await mount(t, TabBar, tabBar({ tabs: MENU_TABS, onSelectTab: (id) => selected.push(id) }));
  const trigger = byRole(view.container, "button", "全部标签");
  await click(trigger);
  await click(menuFile("DESIGN.md"));
  assert.deepEqual(selected, ["f3"]);
  assert.equal(tabsMenu(), undefined);
  assert.equal(dom.window.document.activeElement, trigger);
});

test("the all-tabs menu works from the keyboard: it opens on the active file, arrows move, Escape closes back to the button", async (t) => {
  const selected = [];
  const view = await mount(t, TabBar, tabBar({ tabs: MENU_TABS, onSelectTab: (id) => selected.push(id) }));
  const trigger = byRole(view.container, "button", "全部标签");
  await keyDown(trigger, "ArrowDown");
  assert.ok(tabsMenu(), "ArrowDown on the button opens the menu");
  assert.equal(dom.window.document.activeElement, menuFile("TabBar.tsx"));
  await keyDown(dom.window.document.activeElement, "ArrowDown");
  assert.equal(dom.window.document.activeElement, menuFile("DESIGN.md"));
  await keyDown(dom.window.document.activeElement, "Escape");
  assert.equal(tabsMenu(), undefined);
  assert.equal(dom.window.document.activeElement, trigger);
  assert.deepEqual(selected, []);
});
