import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, button, dom, loadRenderer, mount, restoreGlobals, text, waitFor } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "file-explorer-summary",
  'export {FileExplorer} from "./src/renderer/components/FileExplorer.tsx"; export {RightPanelDock} from "./src/renderer/components/app-shell/right-panel-dock.tsx";',
);
api.setAppLanguage("zh-CN");
after(restoreGlobals);

const HOME = "/Users/demo";
const PROJECT = "/Users/demo/Developer/personal/btron/dexon";
const PERSONAL = "/Users/demo/Documents/Dexon";

const NOT_GIT = {
  isGit: false,
  branch: null,
  clean: true,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflicted: 0,
  entries: [],
};
const CLEAN = { ...NOT_GIT, isGit: true, branch: "feat/explorer-redesign" };
const change = (code, path) => ({ index: code[0], workingTree: code[1], path });
const DIRTY_ENTRIES = [
  change("A ", "src/renderer/components/GitStatusBar.tsx"),
  change("M ", "src/shared/git-status.ts"),
  change("M ", "src/shared/api-types.ts"),
  change(" M", "src/renderer/components/FileExplorer.tsx"),
  change(" M", "src/renderer/components/FileIcons.tsx"),
  change(" M", "src/renderer/globals.css"),
  change(" M", "src/agent-host/handlers/project.ts"),
  change(" M", "DESIGN.md"),
  change("??", "notes.md"),
  change("??", "tests/explorer.test.mjs"),
];
const DIRTY = { ...CLEAN, clean: false, staged: 3, modified: 5, untracked: 2, entries: DIRTY_ENTRIES };
const CONFLICTED = {
  ...DIRTY,
  conflicted: 1,
  entries: [...DIRTY_ENTRIES, change("UU", "src/renderer/components/TabBar.tsx")],
};

const file = (name) => ({ name, path: name, type: "file", isDir: false, size: 1, mtime: 0 });

function explorerHost(t, { git = DIRTY, entries = [file("README.md")], pending = false } = {}) {
  const watchers = [];
  const host = installRendererApi(dom.window, api, () => ({
    call(method) {
      if (method === "files.watchStart" || method === "files.watchStop") return { ok: true };
      if (pending && (method === "git.status" || method === "files.list")) return new Promise(() => {});
      if (method === "git.status") return git;
      if (method === "files.list") return { entries };
      if (method === "files.read")
        return { content: "export {};\n", language: "typescript", encoding: "utf8", size: 11 };
      throw new Error(`unexpected request ${method}`);
    },
    subscribe(topic, key, listener) {
      if (topic === "files.changed") watchers.push({ key, listener });
      return () => {};
    },
  }));
  t.after(() => host.close());
  return {
    host,
    async watcher(event) {
      await waitFor(() => assert.ok(watchers.length > 0, "the explorer watches the project folder"));
      await act(async () => {
        for (const watcher of watchers) watcher.listener({ event, path: watcher.key });
      });
    },
  };
}

async function explorer(t, props = {}, hostOptions = {}) {
  const host = explorerHost(t, hostOptions);
  const view = await mount(t, api.FileExplorer, {
    cwd: PROJECT,
    homeDir: HOME,
    personalCwd: PERSONAL,
    activeFilePath: null,
    refreshKey: 0,
    onOpenFile() {},
    ...props,
  });
  return { view, ...host };
}

function stat(container, label) {
  const term = [...container.querySelectorAll("dt")].find((node) => node.textContent.trim() === label);
  if (!term) return undefined;
  let definition = term.nextElementSibling;
  while (definition && definition.tagName !== "DD") definition = definition.nextElementSibling;
  return definition?.textContent.trim();
}

const loaded = (view) => waitFor(() => assert.ok(text(view.container, "README.md"), "the file tree has loaded"));

test("a Git project's top row names the folder, shows where it lives under home, and says it is connecting until the watcher answers", async (t) => {
  const { view, watcher } = await explorer(t);
  await loaded(view);
  assert.ok(text(view.container, "dexon"), "the project folder name is shown");
  assert.ok(text(view.container, "~/Developer/personal/btron"), "the parent folder is shown relative to home");
  assert.ok(text(view.container, "连接中"), "before the watcher answers the row says it is connecting");
  await watcher("connected");
  await waitFor(() => assert.ok(text(view.container, "实时"), "once connected the row says the panel is live"));
  assert.equal(text(view.container, "连接中"), undefined);
});

