import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out workspace/worktree owner: project
// root resolution, cwd notification, prop sync, and worktree outcomes.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { resetRpc, installApiShims, useProjectWorkspace } = await importTestBundle("session-sidebar-workspace", {
  stdin: {
    contents:
      'export { useProjectWorkspace } from "./src/renderer/components/session-sidebar/project-workspace.ts";' +
      '\nexport {resetRpc} from "./src/renderer/lib/api-client.ts"; export {installApiShims} from "./src/renderer/lib/api-fetch.ts";',
    resolveDir: projectRoot,
    sourcefile: "project-workspace-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

function session(id, overrides = {}) {
  return {
    id,
    name: "",
    firstMessage: "",
    cwd: "/workspace/dexon",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

function createCallHarness(handlers = {}) {
  const calls = [];
  const harness = {
    calls,
    handlers,
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

const GLOBAL_NAMES = ["window", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ callHandlers } = {}) {
  const originals = new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const callHarness = createCallHarness(callHandlers);
  const cleanups = [];
  globalThis.window = {
    location: { href: "http://localhost/" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    piBridge: {
      selectDirectory: async () => callHarness.pickedDirectory ?? null,
      addEventListener() {},
      removeEventListener() {},
    },
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const hostBoundary = installRendererApi(
    globalThis.window,
    { installApiShims, resetRpc },
    () => globalThis.__workspaceHarness,
  );
  return {
    callHarness,
    ownCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    async restore() {
      const errors = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        hostBoundary.close();
      } catch (error) {
        errors.push(error);
      }
      delete globalThis.__workspaceHarness;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      if (errors.length) throw new AggregateError(errors, "Workspace cleanup failed");
    },
  };
}

function createProbe() {
  const state = { value: undefined };
  function Probe({ hookArgs }) {
    state.value = useProjectWorkspace(hookArgs);
    return null;
  }
  return { state, Probe };
}

async function mountProbe(env, Probe, hookArgs) {
  let renderer;
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => renderer?.unmount());
  };
  env.ownCleanup(unmount);
  await act(async () => {
    renderer = create(createElement(Probe, { hookArgs }));
  });
  return {
    update: async (nextArgs) => {
      await act(async () => {
        renderer.update(createElement(Probe, { hookArgs: nextArgs }));
      });
    },
    unmount,
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

async function mountWithWorkspace(env, cwd, sessions = [], onCwdChange = () => {}) {
  const { state, Probe } = createProbe();
  const mounted = await mountProbe(env, Probe, { sessions, selectedCwdProp: cwd, onCwdChange, refreshKey: 0 });
  return { state, mounted };
}

test("resolves the project root from loaded worktree data first", async () => {
  await withEnvironment({ callHandlers: { "worktrees.list": () => Promise.resolve(GIT_REPO_LIST) } }, async (env) => {
    const { state, mounted } = await mountWithWorkspace(env, "/repo");
    assert.equal(state.value.worktreeState.forCwd, "/repo");
    assert.equal(state.value.projectRootFor("/repo/wt"), "/repo");
    assert.equal(state.value.projectRootFor("/repo"), "/repo");
    await mounted.unmount();
  });
});

test("falls back to session project roots and then to the raw path", async () => {
  await withEnvironment(
    { callHandlers: { "worktrees.list": () => Promise.reject(new Error("no worktree service")) } },
    async (env) => {
      const sessions = [session("wt", { cwd: "/repo/wt", projectRoot: "/repo" }), session("plain", { cwd: "/plain" })];
      const { state, mounted } = await mountWithWorkspace(env, "/plain", sessions);
      assert.equal(state.value.worktreeState, null);
      assert.equal(state.value.projectRootFor("/repo/wt"), "/repo");
      assert.equal(state.value.projectRootFor("/plain"), "/plain");
      assert.equal(state.value.projectRootFor("/nowhere"), "/nowhere");
      await mounted.unmount();
    },
  );
});

test("notifies the parent once per distinct cwd across data refreshes", async () => {
  await withEnvironment(
    { callHandlers: { "worktrees.list": () => Promise.reject(new Error("no worktree service")) } },
    async (env) => {
      const notifications = [];
      const { state, Probe } = createProbe();
      const mounted = await mountProbe(env, Probe, {
        sessions: [],
        selectedCwdProp: null,
        onCwdChange: (cwd, projectRoot) => notifications.push([cwd, projectRoot]),
        refreshKey: 0,
      });
      await act(async () => {
        state.value.setSelectedCwd("/a");
      });
      assert.deepEqual(notifications, [["/a", "/a"]]);
      await act(async () => {
        state.value.setSelectedCwd("/a");
      });
      assert.equal(notifications.length, 1);
      await mounted.update({
        sessions: [session("a", { cwd: "/a", projectRoot: "/repo" })],
        selectedCwdProp: null,
        onCwdChange: (cwd, root) => notifications.push([cwd, root]),
        refreshKey: 0,
      });
      await act(async () => {});
      assert.equal(notifications.length, 1);
      await mounted.unmount();
    },
  );
});

test("syncs the selected cwd from the parent prop without feedback loops", async () => {
  await withEnvironment(
    { callHandlers: { "worktrees.list": () => Promise.reject(new Error("no worktree service")) } },
    async (env) => {
      const notifications = [];
      const { state, Probe } = createProbe();
      const mounted = await mountProbe(env, Probe, {
        sessions: [],
        selectedCwdProp: "/x",
        onCwdChange: (cwd) => notifications.push(cwd),
        refreshKey: 0,
      });
      assert.equal(state.value.selectedCwd, "/x");
      await mounted.update({
        sessions: [],
        selectedCwdProp: "/x",
        onCwdChange: (cwd) => notifications.push(cwd),
        refreshKey: 0,
      });
      await act(async () => {});
      assert.equal(notifications.length, 1);
      await mounted.update({
        sessions: [],
        selectedCwdProp: "/y",
        onCwdChange: (cwd) => notifications.push(cwd),
        refreshKey: 0,
      });
      assert.equal(state.value.selectedCwd, "/y");
      assert.equal(notifications.length, 2);
      await mounted.unmount();
    },
  );
});

test("supports the native directory picker with validation outcomes", async () => {
  const callHandlers = {
    "system.validateCwd": async ({ path }) => {
      if (path === "/rejected") return { ok: false, error: "Permission denied" };
      return { ok: true, path };
    },
  };
  await withEnvironment({ callHandlers }, async (env) => {
    const { state, mounted } = await mountWithWorkspace(env, null);
    env.callHarness.pickedDirectory = "/picked";
    let picked;
    await act(async () => {
      picked = await state.value.selectDirectoryFromPicker();
    });
    assert.deepEqual(picked, { status: "selected" });
    assert.equal(state.value.selectedCwd, "/picked");
    env.callHarness.pickedDirectory = null;
    let cancelled;
    await act(async () => {
      cancelled = await state.value.selectDirectoryFromPicker();
    });
    assert.deepEqual(cancelled, { status: "cancelled" });
    assert.equal(state.value.selectedCwd, "/picked");
    env.callHarness.pickedDirectory = "/rejected";
    let rejected;
    await act(async () => {
      rejected = await state.value.selectDirectoryFromPicker();
    });
    assert.deepEqual(rejected, { status: "invalid", error: "Permission denied" });
    assert.equal(state.value.selectedCwd, "/picked");
    await mounted.unmount();
  });
});

test("shows the worktree switcher only at a Git repository root", async () => {
  const subdirList = { projectRoot: "/repo", isGit: true, isTopLevel: false, worktrees: [] };
  const plainList = { projectRoot: "/plain", isGit: false, isTopLevel: true, worktrees: [] };
  await withEnvironment(
    {
      callHandlers: {
        "worktrees.list": (params) => {
          if (params.projectRoot === "/repo") return Promise.resolve(GIT_REPO_LIST);
          if (params.projectRoot === "/repo/src") return Promise.resolve(subdirList);
          return Promise.resolve(plainList);
        },
      },
    },
    async (env) => {
      const { state, mounted } = await mountWithWorkspace(env, "/repo");
      assert.equal(state.value.showWorktreeSwitcher, true);
      await mounted.unmount();

      const subdir = await mountWithWorkspace(env, "/repo/src");
      assert.equal(subdir.state.value.showWorktreeSwitcher, false);
      await subdir.mounted.unmount();

      const plain = await mountWithWorkspace(env, "/plain");
      assert.equal(plain.state.value.showWorktreeSwitcher, false);
      await plain.mounted.unmount();
    },
  );
});
