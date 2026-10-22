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
const { resetRpc, WorktreeSwitcher, useProjectWorkspace } = await loadRenderer(
  "session-sidebar-pickers",
  'export { WorktreeSwitcher } from "./src/renderer/components/session-sidebar/worktree-switcher.tsx";\n' +
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

function SwitcherScene() {
  const workspace = useProjectWorkspace({
    sessions: [],
    selectedCwdProp: "/repo",
    onCwdChange: () => {},
    refreshKey: 0,
  });
  if (!workspace.showWorktreeSwitcher || !workspace.worktreeState)
    return createElement("div", null, "Loading worktrees");
  return createElement(WorktreeSwitcher, {
    worktreeState: workspace.worktreeState,
    selectedCwd: workspace.selectedCwd,
    homeDir: "/Users/tester",
    dropdownOpen: workspace.wtDropdownOpen,
    onToggleDropdown: workspace.toggleWorktreeDropdown,
    onOutsideClickClose: workspace.resetWorktreeDropdownForOutsideClick,
    newOpen: workspace.wtNewOpen,
    onOpenNewEntry: workspace.openNewWorktreeEntry,
    onCloseNewEntry: workspace.closeNewWorktreeEntry,
    newBranch: workspace.wtNewBranch,
    onNewBranchChange: workspace.setNewWorktreeBranch,
    busy: workspace.wtBusy,
    error: workspace.wtError,
    confirmRemovePath: workspace.wtConfirmRemove,
    onCancelRemove: workspace.cancelWorktreeRemove,
    onCreateWorktree: workspace.handleCreateWorktree,
    onRemoveWorktree: workspace.handleRemoveWorktree,
    onSelectWorktree: workspace.handleSelectWorktree,
    deferFocus: (focus) => setTimeout(focus, 0),
  });
}

async function renderSwitcher(t, { removeWorktreeImpl, createWorktreeImpl } = {}) {
  const calls = { removed: [], created: [] };
  const replies = {
    async call(method, params) {
      if (method === "worktrees.list") return GIT_REPO_LIST;
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
  const view = await mount(t, SwitcherScene, {}, { release: () => host.close() });
  return { ...view, calls };
}

async function openWorktreeDropdown(view) {
  const trigger = [...view.container.querySelectorAll("button")].find((control) =>
    control.title.startsWith("Switch worktree"),
  );
  await click(trigger);
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
