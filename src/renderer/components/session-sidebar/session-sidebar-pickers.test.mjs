import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  createElement,
  dom,
  input,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../../../../tests/support/renderer.mjs";
import { installApiHostBridge } from "../../../../tests/support/api-host.mjs";

after(restoreGlobals);
const { resetRpc, WorkspaceTrigger, useComposerWorkspace, useProjectWorkspace } = await loadRenderer(
  "session-sidebar-pickers",
  'export { WorkspaceTrigger } from "./src/renderer/components/chat-input/workspace-trigger.tsx";\n' +
    'export { useComposerWorkspace } from "./src/renderer/components/app-shell/composer-workspace.ts";\n' +
    'export { useProjectWorkspace } from "./src/renderer/components/session-sidebar/project-workspace.ts";',
);

async function outsideMousedown() {
  await act(async () =>
    dom.window.document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })),
  );
}

const GIT_REPO_LIST = {
  projectRoot: "/repo",
  isGit: true,
  isTopLevel: true,
  worktrees: [
    { path: "/repo", branch: "main", isMain: true },
    { path: "/repo/wt", branch: "feat", isMain: false },
  ],
};

function SwitcherScene({ cwd }) {
  const workspace = useProjectWorkspace({
    sessions: [],
    selectedCwdProp: cwd,
    onCwdChange: () => {},
    refreshKey: 0,
  });
  const composer = useComposerWorkspace({
    workspace,
    project: { name: "repo", path: "/repo", displayPath: "/repo" },
    onSwitchProject: () => {},
    onOpenInFinder: async () => {},
    onCopyPath: async () => {},
  });
  return composer ? createElement(WorkspaceTrigger, { workspace: composer, isMobile: false }) : null;
}

async function renderSwitcher(t, { removeWorktreeImpl, createWorktreeImpl, cwd = "/repo", list = GIT_REPO_LIST } = {}) {
  const calls = { listed: 0, removed: [], created: [] };
  const replies = {
    async call(method, params) {
      if (method === "worktrees.list") {
        calls.listed++;
        return list;
      }
      if (method === "worktrees.create") {
        calls.created.push(params.branch);
        return createWorktreeImpl?.(params.branch) ?? { worktree: { path: "/repo/wt2", branch: params.branch } };
      }
      if (method === "worktrees.remove") {
        calls.removed.push([params.path, params.force]);
        return removeWorktreeImpl?.(params.path, params.force) ?? {};
      }
      throw new Error(`unexpected rpc ${method}`);
    },
  };
  const host = installApiHostBridge(dom.window, () => replies, resetRpc);
  const view = await mount(t, SwitcherScene, { cwd }, { release: () => host.close() });
  await waitFor(() => assert.ok(calls.listed > 0));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return { ...view, calls };
}

function worktreeTrigger(view) {
  return [...view.container.querySelectorAll("button")].find((control) => control.title.startsWith("Switch worktree"));
}

async function openWorktreeDropdown(view) {
  await click(worktreeTrigger(view));
  assert.ok([...view.container.querySelectorAll("button")].some((control) => control.title === "/repo"));
}

async function expectWorktreeDropdownClosed(view) {
  await waitFor(() =>
    assert.equal(
      [...view.container.querySelectorAll("button")].some((control) => control.title === "/repo"),
      false,
    ),
  );
}

async function openNewWorktree(view) {
  await openWorktreeDropdown(view);
  await click(
    [...view.container.querySelectorAll("button")].find((control) => control.textContent.includes("New worktree")),
  );
  return view.container.querySelector("input");
}

test("a checkout switch and a worktree creation take effect at once", async (t) => {
  const view = await renderSwitcher(t);
  await openWorktreeDropdown(view);
  await click([...view.container.querySelectorAll("button")].find((control) => control.title === "/repo/wt"));
  await waitFor(() => assert.equal(worktreeTrigger(view).title, "Switch worktree: /repo/wt"));

  const branch = await openNewWorktree(view);
  await input(branch, "feat-2");
  await keyDown(branch, "Enter");
  await waitFor(() => assert.equal(worktreeTrigger(view).title, "Switch worktree: /repo/wt2"));
  assert.deepEqual(view.calls.created, ["feat-2"]);
});

