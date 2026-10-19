import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installApiHostBridge } from "../../../../tests/support/api-host.mjs";
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

const { resetRpc, useWorkspaceNavigation } = await importTestBundle("app-shell-workspace-navigation", {
  stdin: {
    contents:
      'export { useWorkspaceNavigation } from "./src/renderer/components/app-shell/use-workspace-navigation.ts";' +
      '\nexport {resetRpc} from "./src/renderer/lib/api-client.ts";',
    resolveDir: projectRoot,
    sourcefile: "workspace-navigation-test-entry.ts",
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

const GLOBAL_NAMES = ["window", "IS_REACT_ACT_ENVIRONMENT", "__workspaceNavHarness"];

function installEnvironment({ search = "" } = {}) {
  const originals = new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const deepLinkHandlers = [];
  const menuHandlers = [];
  const cleanups = [];
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
    location: { search, pathname: "/" },
    history: {
      replaceState(_state, _title, url) {
        harness.routerReplaceCalls.push([url]);
      },
    },
    dispatchEvent() {},
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
  const hostBoundary = installApiHostBridge(globalThis.window, () => globalThis.__workspaceNavHarness, resetRpc);
  return {
    harness,
    async deepLink(id) {
      for (const handler of [...deepLinkHandlers]) await handler(id);
    },
    menu(name) {
      for (const entry of [...menuHandlers]) if (entry.name === name) entry.handler();
    },
    setListSessionsResponse(next) {
      listSessionsResponse = next;
    },
    ownCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    async restore() {
      try {
        for (const cleanup of cleanups) await cleanup();
      } finally {
        hostBoundary.close();
        for (const [name, descriptor] of originals) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete globalThis[name];
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

async function mountNavigation(env, { isMobile = false } = {}) {
  const effects = {
    mobileSidebarOpen: true,
    topPanelOpen: true,
    sessionPickerOpen: false,
    chatShown: false,
    deletedSessionIds: [],
  };
  const state = { value: undefined };
  function Probe() {
    state.value = useWorkspaceNavigation({
      isMobile,
      onMobileSidebarClose: () => {
        effects.mobileSidebarOpen = false;
      },
      onTopPanelDismiss: () => {
        effects.topPanelOpen = false;
      },
      onSwitchSessionRequested: () => {
        effects.sessionPickerOpen = true;
      },
      onShowChat: () => {
        effects.chatShown = true;
      },
      onBeforeSessionDeleted: (id) => {
        effects.deletedSessionIds.push(id);
      },
    });
    return null;
  }
  let renderer;
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => renderer?.unmount());
  };
  env.ownCleanup(unmount);
  await act(async () => {
    renderer = create(createElement(Probe));
  });
  return { state, effects, unmount };
}

test("keeps the open session when the cwd moves within the same project", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1", { cwd: "/repo/wt-a", projectRoot: "/repo" }));
    });
    const openSessionIdentity = mounted.state.value.sessionKey;
    await act(async () => {
      mounted.state.value.handleCwdChange("/repo/wt-b", "/repo");
    });
    assert.equal(mounted.state.value.activeCwd, "/repo/wt-b");
    assert.equal(mounted.state.value.selectedSession.id, "s1");
    assert.equal(mounted.state.value.sessionKey, openSessionIdentity, "the open chat keeps its identity");
    assert.deepEqual(env.harness.routerReplaceCalls, [["/?session=s1"]]);
    await mounted.unmount();
  });
});

test("closes the open session when the cwd crosses projects", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1", { cwd: "/repo/wt-a", projectRoot: "/repo" }));
    });
    const openSessionIdentity = mounted.state.value.sessionKey;
    await act(async () => {
      mounted.state.value.handleCwdChange("/other", "/other");
    });
    assert.equal(mounted.state.value.selectedSession, null);
    assert.notEqual(mounted.state.value.sessionKey, openSessionIdentity, "the old chat identity is retired");
    assert.equal(mounted.effects.topPanelOpen, false);
    assert.deepEqual(env.harness.routerReplaceCalls.at(-1), ["/"]);
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
    assert.equal(mounted.effects.topPanelOpen, false);
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

test("a restored session survives the initial cwd update but closes on a later project change", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1", { cwd: "/repo", projectRoot: "/repo" }), true);
    });
    const restoredIdentity = mounted.state.value.sessionKey;
    assert.equal(mounted.state.value.initialSessionRestored, true);
    assert.deepEqual(env.harness.routerReplaceCalls, []);
    // The restore flow's own cwd effect must not close the just-restored session.
    await act(async () => {
      mounted.state.value.handleCwdChange("/cross-project", "/cross-project");
    });
    assert.equal(mounted.state.value.activeCwd, "/cross-project");
    assert.equal(mounted.state.value.selectedSession.id, "s1");
    assert.equal(mounted.state.value.sessionKey, restoredIdentity);
    await act(async () => {
      mounted.state.value.handleCwdChange("/other", "/other");
    });
    assert.equal(mounted.state.value.selectedSession, null);
    assert.notEqual(mounted.state.value.sessionKey, restoredIdentity);
    await mounted.unmount();
  });
});

test("routes normal selection and closes the mobile sidebar", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env, { isMobile: true });
    const previousIdentity = mounted.state.value.sessionKey;
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1"));
    });
    assert.equal(mounted.state.value.selectedSession.id, "s1");
    assert.notEqual(mounted.state.value.sessionKey, previousIdentity);
    assert.equal(mounted.state.value.newSessionCwd, null);
    assert.equal(mounted.effects.mobileSidebarOpen, false);
    assert.deepEqual(env.harness.routerReplaceCalls, [["/?session=s1"]]);
    await mounted.unmount();
  });
});

