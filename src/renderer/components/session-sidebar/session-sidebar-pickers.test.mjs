import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  button,
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
const { resetRpc, ProjectPicker, WorktreeSwitcher, useProjectWorkspace } = await loadRenderer(
  "session-sidebar-pickers",
  'export { ProjectPicker } from "./src/renderer/components/session-sidebar/project-picker.tsx";\n' +
    'export { WorktreeSwitcher } from "./src/renderer/components/session-sidebar/worktree-switcher.tsx";\n' +
    'export { useProjectWorkspace } from "./src/renderer/components/session-sidebar/project-workspace.ts";',
);

function createPickerProps(overrides = {}) {
  const calls = { selectedProjects: [], customPaths: [], defaultCwd: 0 };
  return {
    props: {
      selectedCwd: "/repo",
      selectedProject: "/repo",
      homeDir: "/Users/tester",
      recentProjects: ["/repo", "/other-1", "/other-2"],
      suppressPlaceholder: false,
      onSelectProject: (project) => calls.selectedProjects.push(project),
      selectCustomCwd: async (value) => {
        calls.customPaths.push(value);
        return { status: "selected" };
      },
      selectDefaultCwd: async () => {
        calls.defaultCwd += 1;
        return true;
      },
      selectDirectoryFromPicker: async () => ({ status: "selected" }),
      deferFocus: (focus) => setTimeout(focus, 0),
      ...overrides,
    },
    calls,
  };
}

function projectRows(container, projects) {
  const trigger = container.querySelector("button");
  return [...container.querySelectorAll("button")].filter(
    (control) => control !== trigger && projects.includes(control.title),
  );
}

async function outsideMousedown() {
  await act(async () =>
    dom.window.document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true })),
  );
}

test("lists projects, selects one, and closes the dropdown", async (t) => {
  const { props, calls } = createPickerProps();
  const view = await mount(t, ProjectPicker, props);
  await click(view.container.querySelector("button"));
  const rows = projectRows(view.container, props.recentProjects);
  assert.deepEqual(
    rows.map((row) => row.title),
    ["/repo", "/other-1", "/other-2"],
  );
  await click(rows[1]);
  assert.deepEqual(calls.selectedProjects, ["/other-1"]);
  await waitFor(() => assert.equal(projectRows(view.container, props.recentProjects).length, 0));
});

test("an outside click closes the dropdown and resets the custom path entry", async (t) => {
  const { props } = createPickerProps();
  const view = await mount(t, ProjectPicker, props);
  await click(view.container.querySelector("button"));
  await click(
    [...view.container.querySelectorAll("button")].find((control) => control.textContent.includes("Custom path")),
  );
  assert.ok(view.container.querySelector("input"), "the custom path entry is open");
  await outsideMousedown();
  await waitFor(() => assert.equal(projectRows(view.container, props.recentProjects).length, 0));
  assert.equal(view.container.querySelector("input"), null, "the custom path entry is reset");
});

test("escape in the project filter clears it and closes the dropdown", async (t) => {
  const projects = Array.from({ length: 10 }, (_, index) => `/project-${index}`);
  const { props } = createPickerProps({ recentProjects: projects });
  const view = await mount(t, ProjectPicker, props);
  await click(view.container.querySelector("button"));
  const filter = view.container.querySelector("input");
  await input(filter, "project-3");
  assert.deepEqual(
    projectRows(view.container, projects).map((row) => row.title),
    ["/project-3"],
  );
  await keyDown(filter, "Escape");
  await waitFor(() => assert.equal(view.container.querySelector("input") === null, true, "the filter closes"));
  await click(view.container.querySelector("button"));
  assert.equal(view.container.querySelector("input").value, "");
  assert.equal(projectRows(view.container, projects).length, 10);
});

test("custom path validation failures stay visible until the path is fixed", async (t) => {
  const { props, calls } = createPickerProps({
    selectCustomCwd: async (value) => {
      calls.customPaths.push(value);
      return value === "/good" ? { status: "selected" } : { status: "invalid", error: "Nope" };
    },
  });
  const view = await mount(t, ProjectPicker, props);
  await click(view.container.querySelector("button"));
  await click(
    [...view.container.querySelectorAll("button")].find((control) => control.textContent.includes("Custom path")),
  );
  await input(view.container.querySelector("input"), "/bad");
  await click(button(view.container, "Open"));
  assert.deepEqual(calls.customPaths, ["/bad"]);
  assert.match(view.container.textContent, /Nope/);
  await input(view.container.querySelector("input"), "/good");
  await click(button(view.container, "Open"));
  assert.deepEqual(calls.customPaths, ["/bad", "/good"]);
  await waitFor(() => assert.equal(projectRows(view.container, props.recentProjects).length, 0));
});

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
