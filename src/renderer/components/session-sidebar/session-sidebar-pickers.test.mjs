import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (see dom-setup file).
import { dom, restoreGlobals } from "./session-sidebar-pickers-dom-setup.mjs";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Real-DOM characterization tests for the two workspace dropdowns. The DOM
// environment module is evaluated before react-dom so React's module-level
// feature detection sees a realistic browser (see dom-setup file).

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { ProjectPicker, WorktreeSwitcher, useProjectWorkspace } = await importTestBundle("session-sidebar-pickers", {
  stdin: {
    contents:
      'export { ProjectPicker } from "./src/renderer/components/session-sidebar/project-picker.tsx";\n' +
      'export { WorktreeSwitcher } from "./src/renderer/components/session-sidebar/worktree-switcher.tsx";\n' +
      'export { useProjectWorkspace } from "./src/renderer/components/session-sidebar/project-workspace.ts";',
    resolveDir: projectRoot,
    sourcefile: "session-sidebar-pickers-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "session-sidebar-pickers-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "session-sidebar-pickers" }));
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({
          path: "api",
          namespace: "session-sidebar-pickers",
        }));
        build.onLoad({ filter: /.*/, namespace: "session-sidebar-pickers" }, ({ path: modulePath }) => ({
          contents:
            modulePath === "i18n"
              ? "function stubT(_key, fallback) { return fallback; }\n" +
                'export function useI18n() { return { language: "en", t: stubT }; }'
              : "export const call = async (method, params) =>\n" +
                "  globalThis.__pickersHarness.call(method, params);",
          loader: "js",
        }));
      },
    },
  ],
});

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
      selectCustomCwd: async (value) => calls.customPaths.push(value) && { status: "selected" },
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

let mountedRoot = null;
let currentRootEl = null;

async function renderPicker(element) {
  currentRootEl = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(currentRootEl);
  mountedRoot = createRoot(currentRootEl);
  await act(async () => {
    mountedRoot.render(element);
  });
}

async function unmountPicker() {
  if (!mountedRoot) return;
  const root = mountedRoot;
  const el = currentRootEl;
  mountedRoot = null;
  currentRootEl = null;
  await act(async () => {
    root.unmount();
  });
  el.remove();
}

function dropdownOf(rootEl) {
  const candidates = [...rootEl.querySelectorAll("div")].filter((el) => el.style.position === "absolute");
  assert.ok(candidates.length >= 1, "expected the absolute-positioned dropdown container");
  return candidates[0];
}

async function openDropdown(rootEl, trigger) {
  await act(async () => {
    trigger.click();
  });
  return dropdownOf(rootEl);
}

async function outsideMousedown() {
  const outside = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(outside);
  await act(async () => {
    outside.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  });
  outside.remove();
}

// React 19 + jsdom cannot dispatch real input/keydown events to <input>
// elements: jsdom lacks TextEvent, so React falls back to its IE-era change
// polyfill, which crashes on attachEvent before any handler runs. The repo's
// component tests therefore drive input behavior through the React props that
// React attaches to each DOM node, which exercises the component's own
// handlers without the broken plugin path.
function reactPropsOf(element) {
  const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(propsKey, "expected React props on the element");
  return element[propsKey];
}

async function typeIntoInput(input, value) {
  await act(async () => {
    input.value = value;
    reactPropsOf(input).onChange({ target: input });
  });
}

function pressInputKey(input, key) {
  reactPropsOf(input).onKeyDown({ key, preventDefault() {} });
}

test("lists projects, selects one, and closes the dropdown", async () => {
  const { props, calls } = createPickerProps();
  await renderPicker(createElement(ProjectPicker, props));
  const trigger = currentRootEl.querySelector("button");
  const dropdown = await openDropdown(currentRootEl, trigger);
  assert.equal(dropdown.style.opacity, "1");
  const rows = [...dropdown.querySelectorAll("button")].filter((button) =>
    ["/repo", "/other-1", "/other-2"].some((project) => button.title === project),
  );
  assert.equal(rows.length, 3);
  await act(async () => {
    rows[1].click();
  });
  assert.deepEqual(calls.selectedProjects, ["/other-1"]);
  assert.equal(dropdownOf(currentRootEl).style.opacity, "0");
  await unmountPicker();
});