test("selecting the conversation that is already open only shows the chat page", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env, { isMobile: true });
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1", { cwd: "/repo" }));
    });
    const openIdentity = mounted.state.value.sessionKey;
    const openRefresh = mounted.state.value.refreshKey;
    mounted.effects.mobileSidebarOpen = true;
    env.harness.routerReplaceCalls.length = 0;
    await act(async () => {
      mounted.state.value.handleSelectSession(session("s1", { cwd: "/repo" }));
    });
    assert.equal(mounted.state.value.sessionKey, openIdentity, "the open chat keeps its identity");
    assert.equal(mounted.state.value.refreshKey, openRefresh, "nothing is reloaded");
    assert.deepEqual(env.harness.routerReplaceCalls, [], "the address is untouched");
    assert.equal(mounted.effects.chatShown, true, "the chat page is shown");
    assert.equal(mounted.effects.mobileSidebarOpen, false, "the mobile drawer still closes");
    await mounted.unmount();
  });
});

test("adopts created sessions and hydrates the missing project root", async () => {
  await withEnvironment({}, async (env) => {
    env.setListSessionsResponse({ sessions: [session("new-1", { projectRoot: "/repo", cwd: "/repo" })] });
    const mounted = await mountNavigation(env);
    const previousRefresh = mounted.state.value.refreshKey;
    const composerIdentity = mounted.state.value.sessionKey;
    await act(async () => {
      mounted.state.value.handleSessionCreated(session("new-1", { cwd: "/repo" }));
    });
    assert.equal(mounted.state.value.selectedSession.id, "new-1");
    assert.equal(mounted.state.value.newSessionCwd, null);
    assert.notEqual(mounted.state.value.refreshKey, previousRefresh);
    assert.equal(
      mounted.state.value.sessionKey,
      composerIdentity,
      "adopting the real id does not recreate the composer",
    );
    assert.deepEqual(env.harness.routerReplaceCalls, [["/?session=new-1"]]);
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
    const previousIdentity = mounted.state.value.sessionKey;
    const previousRefresh = mounted.state.value.refreshKey;
    await act(async () => {
      mounted.state.value.handleSessionForked("fork-1");
    });
    assert.equal(mounted.state.value.selectedSession.id, "fork-1");
    assert.equal(mounted.state.value.selectedSession.cwd, "/repo");
    assert.equal(mounted.state.value.selectedSession.name, "base");
    assert.notEqual(mounted.state.value.sessionKey, previousIdentity);
    assert.notEqual(mounted.state.value.refreshKey, previousRefresh);
    assert.deepEqual(env.harness.routerReplaceCalls.at(-1), ["/?session=fork-1"]);
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
    const openSessionIdentity = mounted.state.value.sessionKey;
    const previousRefresh = mounted.state.value.refreshKey;
    await act(async () => {
      mounted.state.value.handleSessionDeleted("other");
    });
    assert.equal(mounted.state.value.selectedSession.id, "s1");
    assert.equal(mounted.state.value.sessionKey, openSessionIdentity);
    assert.deepEqual(mounted.effects.deletedSessionIds, ["other"]);
    assert.notEqual(mounted.state.value.refreshKey, previousRefresh);
    await act(async () => {
      mounted.state.value.handleSessionDeleted("s1");
    });
    assert.equal(mounted.state.value.selectedSession, null);
    assert.equal(mounted.state.value.newSessionCwd, "/repo");
    assert.notEqual(mounted.state.value.sessionKey, openSessionIdentity);
    assert.deepEqual(mounted.effects.deletedSessionIds, ["other", "s1"]);
    assert.deepEqual(env.harness.routerReplaceCalls.at(-1), ["/"]);
    await mounted.unmount();
  });
});

test("opens deep-linked sessions after resolving them from the list", async () => {
  await withEnvironment({}, async (env) => {
    env.setListSessionsResponse({ sessions: [session("s1"), session("s2")] });
    const mounted = await mountNavigation(env);
    const previousIdentity = mounted.state.value.sessionKey;
    const previousRefresh = mounted.state.value.refreshKey;
    await act(async () => {
      await env.deepLink("s2");
    });
    assert.equal(mounted.state.value.selectedSession.id, "s2");
    assert.notEqual(mounted.state.value.sessionKey, previousIdentity);
    assert.notEqual(mounted.state.value.refreshKey, previousRefresh);
    assert.deepEqual(env.harness.routerReplaceCalls.at(-1), ["/?session=s2"]);
    const deepLinkedIdentity = mounted.state.value.sessionKey;
    await act(async () => {
      await env.deepLink("missing");
    });
    assert.equal(mounted.state.value.selectedSession.id, "s2");
    assert.equal(mounted.state.value.sessionKey, deepLinkedIdentity);
    await mounted.unmount();
  });
});

test("desktop menu opens a new session in the active project and requests session switching", async () => {
  await withEnvironment({}, async (env) => {
    const mounted = await mountNavigation(env);
    await act(async () => {
      env.menu("new-session");
    });
    assert.equal(mounted.state.value.newSessionCwd, null);
    await act(async () => {
      mounted.state.value.handleCwdChange("/repo", "/repo");
    });
    assert.equal(mounted.state.value.activeCwd, "/repo");
    const previousIdentity = mounted.state.value.sessionKey;
    await act(async () => {
      env.menu("new-session");
    });
    assert.equal(mounted.state.value.newSessionCwd, "/repo");
    assert.notEqual(mounted.state.value.sessionKey, previousIdentity);
    const previousRefresh = mounted.state.value.refreshKey;
    await act(async () => {
      env.menu("switch-session");
    });
    assert.equal(mounted.effects.sessionPickerOpen, true);
    assert.notEqual(mounted.state.value.refreshKey, previousRefresh);
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
