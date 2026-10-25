import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  button,
  byRole,
  click,
  dom,
  loadRenderer,
  mount,
  restoreGlobals,
  text,
  waitFor,
} from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "git-compare",
  'export {TextFileViewer} from "./src/renderer/components/file-viewer/text-file-viewer.tsx"; export {DiffView} from "./src/renderer/components/file-viewer/diff-view.tsx"; export {FileExplorer} from "./src/renderer/components/FileExplorer.tsx"; export {RightPanelDock} from "./src/renderer/components/app-shell/right-panel-dock.tsx";',
);
api.setAppLanguage("zh-CN");
after(restoreGlobals);

const PROJECT = "/Users/demo/project";
const FILE = `${PROJECT}/src/sample.ts`;
const STATUS = {
  isGit: true,
  branch: "feat/explorer-redesign",
  clean: true,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflicted: 0,
  entries: [],
  upstream: null,
};

function host(t, reply) {
  const watchers = [];
  const installed = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      if (method === "files.watchStart" || method === "files.watchStop") return { ok: true };
      const answer = reply(method, params);
      if (answer === undefined) throw new Error(`unexpected request ${method}`);
      return answer;
    },
    subscribe(topic, key, listener) {
      if (topic === "files.changed") watchers.push(listener);
      return () => {};
    },
  }));
  t.after(() => installed.close());
  return {
    async changed() {
      await waitFor(() => assert.ok(watchers.length > 0, "the file is being watched"));
      await act(async () => {
        for (const listener of watchers) listener({ event: "change", path: FILE });
      });
    },
  };
}

const readReply = (content) => ({ content, language: "typescript", encoding: "utf8", size: content.length });
const modeButton = (container, name) =>
  [...container.querySelectorAll("[data-file-mode]")].find((node) => node.textContent.startsWith(name));

test("a committed code file that differs from its last commit offers a Changes view with the real added and removed line counts, compared with HEAD", async (t) => {
  host(t, (method) => {
    if (method === "files.read") return readReply("a\nB\nc\nd\n");
    if (method === "git.headContent") return { comparable: true, content: "a\nb\nc\n" };
  });
  const view = await mount(t, api.TextFileViewer, { filePath: FILE, cwd: PROJECT });
  await waitFor(() => assert.ok(modeButton(view.container, "改动"), "the Changes view is offered"));
  assert.match(modeButton(view.container, "改动").textContent, /\+2 −1/);
  await click(modeButton(view.container, "改动"));
  assert.ok(text(view.container, "与 HEAD 比较"), "the changes view says what it compares against");
  assert.ok(text(view.container, "B"), "the new line is shown");
  assert.ok(text(view.container, "b"), "the removed line is shown");
});

test("a committed code file without changes still offers the Changes view, which says there are no changes", async (t) => {
  host(t, (method) => {
    if (method === "files.read") return readReply("same\n");
    if (method === "git.headContent") return { comparable: true, content: "same\n" };
  });
  const view = await mount(t, api.TextFileViewer, { filePath: FILE, cwd: PROJECT });
  await waitFor(() => assert.ok(modeButton(view.container, "改动")));
  assert.doesNotMatch(modeButton(view.container, "改动").textContent, /\+|−/, "no counts when nothing changed");
  await click(modeButton(view.container, "改动"));
  assert.ok(text(view.container, "没有更改"));
});

test("a file that cannot be compared with Git offers no Changes view, even after it changes on disk while open", async (t) => {
  let content = "first\n";
  const boundary = host(t, (method) => {
    if (method === "files.read") return readReply(content);
    if (method === "git.headContent") return { comparable: false, content: "" };
  });
  const view = await mount(t, api.TextFileViewer, { filePath: FILE, cwd: PROJECT });
  await waitFor(() => assert.ok(text(view.container, "first")));
  content = "second\n";
  await boundary.changed();
  await waitFor(() => assert.ok(text(view.container, "second"), "the new text is shown"));
  assert.equal(Boolean(modeButton(view.container, "改动")), false, "changes since opening are no longer offered");
});

const lines = (edit) => Array.from({ length: 40 }, (_, index) => edit(index + 1) ?? `line ${index + 1}`).join("\n");
const OLD = lines((n) => (n === 5 ? "old five" : n === 35 ? "old thirty-five" : undefined));
const NEW = lines((n) => (n === 5 ? "new five" : n === 35 ? "new thirty-five" : undefined));

test("every change block in the changes view starts with its own line-range title", async (t) => {
  const view = await mount(t, api.DiffView, {
    oldContent: OLD,
    newContent: NEW,
    language: "plaintext",
    wrapLines: false,
  });
  assert.ok(text(view.container, "@@ −2,7 +2,7 @@"), "the first block has a title");
  assert.ok(text(view.container, "@@ −32,7 +32,7 @@"), "the second block has a title too");
});

