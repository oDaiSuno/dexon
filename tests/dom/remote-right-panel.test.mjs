import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, button, click, dom, hover, keyDown, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { createFolderBrowserHost } from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "remote-right-panel",
  'export {useRightPanelDock} from "./src/renderer/components/app-shell/use-right-panel-dock.ts"; export {RightPanelDock} from "./src/renderer/components/app-shell/right-panel-dock.tsx"; export {WorkspaceCard} from "./src/renderer/components/chat-input/workspace-card.tsx"; export {WorkspaceReadOnlyCard} from "./src/renderer/components/chat-input/workspace-read-only-card.tsx"; export {workspaceStore} from "./src/renderer/lib/workspace-store.ts"; export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";',
);
api.setAppLanguage("en-US");
after(restoreGlobals);
const noop = () => {};

async function remote(t) {
  const host = await createFolderBrowserHost(api, { target: dom.window });
  const originals = [
    [globalThis, "EventSource"],
    [globalThis, "fetch"],
    [dom.window, "fetch"],
    [dom.window, "EventSource"],
  ].map(([owner, name]) => [owner, name, Object.getOwnPropertyDescriptor(owner, name)]);
  dom.window.fetch = globalThis.fetch;
  api.installApiShims();
  globalThis.EventSource = dom.window.EventSource;
  globalThis.fetch = dom.window.fetch;
  t.after(async () => {
    await act(async () => host.close());
    for (const [owner, name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(owner, name, descriptor);
      else delete owner[name];
    }
  });
  api.environmentRegistry.initialize();
  await act(async () => api.workspaceStore.openSpace({ environmentId: "gpu", path: "/same/project" }));
}

const dockProps = (patch = {}) => ({
  activeFileTabId: "explorer",
  fileTabs: [],
  dispatchFileTab: noop,
  rightPanelOpen: true,
  rightPanelWidth: 356,
  rightPanelBounds: { minWidth: 280, maxWidth: 576, maxLimitedBy: "window" },
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
  personalCwd: null,
  homeDir: "/home/dev",
  ...patch,
});

test("file tabs keep their opening environment and never show another server's identical path after focus switches", async (t) => {
  await remote(t);
  let dock;
  function Probe() {
    dock = api.useRightPanelDock({ isMobile: false, sidebarOpen: false, onCollapseSidebar: noop });
    return null;
  }
  await mount(t, Probe);
  const open = () => ({ type: "open", tab: { id: "file:/same/path", label: "path", filePath: "/same/path" } });
  const fromA = dock.dispatchFileTab;
  await act(async () => {
    fromA(open());
    dock.openRightPanel();
  });
  assert.equal(dock.fileTabs[0].environmentId, "gpu");
  await act(async () => api.workspaceStore.openSpace({ environmentId: "staging", path: "/same/project" }));
  assert.equal(dock.fileTabs.length, 0);
  assert.equal(dock.activeFileTabId, "explorer");
  assert.equal(dock.rightPanelOpen, true);
  await act(async () => fromA(open()));
  assert.equal(dock.fileTabs.length, 0);
  await act(async () => dock.dispatchFileTab(open()));
  assert.equal(dock.fileTabs[0].environmentId, "staging");
  assert.equal(dock.activeFileTabId, '["staging","/same/path"]');
  await act(async () => api.workspaceStore.openSpace({ environmentId: "gpu", path: "/same/project" }));
  assert.equal(dock.fileTabs.length, 1);
  assert.equal(dock.fileTabs[0].id, '["gpu","/same/path"]');
  assert.equal(dock.activeFileTabId, '["gpu","/same/path"]');
});

for (const mode of ["read-only", "switchable"]) {
  test(`remote ${mode} workspace explains unavailable reveal and offers copy remote path`, async (t) => {
    await remote(t);
    let revealed = 0;
    let copied = 0;
    const workspace = {
      mode,
      project: { name: "project", path: "/same/project" },
      branch: null,
      isWorktree: false,
      path: "/same/project",
      openInFinder: async () => {
        revealed += 1;
      },
      copyPath: async () => {
        copied += 1;
      },
      card: {
        projects: [],
        pane: { state: "loading" },
        browsedName: "project",
        filter: "",
        blocked: null,
        error: null,
      },
    };
    const view = await mount(t, mode === "read-only" ? api.WorkspaceReadOnlyCard : api.WorkspaceCard, {
      id: "workspace",
      workspace,
      anchorRef: { current: null },
      isMobile: false,
      onRequestClose: noop,
      onFocusTrigger: noop,
    });
    const reveal = button(view.container, "Show in Finder");
    assert.ok(reveal);
    assert.equal(reveal.getAttribute("aria-disabled"), "true");
    await act(async () => reveal.focus());
    const tooltip = dom.window.document.getElementById(reveal.getAttribute("aria-describedby"));
    assert.equal(tooltip.hidden, false);
    assert.match(tooltip.textContent, /Files are stored on gpu/);
    await click(reveal);
    assert.equal(revealed, 0);
    await click(button(view.container, "Copy remote path"));
    assert.equal(copied, 1);
  });
}

test("the remote explorer exposes disabled local reveal and an effective copy remote path alternative", async (t) => {
  await remote(t);
  const copied = [];
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value) => copied.push(value) },
  });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
  const view = await mount(t, api.RightPanelDock, dockProps({ explorerCwd: "/same/project" }));
  const reveal = button(view.container, "Show in Finder");
  assert.ok(reveal);
  assert.equal(reveal.getAttribute("aria-disabled"), "true");
  await click(button(view.container, "Copy remote path"));
  assert.deepEqual(copied, ["/same/project"]);
});

test("remote local preview remains visible, explains itself on focus and cannot activate", async (t) => {
  await remote(t);
  const selected = [];
  const view = await mount(t, api.RightPanelDock, dockProps({ dispatchFileTab: (action) => selected.push(action) }));
  const preview = button(view.container, "Local preview");
  assert.ok(preview);
  assert.equal(preview.getAttribute("aria-disabled"), "true");
  assert.ok(preview.classList.contains("remote-disabled-trigger"));
  await hover(preview);
  const tooltip = dom.window.document.getElementById(preview.getAttribute("aria-describedby"));
  assert.equal(tooltip.hidden, false);
  await act(async () =>
    preview.dispatchEvent(
      new dom.window.MouseEvent("mouseout", { bubbles: true, relatedTarget: dom.window.document.body }),
    ),
  );
  assert.equal(tooltip.hidden, true);
  await act(async () => preview.focus());
  assert.equal(tooltip.getAttribute("role"), "tooltip");
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /Remote project spaces do not support embedded local preview/);
  await click(preview);
  await keyDown(preview, "Enter");
  await keyDown(preview, " ");
  assert.deepEqual(selected, []);
  await keyDown(preview, "Escape");
  assert.equal(tooltip.hidden, true);
});
