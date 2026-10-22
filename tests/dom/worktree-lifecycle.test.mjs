import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred, createManualScheduler } from "#test-timing";
import { act, click, createElement, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";

after(restoreGlobals);
const { resetRpc, useProjectWorkspace, WorktreeSwitcher } = await loadRenderer(
  "worktree-lifecycle-dom",
  'export {useProjectWorkspace} from "./src/renderer/components/session-sidebar/project-workspace.ts";\n' +
    'export {WorktreeSwitcher} from "./src/renderer/components/session-sidebar/worktree-switcher.tsx";',
  { define: { setTimeout: "window.setTimeout", clearTimeout: "window.clearTimeout" } },
);

const git = {
  projectRoot: "/repo",
  isGit: true,
  isTopLevel: true,
  worktrees: [
    { path: "/repo", branch: "main", isMain: true },
    { path: "/repo/wt", branch: "feat", isMain: false },
  ],
};

function WorkspaceScene({ cwd }) {
  const workspace = useProjectWorkspace({ sessions: [], selectedCwdProp: cwd, onCwdChange: () => {}, refreshKey: 0 });
  if (!workspace.showWorktreeSwitcher || !workspace.worktreeState) return null;
  return createElement(WorktreeSwitcher, {
    worktreeState: workspace.worktreeState,
    selectedCwd: workspace.selectedCwd,
    homeDir: "",
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
    deferFocus: (focus) => dom.window.setTimeout(focus, 0),
  });
}

async function workspace(t, props, remove = async () => ({})) {
  const clock = createManualScheduler();
  const originals = ["setTimeout", "clearTimeout"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(dom.window, name),
  ]);
  dom.window.setTimeout = clock.setTimeout;
  dom.window.clearTimeout = clock.clearTimeout;
  const removals = [];
  const host = installApiHostBridge(
    dom.window,
    () => ({
      async call(method, params) {
        if (method === "worktrees.list")
          return params.projectRoot === "/repo"
            ? git
            : { projectRoot: params.projectRoot, isGit: false, isTopLevel: true, worktrees: [] };
        if (method === "worktrees.remove") {
          removals.push(params);
          return remove();
        }
        throw new Error(`unexpected worktree request ${method}`);
      },
    }),
    resetRpc,
  );
  const view = await mount(t, WorkspaceScene, props, {
    release() {
      try {
        host.close();
      } finally {
        for (const [name, descriptor] of originals) Object.defineProperty(dom.window, name, descriptor);
      }
    },
  });
  return { ...view, clock, removals };
}

const removalButton = (view) =>
  [...view.container.querySelectorAll("button")].find((control) => control.title.includes("Remove worktree checkout"));
const trigger = (view) =>
  [...view.container.querySelectorAll("button")].find((control) => control.title.startsWith("Switch worktree"));

test("an in-flight removal stays protected when the switcher disappears and returns", async (t) => {
  const response = createDeferred();
  const view = await workspace(t, { cwd: "/repo" }, () => response.promise);
  await click(trigger(view));
  await click(removalButton(view));
  assert.equal(view.removals.length, 1);
  await view.update({ cwd: "/other" });
  assert.equal(removalButton(view), undefined);
  await view.update({ cwd: "/repo" });
  if (!removalButton(view)) await click(trigger(view));
  const protectedControl = removalButton(view);
  assert.ok(protectedControl);
  assert.equal(protectedControl.disabled, true, "the returned view cannot submit another pending removal");
  await act(async () => protectedControl.click());
  assert.equal(view.removals.length, 1, "disabled interaction produces no duplicate removal");
  await act(async () => response.reject(Object.assign(new Error("dirty worktree"), { detail: { dirty: true } })));
  assert.match(view.container.textContent, /Uncommitted changes\./);
});
