import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out workspace/session navigation owner
// of AppShell: same-project vs cross-project cwd rules, restore suppression,
// the session selection transitions, and the desktop menu wiring.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { useWorkspaceNavigation } = await importTestBundle("app-shell-workspace-navigation", {
  stdin: {
    contents:
      'export { useWorkspaceNavigation } from "./src/renderer/components/app-shell/use-workspace-navigation.ts";',
    resolveDir: projectRoot,
    sourcefile: "workspace-navigation-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "workspace-navigation-stubs",
      setup(build) {
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "workspace-navigation" }));
        build.onResolve({ filter: /(^|\/)router-compat$/ }, () => ({
          path: "router",
          namespace: "workspace-navigation",
        }));
        build.onLoad({ filter: /.*/, namespace: "workspace-navigation" }, ({ path: modulePath }) => ({
          contents:
            modulePath === "router"
              ? "export const routerCompat = {\n" +
                "  replace: (...args) => globalThis.__workspaceNavHarness.routerReplace(...args),\n" +
                "};\n" +
                "export function readSessionIdFromSearch(search) {\n" +
                '  return new URLSearchParams(search).get("session");\n' +
                "}"
              : "export const listSessions = (...args) => globalThis.__workspaceNavHarness.listSessions(...args);",
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

const GLOBAL_NAMES = ["window", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ search = "" } = {}) {
  const originals = new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const deepLinkHandlers = [];
  const menuHandlers = [];
  let listSessionsResponse = { sessions: [] };
  const harness = {
    routerReplaceCalls: [],
    routerReplace(...args) {
      this.routerReplaceCalls.push(args);
    },
    async listSessions() {
      return listSessionsResponse;
    },
  };
  globalThis.__workspaceNavHarness = harness;
  globalThis.window = {
    location: { search },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    piBridge: {
      onDeepLinkSession: (handler) => {
        deepLinkHandlers.push(handler);
        return () => {
          const index = deepLinkHandlers.indexOf(handler);
          if (index >= 0) deepLinkHandlers.splice(index, 1);
        };
      },
      onMenu: (name, handler) => {
        menuHandlers.push({ name, handler });
        return () => {
          const index = menuHandlers.findIndex((entry) => entry.name === name && entry.handler === handler);
          if (index >= 0) menuHandlers.splice(index, 1);
        };
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    harness,
    deepLinkHandlers,
    menuHandlers,
    setListSessionsResponse(next) {
      listSessionsResponse = next;
    },
    async restore() {
      delete globalThis.__workspaceNavHarness;
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

async function mountNavigation(env, { isMobile = false } = {}) {
  const calls = {
    mobileSidebarClose: 0,
    topPanelDismiss: 0,
    switchSessionRequested: 0,
    beforeDeleted: [],
  };
  const state = { value: undefined };
  function Probe() {
    state.value = useWorkspaceNavigation({
      isMobile,
      onMobileSidebarClose: () => {
        calls.mobileSidebarClose += 1;
      },
      onTopPanelDismiss: () => {
        calls.topPanelDismiss += 1;
      },
      onSwitchSessionRequested: () => {
        calls.switchSessionRequested += 1;
      },
      onBeforeSessionDeleted: (id) => {
        calls.beforeDeleted.push(id);
      },
    });
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  return {
    state,
    calls,
    unmount: async () => {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}

test("keeps the open session when the cwd moves within the same project", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1", { cwd: "/repo/wt-a", projectRoot: "/repo" }));
    });
    assert.equal(mounted.state.value.sessionKey, 1);
    await act(async () => {
      mounted.state.value.handleCwdChange("/repo/wt-b", "/repo");
    });
    assert.equal(mounted.state.value.activeCwd, "/repo/wt-b");
    assert.equal(mounted.state.value.selectedSession.id, "s1");
    assert.equal(mounted.state.value.sessionKey, 1);
    assert.deepEqual(env.harness.routerReplaceCalls, [["?session=s1", { scroll: false }]]);
    await mounted.unmount();
  });
});

test("closes the open session when the cwd crosses projects", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1", { cwd: "/repo/wt-a", projectRoot: "/repo" }));
    });
    const dismissCallsBefore = mounted.calls.topPanelDismiss;
    await act(async () => {
      mounted.state.value.handleCwdChange("/other", "/other");
    });
    assert.equal(mounted.state.value.selectedSession, null);
    assert.equal(mounted.state.value.sessionKey, 2);
    assert.equal(mounted.calls.topPanelDismiss, dismissCallsBefore + 1);
    assert.deepEqual(env.harness.routerReplaceCalls.at(-1), ["/", { scroll: false }]);
    await mounted.unmount();
  });
});

