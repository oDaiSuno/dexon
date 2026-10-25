import assert from "node:assert/strict";
import test, { after } from "node:test";
import { button, click, dom, hover, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "file-explorer-tree",
  'export {FileExplorer} from "./src/renderer/components/FileExplorer.tsx";',
);
api.setAppLanguage("zh-CN");
after(restoreGlobals);

const PROJECT = "/Users/demo/Developer/personal/btron/dexon";

const dir = (name) => ({ name, type: "directory", isDir: true, size: 0, mtime: 0 });
const file = (name) => ({ name, type: "file", isDir: false, size: 1, mtime: 0 });
const TREE = {
  "": [dir("src"), dir("tests"), file("DESIGN.md"), file("notes.md"), file("package.json")],
  src: [dir("renderer"), dir("shared")],
  "src/renderer": [dir("components"), file("globals.css")],
  "src/renderer/components": [file("FileExplorer.tsx"), file("GitStatusBar.tsx"), file("TabBar.tsx")],
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
const CLEAN = { ...NOT_GIT, isGit: true, branch: "main" };
const change = (code, path) => ({ index: code[0], workingTree: code[1], path });
const DIRTY_ENTRIES = [
  change("A ", "src/renderer/components/GitStatusBar.tsx"),
  change("M ", "src/shared/git-status.ts"),
  change(" M", "src/renderer/components/FileExplorer.tsx"),
  change(" M", "DESIGN.md"),
  change("??", "notes.md"),
  change("??", "tests/"),
];
const DIRTY = { ...CLEAN, clean: false, staged: 2, modified: 2, untracked: 2, entries: DIRTY_ENTRIES };
const CONFLICTED = {
  ...DIRTY,
  conflicted: 1,
  entries: [...DIRTY_ENTRIES, change("UU", "src/renderer/globals.css")],
};

async function explorer(t, git, props = {}) {
  const host = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      if (method === "files.watchStart" || method === "files.watchStop") return { ok: true };
      if (method === "git.status") return git;
      if (method === "files.list") {
        const relative = params.path === PROJECT ? "" : params.path.slice(PROJECT.length + 1);
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
      personalCwd: null,
      activeFilePath: null,
      refreshKey: 0,
      onOpenFile() {},
      ...props,
    },
    { release: host.close },
  );
  await waitFor(() => assert.ok(fileRow(view, "DESIGN.md"), "the file tree has loaded"));
  return view;
}

const fileRow = (view, name) => button(view.container, `打开文件 ${name}`);
const folderRow = (view, name) =>
  button(view.container, `展开文件夹 ${name}`) ?? button(view.container, `收起文件夹 ${name}`);

async function open(view, ...names) {
  for (const name of names) {
    await waitFor(() => assert.ok(button(view.container, `展开文件夹 ${name}`), `folder ${name} is listed`));
    await click(button(view.container, `展开文件夹 ${name}`));
  }
}

