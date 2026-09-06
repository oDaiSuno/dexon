import { importTestBundle } from "#test-bundle";
import { createManualScheduler } from "#test-timing";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the worktree operation surface of the workspace
// owner: optimistic create registration, failure feedback, dirty removal
// confirmation, cwd migration, and operation state surviving project switches.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { useProjectWorkspace, WorktreeSwitcher, WorktreeInactiveHint } = await importTestBundle(
  "session-sidebar-workspace",
  {
    stdin: {
      contents:
        'export { useProjectWorkspace } from "./src/renderer/components/session-sidebar/project-workspace.ts";\n' +
        'export { WorktreeSwitcher } from "./src/renderer/components/session-sidebar/worktree-switcher.tsx";\n' +
        'export { WorktreeInactiveHint } from "./src/renderer/components/session-sidebar/worktree-inactive-hint.tsx";',
      resolveDir: projectRoot,
      sourcefile: "project-workspace-test-entry.ts",
      loader: "ts",
    },
    tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
    plugins: [
      {
        name: "project-workspace-stubs",
        setup(build) {
          build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "project-workspace" }));
          build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "project-workspace" }));
          build.onLoad({ filter: /.*/, namespace: "project-workspace" }, ({ path: modulePath }) => ({
            contents:
              modulePath === "i18n"
                ? "function stubT(_key, fallback) { return fallback; }\n" +
                  'export function useI18n() { return { language: "en", t: stubT }; }'
                : "export const call = (method, params) =>\n" + "  globalThis.__workspaceHarness.call(method, params);",
            loader: "js",
          }));
        },
      },
    ],
  },
);