test("an outside click closes the dropdown and resets the custom path entry", async () => {
  const { props } = createPickerProps();
  await renderPicker(createElement(ProjectPicker, props));
  const trigger = currentRootEl.querySelector("button");
  await openDropdown(currentRootEl, trigger);
  const customPathButton = [...currentRootEl.querySelectorAll("button")].find((button) =>
    button.textContent.includes("Custom path"),
  );
  await act(async () => {
    customPathButton.click();
  });
  assert.ok(currentRootEl.querySelector("input"), "the custom path input is mounted");
  await outsideMousedown();
  assert.equal(currentRootEl.querySelector("input"), null, "the custom path entry is reset");
  assert.equal(dropdownOf(currentRootEl).style.opacity, "0");
  await unmountPicker();
});

test("escape in the project filter clears it and closes the dropdown", async () => {
  const manyProjects = Array.from({ length: 10 }, (_, index) => `/project-${index}`);
  const { props } = createPickerProps({ recentProjects: manyProjects });
  await renderPicker(createElement(ProjectPicker, props));
  const trigger = currentRootEl.querySelector("button");
  await openDropdown(currentRootEl, trigger);
  const filterInput = currentRootEl.querySelector("input");
  assert.ok(filterInput, "the project filter appears for long lists");
  await typeIntoInput(filterInput, "project-3");
  assert.equal(filterInput.value, "project-3");
  await act(async () => {
    pressInputKey(filterInput, "Escape");
  });
  assert.equal(filterInput.value, "");
  assert.equal(dropdownOf(currentRootEl).style.opacity, "0");
  await unmountPicker();
});