test("keeps a matching new-session cwd and clears a stale one", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleNewSession("temp-1", "/a");
    });
    assert.equal(mounted.state.value.newSessionCwd, "/a");
    assert.equal(mounted.state.value.selectedSession, null);
    assert.equal(mounted.calls.topPanelDismiss, 1);
    await act(async () => {
      mounted.state.value.handleCwdChange("/a", "/a");
    });
    assert.equal(mounted.state.value.newSessionCwd, "/a");
    await act(async () => {
      mounted.state.value.handleCwdChange("/b", "/b");
    });
    assert.equal(mounted.state.value.newSessionCwd, null);
    await mounted.unmount();
  });
});

test("suppresses the cwd bump exactly once after a restore selection", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1", { cwd: "/repo", projectRoot: "/repo" }), true);
    });
    assert.equal(mounted.state.value.sessionKey, 1);
    assert.equal(mounted.state.value.initialSessionRestored, true);
    assert.deepEqual(env.harness.routerReplaceCalls, []);
    // The restore flow's own cwd effect must not close the just-restored session.
    await act(async () => {
      mounted.state.value.handleCwdChange("/cross-project", "/cross-project");
    });
    assert.equal(mounted.state.value.activeCwd, "/cross-project");
    assert.equal(mounted.state.value.selectedSession.id, "s1");
    assert.equal(mounted.state.value.sessionKey, 1);
    await act(async () => {
      mounted.state.value.handleCwdChange("/other", "/other");
    });
    assert.equal(mounted.state.value.selectedSession, null);
    assert.equal(mounted.state.value.sessionKey, 2);
    await mounted.unmount();
  });
});

test("routes normal selection and closes the mobile sidebar", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env, { isMobile: true });
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1"));
    });
    assert.equal(mounted.state.value.selectedSession.id, "s1");
    assert.equal(mounted.state.value.sessionKey, 1);
    assert.equal(mounted.state.value.newSessionCwd, null);
    assert.equal(mounted.calls.mobileSidebarClose, 1);
    assert.deepEqual(env.harness.routerReplaceCalls, [["?session=s1", { scroll: false }]]);
    await mounted.unmount();
  });
});

test("adopts created sessions and hydrates the missing project root", async () => {
  await withEnvironment({}, async (env) => {
    env.setListSessionsResponse({ sessions: [session("new-1", { projectRoot: "/repo", cwd: "/repo" })] });
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleSessionCreated(session("new-1", { cwd: "/repo" }));
    });
    assert.equal(mounted.state.value.selectedSession.id, "new-1");
    assert.equal(mounted.state.value.newSessionCwd, null);
    assert.equal(mounted.state.value.refreshKey, 1);
    assert.deepEqual(env.harness.routerReplaceCalls, [["?session=new-1", { scroll: false }]]);
    await act(async () => {});
    assert.equal(mounted.state.value.selectedSession.projectRoot, "/repo");
    await mounted.unmount();
  });
});

