import { importTestBundle } from "#test-bundle";
import { createManualScheduler } from "#test-timing";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out session directory owner. They pin
// the current behavior of the sidebar data model: list loading, the live
// running stream authority, host restarts, unread transitions, incremental
// change events, persistence, and the sidebar-owned timers.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { useSessionDirectory } = await importTestBundle("session-sidebar-directory", {
  stdin: {
    contents: 'export { useSessionDirectory } from "./src/renderer/components/session-sidebar/session-directory.ts";',
    resolveDir: projectRoot,
    sourcefile: "session-directory-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "session-directory-stubs",
      setup(build) {
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "session-directory" }));
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "session-directory" }));
        build.onLoad({ filter: /.*/, namespace: "session-directory" }, ({ path: modulePath }) => ({
          contents:
            modulePath === "i18n"
              ? "function stubT(_key, fallback) { return fallback; }\n" +
                'export function useI18n() { return { language: "en", t: stubT }; }'
              : "export const subscribeSessionsChanged = (listener) =>\n" +
                "  globalThis.__sessionDirectoryHarness.subscribeSessionsChanged(listener);",
          loader: "js",
        }));
      },
    },
  ],
});

const UNREAD_STORAGE_KEY = "dexon:unread-session-ids";

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

function createStorage() {
  const store = new Map();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

function respondWithSessions(sessionsList, runningSessionIds = []) {
  return (url) => {
    if (url === "/api/sessions") {
      return Promise.resolve({ ok: true, json: async () => ({ sessions: sessionsList, runningSessionIds }) });
    }
    if (url === "/api/home") {
      return Promise.resolve({ ok: true, json: async () => ({ home: "/Users/tester" }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  };
}

const TIMED_GLOBALS = ["window", "EventSource", "fetch", "setTimeout", "clearTimeout", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ responses, storage, scheduler } = {}) {
  const originals = new Map(TIMED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const store = storage ?? createStorage();
  const eventSources = [];
  const restartHandlers = [];
  const sessionChangedListeners = [];

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.onmessage = null;
      this.closed = false;
      eventSources.push(this);
    }
    close() {
      this.closed = true;
    }
  }

  const harness = {
    subscribeSessionsChanged(listener) {
      sessionChangedListeners.push(listener);
      return Promise.resolve(() => {
        const index = sessionChangedListeners.indexOf(listener);
        if (index >= 0) sessionChangedListeners.splice(index, 1);
      });
    },
  };

  globalThis.__sessionDirectoryHarness = harness;
  globalThis.EventSource = FakeEventSource;
  globalThis.window = {
    localStorage: store,
    piBridge: {
      onHostRestarted: (handler) => {
        restartHandlers.push(handler);
        return () => {
          const index = restartHandlers.indexOf(handler);
          if (index >= 0) restartHandlers.splice(index, 1);
        };
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.fetch = responses ?? (() => Promise.reject(new Error("unexpected fetch in session-directory test")));
  if (scheduler) {
    globalThis.setTimeout = scheduler.setTimeout;
    globalThis.clearTimeout = scheduler.clearTimeout;
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  return {
    store,
    eventSources,
    restartHandlers,
    sessionChangedListeners,
    async restore() {
      delete globalThis.__sessionDirectoryHarness;
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
    state.value = useSessionDirectory(hookArgs);
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

function deliverFrame(source, payload) {
  source.onmessage({ data: JSON.stringify({ type: "running", ...payload }) });
}

async function withEnvironment(options, run) {
  const env = installEnvironment(options);
  try {
    await run(env);
  } finally {
    await env.restore();
  }
}

test("loads sessions, the fetched running fallback, and the home directory on mount", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")], ["a"]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.equal(state.value.loading, false);
    assert.deepEqual(
      state.value.sessions.map((item) => item.id),
      ["a", "b"],
    );
    assert.deepEqual([...state.value.runningSessionIds], ["a"]);
    assert.equal(state.value.homeDir, "/Users/tester");
    assert.equal(state.value.error, null);
    await mounted.unmount();
    assert.equal(env.eventSources.length, 1);
  });
});

test("the live running stream outranks later fetched snapshots", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a")], ["a"]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.deepEqual([...state.value.runningSessionIds], ["a"]);
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["b"] });
    });
    assert.deepEqual([...state.value.runningSessionIds], ["b"]);
    await act(async () => {
      await state.value.refreshSessions(false);
    });
    assert.deepEqual([...state.value.runningSessionIds], ["b"]);
    await mounted.unmount();
  });
});

test("reconnects the running stream and refetches after a host restart", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a")], ["a"]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["x"] });
    });
    assert.equal(env.eventSources.length, 1);
    await act(async () => {
      env.restartHandlers[0]();
    });
    assert.equal(env.eventSources[0].closed, true);
    assert.equal(env.eventSources.length, 2);
    assert.deepEqual([...state.value.runningSessionIds], ["a"]);
    await act(async () => {
      deliverFrame(env.eventSources[1], { runningSessionIds: ["y"] });
    });
    assert.deepEqual([...state.value.runningSessionIds], ["y"]);
    await mounted.unmount();
  });
});

