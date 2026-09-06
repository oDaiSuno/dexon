import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out workspace/worktree owner: project
// root resolution, cwd notification, prop sync, and worktree outcomes.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { useProjectWorkspace } = await importTestBundle("session-sidebar-workspace", {
  stdin: {
    contents: 'export { useProjectWorkspace } from "./src/renderer/components/session-sidebar/project-workspace.ts";',
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

const GLOBAL_NAMES = ["window", "fetch", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ fetchRoutes, callHandlers } = {}) {
  const originals = new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const callHarness = createCallHarness(callHandlers);
  globalThis.window = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    piBridge: {
      selectDirectory: async () => callHarness.pickedDirectory ?? null,
      addEventListener() {},
      removeEventListener() {},
    },
  };
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

function createProbe() {
  const state = { value: undefined };
  function Probe({ hookArgs }) {
    state.value = useProjectWorkspace(hookArgs);
    return null;
  }
  return { state, Probe };
}

async function mountProbe(Probe, hookArgs) {
  let renderer;
  await act(async () => {
    renderer = create(createElement(Probe, { hookArgs }));
  });
  return {
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

test("resolves the project root from loaded worktree data first", async () => {
  await withEnvironment({ callHandlers: { "worktrees.list": () => Promise.resolve(GIT_REPO_LIST) } }, async () => {
    const { state, mounted } = await mountWithWorkspace("/repo");
    assert.equal(state.value.worktreeState.forCwd, "/repo");
    assert.equal(state.value.projectRootFor("/repo/wt"), "/repo");
    assert.equal(state.value.projectRootFor("/repo"), "/repo");
    await mounted.unmount();
  });
});

test("falls back to session project roots and then to the raw path", async () => {
  await withEnvironment(
    { callHandlers: { "worktrees.list": () => Promise.reject(new Error("no worktree service")) } },
    async () => {
      const sessions = [session("wt", { cwd: "/repo/wt", projectRoot: "/repo" }), session("plain", { cwd: "/plain" })];
      const { state, mounted } = await mountWithWorkspace("/plain", sessions);
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
    async () => {
      const notifications = [];
      const { state, Probe } = createProbe();
      const mounted = await mountProbe(Probe, {
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
    async () => {
      const notifications = [];
      const { state, Probe } = createProbe();
      const mounted = await mountProbe(Probe, {
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

test("validates custom paths and reports failures without moving the cwd", async () => {
  let validateCount = 0;
  const fetchRoutes = {
    "/api/cwd/validate": async (options) => {
      validateCount += 1;
      const body = JSON.parse(options.body);
      if (body.cwd === "/bad") {
        return { ok: false, json: async () => ({ error: "Directory does not exist" }) };
      }
      return { ok: true, json: async () => ({ cwd: body.cwd }) };
    },
  };
  await withEnvironment({ fetchRoutes }, async () => {
    const { state, mounted } = await mountWithWorkspace(null);
    let good;
    await act(async () => {
      good = await state.value.selectCustomCwd("/good");
    });
    assert.deepEqual(good, { status: "selected" });
    assert.equal(state.value.selectedCwd, "/good");
    let bad;
    await act(async () => {
      bad = await state.value.selectCustomCwd("/bad");
    });
    assert.deepEqual(bad, { status: "invalid", error: "Directory does not exist" });
    assert.equal(state.value.selectedCwd, "/good");
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const failed = await state.value.selectCustomCwd("/unreachable");
    assert.deepEqual(failed, { status: "invalid", error: "network down" });
    assert.equal(validateCount, 2);
    await mounted.unmount();
  });
});

test("applies the default directory only when the host provides one", async () => {
  let mode = "present";
  const fetchRoutes = {
    "/api/default-cwd": async () => ({
      ok: true,
      json: async () => (mode === "present" ? { cwd: "/default" } : {}),
    }),
  };
  await withEnvironment({ fetchRoutes }, async () => {
    const { state, mounted } = await mountWithWorkspace(null);
    let applied;
    await act(async () => {
      applied = await state.value.selectDefaultCwd();
    });
    assert.equal(applied, true);
    assert.equal(state.value.selectedCwd, "/default");
    mode = "absent";
    let skipped;
    await act(async () => {
      skipped = await state.value.selectDefaultCwd();
    });
    assert.equal(skipped, false);
    assert.equal(state.value.selectedCwd, "/default");
    await mounted.unmount();
  });
});

test("supports the native directory picker with validation outcomes", async () => {
  const fetchRoutes = {
    "/api/cwd/validate": async (options) => {
      const body = JSON.parse(options.body);
      if (body.cwd === "/rejected") {
        return { ok: false, json: async () => ({ error: "Permission denied" }) };
      }
      return { ok: true, json: async () => ({ cwd: body.cwd }) };
    },
  };
  await withEnvironment({ fetchRoutes }, async (env) => {
    const { state, mounted } = await mountWithWorkspace(null);
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

test("derives the switcher visibility and guidance for the current workspace", async () => {
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
    async () => {
      const { state, mounted } = await mountWithWorkspace("/repo");
      assert.equal(state.value.showWorktreeSwitcher, true);
      assert.equal(state.value.worktreeGuide, null);
      await mounted.unmount();

      const subdir = await mountWithWorkspace("/repo/src");
      assert.equal(subdir.state.value.showWorktreeSwitcher, false);
      assert.deepEqual(subdir.state.value.worktreeGuide, {
        label: "Open repo root",
        title: "Open the repository root to manage worktrees.",
      });
      await subdir.mounted.unmount();

      const plain = await mountWithWorkspace("/plain");
      assert.equal(plain.state.value.showWorktreeSwitcher, false);
      assert.deepEqual(plain.state.value.worktreeGuide, {
        label: "Git repo root only",
        title: "Worktrees are available in Git repository roots.",
      });
      await plain.mounted.unmount();
    },
  );
});
