import assert from "node:assert/strict";
import test, { after } from "node:test";
import { byRole, click, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

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