test("custom path validation failures stay visible until the path is fixed", async () => {
  const { props, calls } = createPickerProps({
    selectCustomCwd: async (value) => {
      calls.customPaths.push(value);
      return value === "/good" ? { status: "selected" } : { status: "invalid", error: "Nope" };
    },
  });
  await renderPicker(createElement(ProjectPicker, props));
  const trigger = currentRootEl.querySelector("button");
  await openDropdown(currentRootEl, trigger);
  await act(async () => {
    [...currentRootEl.querySelectorAll("button")].find((button) => button.textContent.includes("Custom path")).click();
  });
  const input = currentRootEl.querySelector("input");
  await typeIntoInput(input, "/bad");
  await act(async () => {
    [...currentRootEl.querySelectorAll("button")].find((button) => button.textContent === "Open").click();
  });
  assert.deepEqual(calls.customPaths, ["/bad"]);
  assert.ok(
    [...currentRootEl.querySelectorAll("div")].some((el) => el.textContent === "Nope"),
    "the validation error is displayed",
  );
  await typeIntoInput(input, "/good");
  await act(async () => {
    [...currentRootEl.querySelectorAll("button")].find((button) => button.textContent === "Open").click();
  });
  assert.deepEqual(calls.customPaths, ["/bad", "/good"]);
  assert.equal(dropdownOf(currentRootEl).style.opacity, "0");
  await unmountPicker();
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

// Integration probe: the real workspace hook wired to the real switcher view,
// exactly as the SessionSidebar composition does it.
async function renderSwitcher({ removeWorktreeImpl, createWorktreeImpl } = {}) {
  const calls = { removed: [], created: [] };
  globalThis.__pickersHarness = {
    async call(method, params) {
      if (method === "worktrees.list") return GIT_REPO_LIST;
      if (method === "worktrees.create") {
        calls.created.push(params.branch);
        if (createWorktreeImpl) return createWorktreeImpl(params.branch);
        return { worktree: { path: "/repo/wt2", branch: params.branch } };
      }
      if (method === "worktrees.remove") {
        calls.removed.push([params.path, params.force]);
        if (removeWorktreeImpl) return removeWorktreeImpl(params.path, params.force);
        return {};
      }
      throw new Error(`unexpected rpc ${method}`);
    },
  };
  currentRootEl = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(currentRootEl);
  mountedRoot = createRoot(currentRootEl);
  const probeState = { value: undefined };
  globalThis.__switcherProbeState = probeState;
  let renderer = mountedRoot;
  await act(async () => {
    renderer.render(
      createElement(SwitcherProbe, {
        onProbeState: (value) => {
          probeState.value = value;
        },
      }),
    );
  });
  return {
    state: probeState,
    calls,
    unmount: async () => {
      await act(async () => {
        renderer.unmount();
      });
      currentRootEl.remove();
      currentRootEl = null;
      mountedRoot = null;
    },
  };
}

function SwitcherProbe({ onProbeState }) {
  const workspace = useProjectWorkspace({
    sessions: [],
    selectedCwdProp: "/repo",
    onCwdChange: () => {},
    refreshKey: 0,
  });
  onProbeState(workspace);
  if (!workspace.showWorktreeSwitcher || !workspace.worktreeState) {
    return createElement("div", null, "switcher-hidden");
  }
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

async function openWorktreeDropdown() {
  const trigger = [...currentRootEl.querySelectorAll("button")].find((button) =>
    (button.title ?? "").startsWith("Switch worktree"),
  );
  assert.ok(trigger, "expected the worktree switcher trigger");
  return openDropdown(currentRootEl, trigger);
}

test("a dirty removal surfaces the inline confirmation until it is resolved", async () => {
  const { calls } = await renderSwitcher({
    removeWorktreeImpl: (path, force) =>
      force
        ? Promise.resolve({})
        : Promise.reject(Object.assign(new Error("dirty worktree"), { detail: { dirty: true } })),
  });
  const dropdown = await openWorktreeDropdown();
  assert.equal(dropdown.style.opacity, "1");
  const removeButton = [...currentRootEl.querySelectorAll("button")].find((button) =>
    (button.title ?? "").includes("Remove worktree checkout"),
  );
  await act(async () => {
    removeButton.click();
  });
  assert.deepEqual(calls.removed, [["/repo/wt", false]]);
  assert.ok(
    [...currentRootEl.querySelectorAll("div")].some((el) => el.textContent.includes("Uncommitted changes.")),
    "the force-remove confirmation replaces the row",
  );
  await outsideMousedown();
  assert.equal(dropdownOf(currentRootEl).style.opacity, "0");
  const reopened = await openWorktreeDropdown();
  assert.equal(reopened.style.opacity, "1");
  assert.equal(
    [...currentRootEl.querySelectorAll("div")].some((el) => el.textContent.includes("Uncommitted changes.")),
    false,
    "the confirm state is reset after the dropdown closes",
  );
  await unmountPicker();
});

test("creating a worktree submits the branch and closes the entry on success", async () => {
  const { calls } = await renderSwitcher();
  await openWorktreeDropdown();
  await act(async () => {
    [...currentRootEl.querySelectorAll("button")].find((button) => button.textContent.includes("New worktree")).click();
  });
  const branchInput = currentRootEl.querySelector("input");
  assert.ok(branchInput, "the branch input is mounted");
  await typeIntoInput(branchInput, "feat-2");
  await act(async () => {
    pressInputKey(branchInput, "Enter");
  });
  assert.deepEqual(calls.created, ["feat-2"]);
  assert.equal(dropdownOf(currentRootEl).style.opacity, "0");
  await unmountPicker();
});

test("a failed creation keeps the entry open and shows the error", async () => {
  const { calls } = await renderSwitcher({
    createWorktreeImpl: () => Promise.reject(new Error("branch already exists")),
  });
  await openWorktreeDropdown();
  await act(async () => {
    [...currentRootEl.querySelectorAll("button")].find((button) => button.textContent.includes("New worktree")).click();
  });
  const branchInput = currentRootEl.querySelector("input");
  await typeIntoInput(branchInput, "feat-2");
  await act(async () => {
    pressInputKey(branchInput, "Enter");
  });
  assert.ok([...currentRootEl.querySelectorAll("div")].some((el) => el.textContent.includes("branch already exists")));
  assert.equal(dropdownOf(currentRootEl).style.opacity, "1");
  assert.deepEqual(calls.created, ["feat-2"], "exactly one create RPC despite the failure");
  await unmountPicker();
});

test("escape closes the new-worktree entry without submitting", async () => {
  const { calls } = await renderSwitcher();
  await openWorktreeDropdown();
  await act(async () => {
    [...currentRootEl.querySelectorAll("button")].find((button) => button.textContent.includes("New worktree")).click();
  });
  const branchInput = currentRootEl.querySelector("input");
  await typeIntoInput(branchInput, "feat-2");
  await act(async () => {
    pressInputKey(branchInput, "Escape");
  });
  assert.deepEqual(calls.created, []);
  assert.equal(currentRootEl.querySelector("input"), null);
  await unmountPicker();
});
