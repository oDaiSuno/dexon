import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, button, click, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const { WorkspaceMenu, setAppLanguage } = await loadRenderer(
  "workspace-menu-platform",
  'export {WorkspaceMenu} from "./src/renderer/components/chat-input/workspace-menu.tsx";',
);
after(restoreGlobals);

function workspace(opened) {
  const noop = () => {};
  return {
    project: { name: "dexon", path: "/work/dexon", displayPath: "~/work/dexon" },
    checkouts: [],
    current: null,
    currentPath: "/work/dexon",
    menuOpen: true,
    newEntryOpen: false,
    newBranch: "",
    busy: false,
    error: null,
    confirmRemovePath: null,
    toggleMenu: noop,
    closeMenu: noop,
    selectCheckout: noop,
    openNewEntry: noop,
    closeNewEntry: noop,
    setNewBranch: noop,
    createCheckout: noop,
    removeCheckout: noop,
    cancelRemove: noop,
    switchProject: noop,
    openInFinder: async () => {
      opened.push("folder");
    },
    copyPath: async () => {},
  };
}

function onPlatform(t, platform) {
  const original = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  dom.window.piBridge = { ...dom.window.piBridge, platform };
  t.after(() => {
    if (original) Object.defineProperty(dom.window, "piBridge", original);
    else delete dom.window.piBridge;
  });
}

const cases = [
  { platform: "darwin", language: "zh-CN", label: "在访达中打开" },
  { platform: "win32", language: "zh-CN", label: "在资源管理器中打开" },
  { platform: "linux", language: "zh-CN", label: "在文件管理器中打开" },
  { platform: "darwin", language: "en-US", label: "Open in Finder" },
  { platform: "win32", language: "en-US", label: "Open in File Explorer" },
  { platform: "linux", language: "en-US", label: "Open in File Manager" },
];

for (const { platform, language, label } of cases) {
  test(`on ${platform} in ${language} the workspace menu names the system file browser as “${label}” and opens the folder`, async (t) => {
    setAppLanguage(language);
    onPlatform(t, platform);
    const opened = [];
    const view = await mount(t, WorkspaceMenu, { id: "workspace-menu", workspace: workspace(opened) });
    const action = button(view.container, label);
    assert.ok(action, `expected a “${label}” action`);
    await click(action);
    assert.deepEqual(opened, ["folder"]);
  });
}