function createCallHarness(handlers = {}) {
  const calls = [];
  const harness = {
    calls,
    async call(method, params) {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected rpc ${method}`);
      return handler(params);
    },
  };
  globalThis.__workspaceHarness = harness;
  return harness;
}

const GLOBAL_NAMES = ["window", "document", "fetch", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ fetchRoutes, callHandlers } = {}) {
  const originals = new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const callHarness = createCallHarness(callHandlers);
  globalThis.window = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    piBridge: {
      selectDirectory: async () => callHarness.pickedDirectory ?? null,
    },
    requestAnimationFrame: (callback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => {},
  };
  // The switcher view registers a document-level outside-click listener.
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  if (fetchRoutes) {
    globalThis.fetch = async (url, options) => {
      const route = fetchRoutes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      return route(options);
    };
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    callHarness,
    async restore() {
      delete globalThis.__workspaceHarness;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

async function withEnvironment(options, run) {
  const env = installEnvironment(options);
  try {
    await run(env);
  } finally {
    env.restore();
  }
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

function createProbe() {
  const state = { value: undefined };
  function Probe({ hookArgs }) {
    state.value = useProjectWorkspace(hookArgs);
    return null;
  }
  return { state, Probe };
}

function HintProbe({ hookArgs }) {
  const workspace = useProjectWorkspace(hookArgs);
  // Mirror the composition: the hint component is always mounted.
  return createElement(WorktreeInactiveHint, { hint: workspace.inactiveWorktreeSelector });
}

async function mountWithWorkspace(cwd, sessions = [], onCwdChange = () => {}) {
  const { state, Probe } = createProbe();
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(Probe, { hookArgs: { sessions, selectedCwdProp: cwd, onCwdChange, refreshKey: 0 } }),
    );
  });
  return {
    state,
    mounted: {
      update: async (nextArgs) => {
        await act(async () => {
          renderer.update(createElement(Probe, { hookArgs: nextArgs }));
        });
      },
      unmount: async () => {
        await act(async () => {
          renderer.unmount();
        });
      },
    },
  };
}

test("creates worktrees, registers them optimistically, and refreshes the list", async () => {
  const notifications = [];
  let createdCalls = 0;
  let releaseList;
  const listCallBarrier = new Promise((resolve) => {
    releaseList = resolve;
  });
  const callHandlers = {
    "worktrees.list": (params) => {
      if (createdCalls === 0) return Promise.resolve(GIT_REPO_LIST);
      // Hold the post-create refetch back so the optimistic window is observable.
      return listCallBarrier.then(() => ({
        projectRoot: params.projectRoot,
        isGit: true,
        isTopLevel: true,
        worktrees: [],
      }));
    },
    "worktrees.create": (params) => {
      createdCalls += 1;
      assert.deepEqual(params, { projectRoot: "/repo", cwd: "/repo", branch: "feat" });
      return Promise.resolve({ worktree: { path: "/repo/wt2", branch: "feat" } });
    },
  };
  await withEnvironment({ callHandlers }, async (env) => {
    const { state, mounted } = await mountWithWorkspace("/repo", [], (cwd, projectRoot) =>
      notifications.push([cwd, projectRoot]),
    );
    await act(async () => {
      state.value.setNewWorktreeBranch("feat");
    });
    await act(async () => {
      state.value.handleCreateWorktree();
    });
    assert.equal(state.value.wtBusy, false);
    // Optimistic window: the refetch is still pending, yet the new worktree is
    // already registered and resolves to the original project root (review R1
    // finding 2 — this pins the registration that protects the open chat).
    assert.equal(state.value.worktreeState.forCwd, "/repo/wt2");
    assert.deepEqual(
      state.value.worktreeState.worktrees.map((entry) => entry.path),
      ["/repo", "/repo/wt", "/repo/wt2"],
    );
    assert.equal(state.value.projectRootFor("/repo/wt2"), "/repo");
    assert.equal(state.value.selectedCwd, "/repo/wt2");
    assert.deepEqual(notifications.at(-1), ["/repo/wt2", "/repo"]);
    await act(async () => {
      releaseList();
    });
    const refetch = env.callHarness.calls.at(-1);
    assert.equal(refetch.method, "worktrees.list");
    assert.equal(refetch.params.projectRoot, "/repo/wt2");
    await mounted.unmount();
  });
});

test("reports worktree creation failures without moving the cwd", async () => {
  const callHandlers = {
    "worktrees.list": () => Promise.resolve(GIT_REPO_LIST),
    "worktrees.create": () => Promise.reject(new Error("branch already exists")),
  };
  await withEnvironment({ callHandlers }, async () => {
    const { state, mounted } = await mountWithWorkspace("/repo");
    await act(async () => {
      state.value.setNewWorktreeBranch("feat");
    });
    await act(async () => {
      state.value.handleCreateWorktree();
    });
    assert.equal(state.value.wtBusy, false);
    assert.equal(state.value.wtError, "branch already exists");
    assert.equal(state.value.selectedCwd, "/repo");
    await mounted.unmount();
  });
});

test("reports dirty removals for confirmation and succeeds on force", async () => {
  let force = false;
  const callHandlers = {
    "worktrees.list": () => Promise.resolve(GIT_REPO_LIST),
    "worktrees.remove": () => {
      if (!force) {
        const error = new Error("dirty worktree");
        error.detail = { dirty: true };
        return Promise.reject(error);
      }
      return Promise.resolve({});
    },
  };
  await withEnvironment({ callHandlers }, async () => {
    const { state, mounted } = await mountWithWorkspace("/repo");
    await act(async () => {
      state.value.handleRemoveWorktree("/repo/wt", false);
    });
    assert.equal(state.value.wtConfirmRemove, "/repo/wt");
    assert.equal(state.value.selectedCwd, "/repo");
    force = true;
    await act(async () => {
      state.value.handleRemoveWorktree("/repo/wt", true);
    });
    assert.equal(state.value.wtConfirmRemove, null);
    assert.equal(state.value.selectedCwd, "/repo");
    await mounted.unmount();
  });
});

test("moves the effective cwd back to the project root after removing it", async () => {
  const callHandlers = {
    "worktrees.list": (params) => {
      if (params.projectRoot === "/repo") return Promise.resolve(GIT_REPO_LIST);
      return Promise.resolve({ projectRoot: "/repo", isGit: true, isTopLevel: true, worktrees: [] });
    },
    "worktrees.remove": () => Promise.resolve({}),
  };
  await withEnvironment({ callHandlers }, async () => {
    const { state, mounted } = await mountWithWorkspace("/repo/wt");
    assert.equal(state.value.selectedCwd, "/repo/wt");
    await act(async () => {
      state.value.handleRemoveWorktree("/repo/wt", true);
    });
    assert.equal(state.value.selectedCwd, "/repo");
    await mounted.unmount();
  });
});

test("an opened inactive-worktree hint keeps its 4s state across project switches", async () => {
  const callHandlers = {
    "worktrees.list": (params) => {
      if (params.projectRoot === "/repo") return Promise.resolve(GIT_REPO_LIST);
      // Each plain directory carries its own real root, so switching between
      // two plain directories keeps inactiveWorktreeSelector non-null on both
      // sides — only the git interlude below drives the hint → null → hint
      // boundary that caused the R2 regression.
      return Promise.resolve({ projectRoot: params.projectRoot, isGit: false, isTopLevel: true, worktrees: [] });
    },
  };
  await withEnvironment({ callHandlers }, async () => {
    const scheduler = createManualScheduler();
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = scheduler.setTimeout;
    globalThis.clearTimeout = scheduler.clearTimeout;
    try {
      const hookArgs = { sessions: [], selectedCwdProp: "/plain", onCwdChange: () => {}, refreshKey: 0 };
      let renderer;
      await act(async () => {
        renderer = create(createElement(HintProbe, { hookArgs }));
      });
      const revealButton = renderer.root.findAll(
        (node) => node.type === "button" && (node.props.title ?? "").length > 0 && node.props.tabIndex === -1,
      )[0];
      assert.ok(revealButton, "the inactive hint button renders for a non-git directory");
      await act(async () => {
        revealButton.props.onClick();
      });
      assert.equal(
        renderer.root.findAll(
          (node) => node.type === "div" && node.props.children === "Worktrees are available in Git repository roots.",
        ).length > 0,
        true,
        "the opened hint text is visible",
      );
      // A project switch must not cancel the hint or its pending timer.
      await act(async () => {
        renderer.update(createElement(HintProbe, { hookArgs: { ...hookArgs, selectedCwdProp: "/other" } }));
      });
      assert.equal(
        renderer.root.findAll(
          (node) => node.type === "div" && node.props.children === "Worktrees are available in Git repository roots.",
        ).length > 0,
        true,
        "the hint survives the project switch",
      );
      // Walk through a git project: the hint must actually HIDE (hint → null),
      // then restore with the original timer still pending (review R3 finding 1).
      await act(async () => {
        renderer.update(createElement(HintProbe, { hookArgs: { ...hookArgs, selectedCwdProp: "/repo" } }));
      });
      await act(async () => {});
      assert.equal(
        renderer.root.findAll(
          (node) => node.type === "div" && node.props.children === "Worktrees are available in Git repository roots.",
        ).length,
        0,
        "the hint is hidden while the selector is unavailable",
      );
      await act(async () => {
        renderer.update(createElement(HintProbe, { hookArgs }));
      });
      await act(async () => {});
      assert.equal(
        renderer.root.findAll(
          (node) => node.type === "div" && node.props.children === "Worktrees are available in Git repository roots.",
        ).length > 0,
        true,
        "the hint restores after returning to the original directory",
      );
      assert.equal(scheduler.pendingCount(), 1, "exactly one hint timer was scheduled");
      // The original timer still fires the close.
      await act(async () => {
        await scheduler.runNext();
      });
      assert.equal(
        renderer.root.findAll(
          (node) => node.type === "div" && node.props.children === "Worktrees are available in Git repository roots.",
        ).length,
        0,
        "the hint closes when its original timer fires",
      );
      await act(async () => {
        renderer.unmount();
      });
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });
});

test("keeps worktree operation state alive across project switches", async () => {
  let removeCalls = 0;
  let releaseRemove;
  const removeBarrier = new Promise((resolve) => {
    releaseRemove = resolve;
  });
  const callHandlers = {
    "worktrees.list": (params) => {
      if (params.projectRoot === "/repo") return Promise.resolve(GIT_REPO_LIST);
      return Promise.resolve({ projectRoot: "/other", isGit: false, isTopLevel: true, worktrees: [] });
    },
    "worktrees.remove": () => {
      removeCalls += 1;
      return removeBarrier.then(() => {
        const error = new Error("dirty worktree");
        error.detail = { dirty: true };
        return Promise.reject(error);
      });
    },
  };
  await withEnvironment({ callHandlers }, async () => {
    const probeState = { value: undefined };
    function ViewProbe({ hookArgs }) {
      const workspace = useProjectWorkspace(hookArgs);
      probeState.value = workspace;
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
        deferFocus: (focus) => focus(),
      });
    }
    const hookArgs = { sessions: [], selectedCwdProp: "/repo", onCwdChange: () => {}, refreshKey: 0 };
    let renderer;
    await act(async () => {
      renderer = create(createElement(ViewProbe, { hookArgs }));
    });
    // Open the dropdown and start a removal whose RPC stays pending.
    await act(async () => {
      probeState.value.toggleWorktreeDropdown();
    });
    const removeButton = renderer.root.findAll(
      (node) => node.type === "button" && (node.props.title ?? "").includes("Remove worktree checkout"),
    )[0];
    assert.ok(removeButton, "the switcher view renders the remove button");
    await act(async () => {
      removeButton.props.onClick();
    });
    assert.equal(probeState.value.wtBusy, true);
    // Switch projects: the switcher view unmounts, but the hook keeps the state.
    await act(async () => {
      renderer.update(createElement(ViewProbe, { hookArgs: { ...hookArgs, selectedCwdProp: "/other" } }));
    });
    assert.equal(renderer.root.findAll((node) => node.type === WorktreeSwitcher).length, 0);
    assert.equal(probeState.value.wtBusy, true, "busy survives the view unmount");
    // Switch back: the view remounts and the in-flight protection is visible.
    await act(async () => {
      renderer.update(createElement(ViewProbe, { hookArgs }));
    });
    const remountedRemove = renderer.root.findAll(
      (node) => node.type === "button" && (node.props.title ?? "").includes("Remove worktree checkout"),
    )[0];
    assert.ok(remountedRemove, "the switcher view remounts after returning");
    assert.equal(remountedRemove.props.disabled, true, "the remove button is disabled while the operation is pending");
    // A second remove attempt must be blocked by the busy guard: still one RPC.
    await act(async () => {
      remountedRemove.props.onClick();
    });
    assert.equal(removeCalls, 1, "the duplicate remove attempt never reaches the RPC layer");
    await act(async () => {
      releaseRemove();
    });
    assert.equal(probeState.value.wtBusy, false);
    assert.equal(probeState.value.wtConfirmRemove, "/repo/wt");
    await act(async () => {
      renderer.unmount();
    });
  });
});