test("when the project watcher fails, the top row says the panel is static instead of still connecting", async (t) => {
  const { view, watcher } = await explorer(t);
  await loaded(view);
  await watcher("error");
  await waitFor(() => assert.ok(text(view.container, "静态")));
  assert.equal(text(view.container, "连接中"), undefined);
});

test("the personal space is named as such, shows its own location, and says it is not a Git repository", async (t) => {
  const { view } = await explorer(t, { cwd: PERSONAL }, { git: NOT_GIT });
  await loaded(view);
  assert.ok(text(view.container, "个人空间"));
  assert.ok(text(view.container, "~/Documents/Dexon"));
  assert.ok(text(view.container, "不是 Git 仓库"));
  assert.ok(text(view.container, "只显示文件"));
  assert.equal(stat(view.container, "已暂存"), undefined, "a folder without Git has no change counts");
});

test("a project with changes shows its branch, the total number of changed paths, and each kind of change", async (t) => {
  const { view } = await explorer(t);
  await loaded(view);
  assert.ok(text(view.container, "feat/explorer-redesign"));
  assert.ok(text(view.container, "10 处改动"));
  assert.equal(stat(view.container, "已暂存"), "3");
  assert.equal(stat(view.container, "已修改"), "5");
  assert.equal(stat(view.container, "未跟踪"), "2");
  assert.equal(stat(view.container, "冲突"), undefined, "without conflicts there is no conflict count");
  assert.equal(text(view.container, "不是 Git 仓库"), undefined);
});

test("a project with a conflict also counts the conflict", async (t) => {
  const { view } = await explorer(t, {}, { git: CONFLICTED });
  await loaded(view);
  assert.ok(text(view.container, "11 处改动"));
  assert.equal(stat(view.container, "冲突"), "1");
});

test("a clean project says the working tree is clean instead of listing change counts", async (t) => {
  const { view } = await explorer(t, {}, { git: CLEAN });
  await loaded(view);
  assert.ok(text(view.container, "feat/explorer-redesign"));
  assert.ok(text(view.container, "工作区干净"));
  assert.ok(text(view.container, "没有未提交的改动"));
  assert.equal(stat(view.container, "已暂存"), undefined);
  assert.equal(
    [...view.container.querySelectorAll("*")].some((node) => /处改动/.test(node.textContent)),
    false,
  );
});

test("the files are listed under a Files heading", async (t) => {
  const { view } = await explorer(t);
  await loaded(view);
  assert.ok(text(view.container, "文件"));
});

test("while the project is still loading, the panel keeps its top row and announces that files are loading", async (t) => {
  const { view } = await explorer(t, {}, { pending: true });
  await waitFor(() => assert.ok(text(view.container, "正在加载文件…")));
  assert.ok(text(view.container, "dexon"), "the project name is visible while loading");
  assert.ok(text(view.container, "连接中"));
  assert.ok(text(view.container, "文件"), "the Files heading is visible while loading");
});

const noop = () => {};
function dock(patch = {}) {
  return {
    activeFileTabId: "explorer",
    fileTabs: [],
    dispatchFileTab: noop,
    rightPanelOpen: true,
    rightPanelWidth: 360,
    rightPanelBounds: { minWidth: 280, maxWidth: 720, maxLimitedBy: "window" },
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
    explorerCwd: PROJECT,
    explorerRefreshKey: 0,
    onRefreshExplorer: noop,
    onOpenFile: noop,
    onAtMention: noop,
    activeCwd: PROJECT,
    personalCwd: PERSONAL,
    homeDir: HOME,
    ...patch,
  };
}

test("back in the explorer, the file last viewed in a tab is marked as the current row until its tab is closed", async (t) => {
  explorerHost(t, { entries: [file("index.ts"), file("README.md")] });
  const tab = { id: `file:${PROJECT}/index.ts`, label: "index.ts", filePath: `${PROJECT}/index.ts` };
  const view = await mount(t, api.RightPanelDock, dock({ fileTabs: [tab], activeFileTabId: tab.id }));
  await view.update(dock({ fileTabs: [tab], activeFileTabId: "explorer" }));
  const row = (name) => button(view.container, `打开文件 ${name}`);
  await waitFor(() => assert.ok(row("index.ts"), "the explorer lists the files"));
  assert.equal(row("index.ts").getAttribute("aria-current"), "true");
  assert.equal(row("README.md").hasAttribute("aria-current"), false);
  await view.update(dock({ fileTabs: [], activeFileTabId: "explorer" }));
  assert.equal(row("index.ts").hasAttribute("aria-current"), false, "a closed file is no longer marked");
});