test("flags background completions as unread and clears them when running again", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["a", "b"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], []);
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["a"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], ["b"]);
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["a", "b"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], []);
    await mounted.unmount();
  });
});

test("keeps a completion of the selected session out of the unread set", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: "b", refreshKey: 0 });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["a", "b"] });
    });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["a"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], []);
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: [] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], ["a"]);
    await mounted.unmount();
  });
});

test("clears the unread marker of the session the user opens", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["a"] });
    });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: [] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], ["a"]);
    await mounted.update({ selectedSessionId: "a", refreshKey: 0 });
    assert.deepEqual([...state.value.unreadSessionIds], []);
    await mounted.unmount();
  });
});

test("applies incremental session upserts in modified order", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.equal(env.sessionChangedListeners.length, 1);
    await act(async () => {
      env.sessionChangedListeners[0]({
        cwd: null,
        session: session("c", { modified: "2026-07-16T12:00:00.000Z" }),
      });
    });
    assert.deepEqual(
      state.value.sessions.map((item) => item.id),
      ["c", "a", "b"],
    );
    await act(async () => {
      env.sessionChangedListeners[0]({
        cwd: null,
        session: session("c", { modified: "2026-07-14T12:00:00.000Z", messageCount: 4 }),
      });
    });
    assert.deepEqual(
      state.value.sessions.map((item) => item.id),
      ["a", "b", "c"],
    );
    assert.equal(state.value.sessions[2].messageCount, 4);
    await mounted.unmount();
  });
});

test("removes deleted sessions, prunes their unread flag, and notifies the parent", async () => {
  const deletedIds = [];
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, {
      selectedSessionId: null,
      refreshKey: 0,
      onSessionDeleted: (id) => deletedIds.push(id),
    });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: [] });
    });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["b"] });
    });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: [] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], ["b"]);
    await act(async () => {
      env.sessionChangedListeners[0]({ cwd: null, deleted: true, sessionId: "b" });
    });
    assert.deepEqual(
      state.value.sessions.map((item) => item.id),
      ["a"],
    );
    assert.deepEqual([...state.value.unreadSessionIds], []);
    assert.deepEqual(deletedIds, ["b"]);
    await mounted.unmount();
  });
});

test("a full refresh event triggers a reload of the session list", async () => {
  let fetchCount = 0;
  const responses = (url) => {
    if (url === "/api/sessions") {
      fetchCount += 1;
      return Promise.resolve({
        ok: true,
        json: async () => ({ sessions: [session("a")], runningSessionIds: [] }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ home: "/Users/tester" }) });
  };
  await withEnvironment({ responses }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.equal(fetchCount, 1);
    await act(async () => {
      env.sessionChangedListeners[0]({ cwd: "/workspace/dexon", fullRefresh: true });
    });
    assert.equal(fetchCount, 2);
    assert.deepEqual(
      state.value.sessions.map((item) => item.id),
      ["a"],
    );
    await mounted.unmount();
  });
});

test("persists unread markers and prunes ids that no longer exist", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["a", "b"] });
    });
    await act(async () => {
      deliverFrame(env.eventSources[0], { runningSessionIds: ["a"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], ["b"]);
    assert.deepEqual(JSON.parse(env.store.getItem(UNREAD_STORAGE_KEY)), ["b"]);
    // A later list without "b" must prune the stale unread marker and persist the cleanup.
    let refreshCount = 0;
    globalThis.fetch = (url) => {
      if (url === "/api/sessions") {
        refreshCount += 1;
        return Promise.resolve({ ok: true, json: async () => ({ sessions: [session("a")], runningSessionIds: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    await act(async () => {
      await state.value.refreshSessions(false);
    });
    assert.equal(refreshCount, 1);
    assert.deepEqual([...state.value.unreadSessionIds], []);
    assert.equal(env.store.getItem(UNREAD_STORAGE_KEY), null);
    await mounted.unmount();
  });
});

test("shows refresh feedback until the sidebar timer clears it", async () => {
  const scheduler = createManualScheduler();
  await withEnvironment({ responses: respondWithSessions([session("a")]), scheduler }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.equal(state.value.sessionRefreshDone, false);
    await act(async () => {
      await state.value.refreshSessions(false);
    });
    assert.equal(state.value.sessionRefreshDone, true);
    await act(async () => {
      await scheduler.runNext();
    });
    assert.equal(state.value.sessionRefreshDone, false);
    await mounted.unmount();
  });
});

test("runs deferred focus callbacks through the sidebar-owned timer and cleans up", async () => {
  const scheduler = createManualScheduler();
  await withEnvironment({ responses: respondWithSessions([session("a")]), scheduler }, async () => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { selectedSessionId: null, refreshKey: 0 });
    const focusCalls = [];
    await act(async () => {
      state.value.deferFocus(() => focusCalls.push("first"));
    });
    assert.deepEqual(focusCalls, []);
    assert.equal(scheduler.pendingCount(), 1);
    await act(async () => {
      await scheduler.runNext();
    });
    assert.deepEqual(focusCalls, ["first"]);
    await act(async () => {
      state.value.deferFocus(() => focusCalls.push("pending"));
    });
    await mounted.unmount();
    assert.equal(scheduler.pendingCount(), 0);
    assert.deepEqual(focusCalls, ["first"]);
  });
});