test("the unchanged lines between two change blocks can be expanded and then folded away again", async (t) => {
  const view = await mount(t, api.DiffView, {
    oldContent: OLD,
    newContent: NEW,
    language: "plaintext",
    wrapLines: false,
  });
  const fold = () => button(view.container, /23 行未更改/);
  assert.ok(fold(), "the 23 hidden lines between the blocks are announced");
  assert.equal(fold().getAttribute("aria-expanded"), "false");
  assert.equal(Boolean(text(view.container, "line 20")), false);
  await click(fold());
  assert.ok(text(view.container, "line 20"), "expanding shows the hidden lines");
  assert.equal(fold().getAttribute("aria-expanded"), "true", "the fold row stays so it can be folded again");
  await click(fold());
  assert.equal(Boolean(text(view.container, "line 20")), false, "folding hides them again");
  assert.equal(fold().getAttribute("aria-expanded"), "false");
});

function explorerReplies({
  status = STATUS,
  branch = { isGit: true, branch: "feat/explorer-redesign" },
  pending = false,
} = {}) {
  return (method) => {
    if (method === "git.branch") return branch;
    if (pending && (method === "git.status" || method === "files.list")) return new Promise(() => {});
    if (method === "git.status") return status;
    if (method === "files.list")
      return { entries: [{ name: "README.md", path: "README.md", type: "file", isDir: false, size: 1, mtime: 0 }] };
  };
}

const explorerProps = {
  cwd: PROJECT,
  homeDir: "/Users/demo",
  personalCwd: null,
  activeFilePath: null,
  refreshKey: 0,
  onOpenFile() {},
};

test("while the project is still loading, the branch row already names the branch and says it is reading", async (t) => {
  host(t, explorerReplies({ pending: true }));
  const view = await mount(t, api.FileExplorer, explorerProps);
  await waitFor(() =>
    assert.ok(text(view.container, "feat/explorer-redesign"), "the branch is shown before the status arrives"),
  );
  assert.ok(text(view.container, "读取中…"));
});

test("a clean branch says whether it is in sync with, ahead of, or behind its remote branch", async (t) => {
  for (const [upstream, expected] of [
    [{ ahead: 0, behind: 0 }, "已与远端同步"],
    [{ ahead: 2, behind: 0 }, "领先 2"],
    [{ ahead: 0, behind: 3 }, "落后 3"],
    [{ ahead: 1, behind: 4 }, "领先 1 · 落后 4"],
  ]) {
    await t.test(expected, async (st) => {
      host(st, explorerReplies({ status: { ...STATUS, upstream } }));
      const view = await mount(st, api.FileExplorer, explorerProps);
      await waitFor(() => assert.ok(text(view.container, expected)));
    });
  }
});

test("a clean branch without a remote branch claims no sync state", async (t) => {
  host(t, explorerReplies());
  const view = await mount(t, api.FileExplorer, explorerProps);
  await waitFor(() => assert.ok(text(view.container, "README.md")));
  assert.equal(Boolean(text(view.container, "已与远端同步")), false);
  assert.equal(Boolean(text(view.container, "读取中…")), false);
});

const noop = () => {};
function dock(fileTabs) {
  return {
    activeFileTabId: "explorer",
    fileTabs,
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
    personalCwd: null,
    homeDir: "/Users/demo",
  };
}

test("file tabs of files that differ from the last commit carry a changed mark, and unchanged files do not", async (t) => {
  const status = {
    ...STATUS,
    clean: false,
    modified: 1,
    untracked: 1,
    entries: [
      { index: " ", workingTree: "M", path: "src/changed.ts" },
      { index: "?", workingTree: "?", path: "drafts/" },
    ],
  };
  host(t, explorerReplies({ status }));
  const tab = (name) => ({
    id: `file:${PROJECT}/${name}`,
    label: name.split("/").pop(),
    filePath: `${PROJECT}/${name}`,
  });
  const view = await mount(
    t,
    api.RightPanelDock,
    dock([tab("src/changed.ts"), tab("src/clean.ts"), tab("drafts/idea.md")]),
  );
  const holder = (label) => byRole(view.container, "button", label).parentElement;
  await waitFor(() => assert.ok(byRole(holder("changed.ts"), "img", "已改动"), "the modified file is marked"));
  assert.ok(byRole(holder("idea.md"), "img", "已改动"), "a file inside a new folder is marked");
  assert.equal(Boolean(byRole(holder("clean.ts"), "img", "已改动")), false, "an unchanged file is not marked");
  assert.ok(button(holder("changed.ts"), "关闭 changed.ts"), "the close button is still there for a changed file");
});