test("a dirty removal surfaces the inline confirmation until it is resolved", async (t) => {
  const view = await renderSwitcher(t, {
    removeWorktreeImpl: (_path, force) =>
      force
        ? Promise.resolve({})
        : Promise.reject(Object.assign(new Error("dirty worktree"), { detail: { dirty: true } })),
  });
  await openWorktreeDropdown(view);
  await click(
    [...view.container.querySelectorAll("button")].find((control) =>
      control.title.includes("Remove worktree checkout"),
    ),
  );
  assert.deepEqual(view.calls.removed, [["/repo/wt", false]]);
  assert.match(view.container.textContent, /Uncommitted changes\./);
  await outsideMousedown();
  await expectWorktreeDropdownClosed(view);
  await openWorktreeDropdown(view);
  assert.doesNotMatch(view.container.textContent, /Uncommitted changes\./);
});

test("creating a worktree submits the branch and closes the entry on success", async (t) => {
  const view = await renderSwitcher(t);
  const branch = await openNewWorktree(view);
  await input(branch, "feat-2");
  await keyDown(branch, "Enter");
  assert.deepEqual(view.calls.created, ["feat-2"]);
  await expectWorktreeDropdownClosed(view);
});

test("a failed creation keeps the entry open and shows the error", async (t) => {
  const view = await renderSwitcher(t, {
    createWorktreeImpl: () => Promise.reject(new Error("branch already exists")),
  });
  const branch = await openNewWorktree(view);
  await input(branch, "feat-2");
  await keyDown(branch, "Enter");
  assert.match(view.container.textContent, /branch already exists/);
  assert.ok(view.container.querySelector("input"));
  assert.deepEqual(view.calls.created, ["feat-2"], "one submission produces only one create request");
});

test("escape closes the new-worktree entry without submitting", async (t) => {
  const view = await renderSwitcher(t);
  const branch = await openNewWorktree(view);
  await input(branch, "feat-2");
  await keyDown(branch, "Escape");
  assert.deepEqual(view.calls.created, []);
  assert.equal(view.container.querySelector("input"), null);
});

const SUBDIRECTORY_LIST = {
  projectRoot: "/repo/src",
  isGit: true,
  isTopLevel: false,
  worktrees: GIT_REPO_LIST.worktrees,
};
const PLAIN_LIST = { projectRoot: "/plain", isGit: false, isTopLevel: true, worktrees: [] };

test("in a Git checkout the footer trigger shows the current branch next to the project", async (t) => {
  const view = await renderSwitcher(t);
  await waitFor(() => assert.match(worktreeTrigger(view).textContent, /main/));
});

test("in a repository subdirectory the footer trigger shows only the project, never the main branch", async (t) => {
  const view = await renderSwitcher(t, { cwd: "/repo/src", list: SUBDIRECTORY_LIST });
  assert.equal(worktreeTrigger(view), undefined, "a subdirectory offers no checkout switch");
  assert.doesNotMatch(view.container.textContent, /main|feat/);
});

test("in a folder outside Git the footer trigger shows only the project", async (t) => {
  const view = await renderSwitcher(t, { cwd: "/plain", list: PLAIN_LIST });
  assert.equal(worktreeTrigger(view), undefined);
  assert.doesNotMatch(view.container.textContent, /main|feat/);
});

test("removing another worktree is sent at once", async (t) => {
  const view = await renderSwitcher(t);
  await openWorktreeDropdown(view);
  await click(
    [...view.container.querySelectorAll("button")].find((control) =>
      control.title.includes("Remove worktree checkout"),
    ),
  );
  assert.deepEqual(view.calls.removed, [["/repo/wt", false]]);
});
