import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installApiHostBridge } from "../../../../tests/support/api-host.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the worktree operation surface of the workspace
// owner: optimistic create registration, failure feedback, dirty removal
// confirmation, cwd migration, and operation state surviving project switches.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { resetRpc, useProjectWorkspace } = await importTestBundle("session-sidebar-workspace", {
  stdin: {
    contents:
      'export { useProjectWorkspace } from "./src/renderer/components/session-sidebar/project-workspace.ts";' +
      '\nexport {resetRpc} from "./src/renderer/lib/api-client.ts";',
    resolveDir: projectRoot,
    sourcefile: "project-workspace-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

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
  return harness;
}

const GLOBAL_NAMES = ["window", "fetch", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ fetchRoutes, callHandlers } = {}) {
  const originals = new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const callHarness = createCallHarness(callHandlers);
  let mountedRoot;
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
  if (fetchRoutes) {
    globalThis.fetch = async (url, options) => {
      const route = fetchRoutes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      return route(options);
    };
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const hostBoundary = installApiHostBridge(globalThis.window, () => callHarness, resetRpc);
  return {
    callHarness,
    ownRoot(root) {
      mountedRoot = root;
    },
    async restore() {
      try {
        if (mountedRoot) await act(async () => mountedRoot.unmount());
      } finally {
        try {
          hostBoundary.close();
        } finally {
          for (const [name, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
          }
        }
      }
    },
  };
}

async function withEnvironment(options, run) {
  const env = installEnvironment(options);
  try {
    await run(env);
  } finally {
    await env.restore();
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

async function mountWithWorkspace(env, cwd, sessions = [], onCwdChange = () => {}) {
  const { state, Probe } = createProbe();
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(Probe, { hookArgs: { sessions, selectedCwdProp: cwd, onCwdChange, refreshKey: 0 } }),
    );
    env.ownRoot(renderer);
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
    const { state, mounted } = await mountWithWorkspace(env, "/repo", [], (cwd, projectRoot) =>
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
  await withEnvironment({ callHandlers }, async (env) => {
    const { state, mounted } = await mountWithWorkspace(env, "/repo");
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
  await withEnvironment({ callHandlers }, async (env) => {
    const { state, mounted } = await mountWithWorkspace(env, "/repo");
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
  await withEnvironment({ callHandlers }, async (env) => {
    const { state, mounted } = await mountWithWorkspace(env, "/repo/wt");
    assert.equal(state.value.selectedCwd, "/repo/wt");
    await act(async () => {
      state.value.handleRemoveWorktree("/repo/wt", true);
    });
    assert.equal(state.value.selectedCwd, "/repo");
    await mounted.unmount();
  });
});

// The hint and switcher lifecycle journeys now use real DOM events in
// tests/dom/worktree-lifecycle.test.mjs; the cases above exercise the hook
// interface used by its real owners, without reading a React render tree.
