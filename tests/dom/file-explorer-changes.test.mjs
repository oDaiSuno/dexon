import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import {
  accessibleName,
  byRole,
  click,
  dom,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "file-explorer-changes",
  'export {FileExplorer} from "./src/renderer/components/FileExplorer.tsx";',
);
api.setAppLanguage("zh-CN");
after(restoreGlobals);
beforeEach(() => dom.window.localStorage.clear());

const PROJECT = "/Users/demo/Developer/personal/btron/dexon";
const PERSONAL = "/Users/demo/Documents/Dexon";

const dir = (name) => ({ name, type: "directory", isDir: true, size: 0, mtime: 0 });
const file = (name) => ({ name, type: "file", isDir: false, size: 1, mtime: 0 });
const TREE = {
  "": [dir("src"), dir("tests"), file("DESIGN.md"), file("notes.md"), file("package.json")],
  src: [dir("renderer"), dir("shared")],
  "src/renderer": [dir("components"), file("globals.css")],
  "src/renderer/components": [file("FileExplorer.tsx"), file("GitStatusBar.tsx")],
  "src/shared": [file("git-status.ts")],
  tests: [file("explorer.test.mjs")],
};

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
const DIRTY = {
  ...CLEAN,
  clean: false,
  staged: 3,
  modified: 5,
  untracked: 2,
  entries: [
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
  ],
};
const MIXED = {
  ...CLEAN,
  clean: false,
  staged: 1,
  modified: 1,
  untracked: 1,
  conflicted: 1,
  entries: [change("AM", "src/a.ts"), change("UU", "src/b.ts"), change("??", "tests/")],
};

async function explorer(t, git, props = {}) {
  const host = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      if (method === "files.watchStart" || method === "files.watchStop") return { ok: true };
      if (method === "git.status") return git;
      if (method === "files.list") {
        const root = [PROJECT, PERSONAL].find((folder) => params.path.startsWith(folder));
        const relative = params.path === root ? "" : params.path.slice(root.length + 1);
        return { entries: TREE[relative] ?? [] };
      }
      throw new Error(`unexpected request ${method}`);
    },
    subscribe() {
      return () => {};
    },
  }));
  const view = await mount(
    t,
    api.FileExplorer,
    {
      cwd: PROJECT,
      homeDir: "/Users/demo",
      personalCwd: PERSONAL,
      activeFilePath: null,
      refreshKey: 0,
      onOpenFile() {},
      ...props,
    },
    { release: host.close },
  );
  await waitFor(() => assert.equal(byRole(view.container, "status"), undefined, "the explorer has loaded"));
  await waitFor(() => assert.ok(byRole(view.container, "heading"), "the section heading is shown"));
  return view;
}