test("swaps the selected session identity on fork and keeps the row context", async () => {
  await withEnvironment({}, async (env) => {
    env.setListSessionsResponse({ sessions: [session("fork-1", { projectRoot: "/repo", cwd: "/repo" })] });
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleSelectSession(session("base-1", { cwd: "/repo", projectRoot: "/repo", name: "base" }));
    });
    await act(async () => {
      mounted.state.value.handleSessionForked("fork-1");
    });
    assert.equal(mounted.state.value.selectedSession.id, "fork-1");
    assert.equal(mounted.state.value.selectedSession.cwd, "/repo");
    assert.equal(mounted.state.value.selectedSession.name, "base");
    assert.equal(mounted.state.value.sessionKey, 2);
    assert.equal(mounted.state.value.refreshKey, 1);
    assert.deepEqual(env.harness.routerReplaceCalls.at(-1), ["?session=fork-1", { scroll: false }]);
    await act(async () => {});
    assert.equal(mounted.state.value.selectedSession.projectRoot, "/repo");
    await mounted.unmount();
  });
});

test("falls back to the deleted session's cwd only when it was selected", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1", { cwd: "/repo" }));
    });
    await act(async () => {
      mounted.state.value.handleSessionDeleted("other");
    });
    assert.equal(mounted.state.value.selectedSession.id, "s1");
    assert.deepEqual(mounted.calls.beforeDeleted, ["other"]);
    assert.equal(mounted.state.value.refreshKey, 1);
    await act(async () => {
      mounted.state.value.handleSessionDeleted("s1");
    });
    assert.equal(mounted.state.value.selectedSession, null);
    assert.equal(mounted.state.value.newSessionCwd, "/repo");
    assert.equal(mounted.state.value.sessionKey, 2);
    assert.deepEqual(mounted.calls.beforeDeleted, ["other", "s1"]);
    assert.deepEqual(env.harness.routerReplaceCalls.at(-1), ["/", { scroll: false }]);
    await mounted.unmount();
  });
});

test("opens deep-linked sessions after resolving them from the list", async () => {
  await withEnvironment({}, async (env) => {
    env.setListSessionsResponse({ sessions: [session("s1"), session("s2")] });
    const mounted = await mountNavigation(env);
    await act(async () => {
      await env.deepLinkHandlers[0]("s2");
    });
    assert.equal(mounted.state.value.selectedSession.id, "s2");
    assert.equal(mounted.state.value.sessionKey, 1);
    assert.equal(mounted.state.value.refreshKey, 1);
    assert.deepEqual(env.harness.routerReplaceCalls.at(-1), ["?session=s2"]);
    await act(async () => {
      await env.deepLinkHandlers[0]("missing");
    });
    assert.equal(mounted.state.value.selectedSession.id, "s2");
    await mounted.unmount();
  });
});

test("wires the desktop menu actions for new and switch session", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    assert.deepEqual(
      env.menuHandlers.map((entry) => entry.name),
      ["new-session", "switch-session"],
    );
    const newSessionHandler = env.menuHandlers.find((entry) => entry.name === "new-session").handler;
    await act(async () => {
      newSessionHandler();
    });
    assert.equal(mounted.state.value.newSessionCwd, null);
    await act(async () => {
      mounted.state.value.handleCwdChange("/repo", "/repo");
    });
    assert.equal(mounted.state.value.activeCwd, "/repo");
    const latestNewSession = env.menuHandlers.find((entry) => entry.name === "new-session").handler;
    await act(async () => {
      latestNewSession();
    });
    assert.equal(mounted.state.value.newSessionCwd, "/repo");
    assert.equal(mounted.state.value.sessionKey, 2);
    const switchHandler = env.menuHandlers.find((entry) => entry.name === "switch-session").handler;
    await act(async () => {
      switchHandler();
    });
    assert.equal(mounted.calls.switchSessionRequested, 1);
    assert.equal(mounted.state.value.refreshKey, 1);
    await mounted.unmount();
  });
});

test("marks the initial restore as done for the not-found path", async () => {
  await withEnvironment({ search: "?session=pending" }, async (env) => {
    const mounted = await mountNavigation(env);
    assert.equal(mounted.state.value.initialSessionRestored, false);
    await act(async () => {
      mounted.state.value.handleInitialRestoreDone();
    });
    assert.equal(mounted.state.value.initialSessionRestored, true);
    await mounted.unmount();
  });
});