function shown(element, boundary) {
  for (let node = element; node && node !== boundary.parentElement; node = node.parentElement) {
    const style = dom.window.getComputedStyle(node);
    if (node.hidden || style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

function letters(row, name) {
  const spoken = new Set(row.getAttribute("aria-describedby")?.trim().split(/\s+/) ?? []);
  const isDescription = (node) => {
    for (let current = node; current && current !== row; current = current.parentElement) {
      if (spoken.has(current.id)) return true;
    }
    return false;
  };
  return [...row.querySelectorAll("*")]
    .filter((node) => node.children.length === 0 && shown(node, row) && !isDescription(node))
    .map((node) => node.textContent.trim())
    .filter((value) => value && value !== name && value.length <= 2);
}

function description(row) {
  const ids = row.getAttribute("aria-describedby")?.trim().split(/\s+/) ?? [];
  const value = ids
    .map((id) => row.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
  return value || undefined;
}

function fileMark(view, name) {
  const row = fileRow(view, name);
  assert.ok(row, `file ${name} is listed`);
  return { letters: letters(row, name), description: description(row) };
}

function folderMark(view, name) {
  const row = folderRow(view, name);
  assert.ok(row, `folder ${name} is listed`);
  return description(row);
}

test("in a project with changes, each changed file shows its Git letter and every folder holding changes says so", async (t) => {
  const view = await explorer(t, DIRTY);
  await open(view, "src", "renderer", "components", "shared", "tests");
  assert.deepEqual(fileMark(view, "DESIGN.md"), { letters: ["M"], description: "已修改" });
  assert.deepEqual(fileMark(view, "FileExplorer.tsx"), { letters: ["M"], description: "已修改" });
  assert.deepEqual(fileMark(view, "GitStatusBar.tsx"), { letters: ["A"], description: "已暂存" });
  assert.deepEqual(fileMark(view, "git-status.ts"), { letters: ["M"], description: "已暂存" });
  assert.deepEqual(fileMark(view, "notes.md"), { letters: ["U"], description: "未跟踪" });
  assert.deepEqual(
    fileMark(view, "explorer.test.mjs"),
    { letters: ["U"], description: "未跟踪" },
    "a file inside a folder Git reports as untracked is untracked too",
  );
  assert.deepEqual(fileMark(view, "package.json"), { letters: [], description: undefined });
  assert.deepEqual(fileMark(view, "TabBar.tsx"), { letters: [], description: undefined });
  assert.deepEqual(fileMark(view, "globals.css"), { letters: [], description: undefined });
  assert.equal(folderMark(view, "src"), "含改动");
  assert.equal(folderMark(view, "renderer"), "含改动");
  assert.equal(folderMark(view, "components"), "含改动");
  assert.equal(folderMark(view, "shared"), "含改动", "a folder whose only changes are staged still counts as changed");
  assert.equal(folderMark(view, "tests"), "含未跟踪文件");
});

test("a conflicted file shows an exclamation mark and the folders above it report the conflict ahead of other changes", async (t) => {
  const view = await explorer(t, CONFLICTED);
  await open(view, "src", "renderer", "components", "shared");
  assert.deepEqual(fileMark(view, "globals.css"), { letters: ["!"], description: "冲突" });
  assert.equal(folderMark(view, "src"), "含冲突");
  assert.equal(folderMark(view, "renderer"), "含冲突");
  assert.equal(folderMark(view, "components"), "含改动");
  assert.equal(folderMark(view, "shared"), "含改动");
  assert.equal(folderMark(view, "tests"), "含未跟踪文件");
});

test("a clean project and a folder without Git show no change marks on any row", async (t) => {
  for (const git of [CLEAN, NOT_GIT]) {
    await t.test(git.isGit ? "clean" : "not git", async (t) => {
      const view = await explorer(t, git);
      await open(view, "src");
      assert.deepEqual(fileMark(view, "DESIGN.md"), { letters: [], description: undefined });
      assert.equal(folderMark(view, "src"), undefined);
      assert.equal(folderMark(view, "shared"), undefined);
    });
  }
});

test("while a changed file's row is hovered, its letter gives way to the mention and download buttons but stays described", async (t) => {
  const view = await explorer(t, DIRTY, { onAtMention() {} });
  const row = fileRow(view, "DESIGN.md");
  assert.deepEqual(letters(row, "DESIGN.md"), ["M"], "before hovering the row shows its letter");
  await hover(row);
  await waitFor(() => assert.ok(button(view.container, "下载文件"), "the download button appears"));
  assert.ok(button(view.container, "引用"), "the mention button appears");
  assert.deepEqual(letters(fileRow(view, "DESIGN.md"), "DESIGN.md"), [], "the letter is no longer shown");
  assert.equal(description(fileRow(view, "DESIGN.md")), "已修改", "screen readers still hear the change");
});

test("collapse all closes every open folder, including folders nested inside other folders", async (t) => {
  const view = await explorer(t, DIRTY);
  await open(view, "src", "renderer");
  await waitFor(() => assert.ok(folderRow(view, "components"), "nested folders are listed"));
  await click(button(view.container, "全部折叠"));
  assert.ok(button(view.container, "展开文件夹 src"), "the top folder is collapsed");
  assert.equal(folderRow(view, "renderer"), undefined, "nested folders are no longer listed");
  await click(button(view.container, "展开文件夹 src"));
  await waitFor(() => assert.ok(folderRow(view, "renderer")));
  assert.ok(
    button(view.container, "展开文件夹 renderer"),
    "reopening the top folder keeps the nested folder collapsed",
  );
});