function shown(element, boundary) {
  for (let node = element; node && node !== boundary.parentElement; node = node.parentElement) {
    const style = dom.window.getComputedStyle(node);
    if (node.hidden || style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

const shownButtons = (view) => [...view.container.querySelectorAll("button")].filter((b) => shown(b, view.container));
const shownButton = (view, name) => shownButtons(view).find((b) => accessibleName(b) === name);
const shownRows = (view, name) => shownButtons(view).filter((b) => accessibleName(b) === `打开文件 ${name}`);

const GROUP = /^(已暂存|已修改|未跟踪|冲突) \d+$/;
const outline = (view) =>
  shownButtons(view)
    .map(accessibleName)
    .filter((name) => GROUP.test(name) || name.startsWith("打开文件 "));

const parts = (row) =>
  [...row.querySelectorAll("*")]
    .filter((node) => node.children.length === 0 && shown(node, row))
    .map((node) => node.textContent.trim())
    .filter(Boolean);

const toggle = (view) => shownButton(view, "仅看改动");
const heading = (view) => byRole(view.container, "heading")?.textContent.trim();

async function showChanges(view) {
  await waitFor(() => assert.ok(toggle(view), "the changes-only toggle is offered"));
  await click(toggle(view));
  await waitFor(() => assert.equal(heading(view), "改动"));
}

test("a Git project's Files header offers a changes-only toggle that starts off, and a folder without Git has none", async (t) => {
  const view = await explorer(t, DIRTY);
  await waitFor(() => assert.ok(toggle(view), "the toggle sits in the Files header"));
  assert.equal(toggle(view).getAttribute("aria-pressed"), "false");
  assert.equal(heading(view), "文件");
  assert.ok(shownButton(view, "全部折叠"), "collapse all is still offered next to it");
  await view.unmount();

  const plain = await explorer(t, NOT_GIT, { cwd: PERSONAL });
  assert.equal(heading(plain), "文件");
  assert.equal(toggle(plain), undefined, "a folder without Git cannot filter by changes");
});

test("turning on changes-only swaps the file tree for the changed files grouped as staged, modified and untracked", async (t) => {
  const view = await explorer(t, DIRTY);
  await showChanges(view);
  assert.equal(toggle(view).getAttribute("aria-pressed"), "true");
  assert.equal(shownButton(view, "全部折叠"), undefined, "collapse all has nothing to collapse here");
  assert.equal(shownButton(view, "展开文件夹 src"), undefined, "the file tree is out of sight");
  assert.deepEqual(outline(view), [
    "已暂存 3",
    "打开文件 GitStatusBar.tsx",
    "打开文件 git-status.ts",
    "打开文件 api-types.ts",
    "已修改 5",
    "打开文件 FileExplorer.tsx",
    "打开文件 FileIcons.tsx",
    "打开文件 globals.css",
    "打开文件 project.ts",
    "打开文件 DESIGN.md",
    "未跟踪 2",
    "打开文件 notes.md",
    "打开文件 explorer.test.mjs",
  ]);
  assert.deepEqual(parts(shownRows(view, "GitStatusBar.tsx")[0]), ["GitStatusBar.tsx", "src/renderer/components", "A"]);
  assert.deepEqual(parts(shownRows(view, "git-status.ts")[0]), ["git-status.ts", "src/shared", "M"]);
  assert.deepEqual(parts(shownRows(view, "project.ts")[0]), ["project.ts", "src/agent-host/handlers", "M"]);
  assert.deepEqual(parts(shownRows(view, "DESIGN.md")[0]), ["DESIGN.md", "M"], "a file at the top has no folder");
  assert.deepEqual(parts(shownRows(view, "explorer.test.mjs")[0]), ["explorer.test.mjs", "tests", "U"]);
  assert.equal(shownButton(view, "已暂存 3").getAttribute("aria-expanded"), "true");
});

test("clicking a changed file opens it, and the file already open is marked as the current row", async (t) => {
  const opened = [];
  const active = `${PROJECT}/src/renderer/components/FileExplorer.tsx`;
  const view = await explorer(t, DIRTY, {
    activeFilePath: active,
    onOpenFile: (path, name) => opened.push([path, name]),
  });
  await showChanges(view);
  assert.equal(shownRows(view, "FileExplorer.tsx")[0].getAttribute("aria-current"), "true");
  assert.equal(shownRows(view, "DESIGN.md")[0].hasAttribute("aria-current"), false);
  await click(shownRows(view, "project.ts")[0]);
  assert.deepEqual(opened, [[`${PROJECT}/src/agent-host/handlers/project.ts`, "project.ts"]]);
});

test("a group header folds its files away and brings them back", async (t) => {
  const view = await explorer(t, DIRTY);
  await showChanges(view);
  await click(shownButton(view, "已修改 5"));
  assert.equal(shownButton(view, "已修改 5").getAttribute("aria-expanded"), "false");
  assert.deepEqual(shownRows(view, "FileExplorer.tsx"), [], "the folded group's files are hidden");
  assert.equal(shownRows(view, "notes.md").length, 1, "other groups stay open");
  await click(shownButton(view, "已修改 5"));
  assert.equal(shownButton(view, "已修改 5").getAttribute("aria-expanded"), "true");
  assert.equal(shownRows(view, "FileExplorer.tsx").length, 1);
});

test("a file staged and then changed again is listed in both groups, conflicts get their own group, and an untracked folder cannot be opened as a file", async (t) => {
  const view = await explorer(t, MIXED);
  await showChanges(view);
  assert.deepEqual(outline(view), [
    "已暂存 1",
    "打开文件 a.ts",
    "已修改 1",
    "打开文件 a.ts",
    "未跟踪 1",
    "冲突 1",
    "打开文件 b.ts",
  ]);
  const [staged, modified] = shownRows(view, "a.ts");
  assert.deepEqual(parts(staged), ["a.ts", "src", "A"]);
  assert.deepEqual(parts(modified), ["a.ts", "src", "M"]);
  assert.deepEqual(parts(shownRows(view, "b.ts")[0]), ["b.ts", "src", "!"]);
  const folder = [...view.container.querySelectorAll("*")].filter(
    (node) => node.children.length === 0 && node.textContent.trim() === "tests" && shown(node, view.container),
  );
  assert.equal(folder.length, 1, "the untracked folder is still listed");
});

test("a clean project in changes-only view says there are no changes", async (t) => {
  const view = await explorer(t, CLEAN);
  await showChanges(view);
  assert.deepEqual(outline(view), []);
  const message = [...view.container.querySelectorAll("*")].find(
    (node) => node.children.length === 0 && node.textContent.trim() === "没有改动" && shown(node, view.container),
  );
  assert.ok(message, "the empty list explains itself");
});

test("turning changes-only off brings the file tree back with the folders that were open still open", async (t) => {
  const view = await explorer(t, DIRTY);
  await click(shownButton(view, "展开文件夹 src"));
  await waitFor(() => assert.ok(shownButton(view, "展开文件夹 renderer"), "src is open"));
  await showChanges(view);
  await click(toggle(view));
  await waitFor(() => assert.equal(heading(view), "文件"));
  assert.equal(toggle(view).getAttribute("aria-pressed"), "false");
  assert.ok(shownButton(view, "收起文件夹 src"), "src is still open");
  assert.ok(shownButton(view, "展开文件夹 renderer"), "its folders are listed without reopening it");
  assert.ok(shownButton(view, "全部折叠"));
  assert.equal(outline(view).filter((name) => GROUP.test(name)).length, 0, "the change groups are gone");
});

test("the explorer remembers the changes-only choice the next time it opens, both on and off", async (t) => {
  const first = await explorer(t, DIRTY);
  await showChanges(first);
  await first.unmount();

  const second = await explorer(t, DIRTY);
  await waitFor(() => assert.equal(heading(second), "改动"));
  assert.equal(toggle(second).getAttribute("aria-pressed"), "true");
  await waitFor(() => assert.equal(shownRows(second, "notes.md").length, 1, "it opens straight on the changes"));
  await click(toggle(second));
  await waitFor(() => assert.equal(heading(second), "文件"));
  await second.unmount();

  const third = await explorer(t, DIRTY);
  assert.equal(heading(third), "文件");
  assert.equal(toggle(third).getAttribute("aria-pressed"), "false");
});

test("a remembered changes-only choice still shows the plain file tree in a folder without Git", async (t) => {
  const project = await explorer(t, DIRTY);
  await showChanges(project);
  await project.unmount();

  const plain = await explorer(t, NOT_GIT, { cwd: PERSONAL });
  assert.equal(heading(plain), "文件");
  assert.equal(toggle(plain), undefined);
  assert.ok(shownButton(plain, "展开文件夹 src"), "the personal folder lists its own file tree");
  assert.equal(shownRows(plain, "notes.md").length, 1);
});
