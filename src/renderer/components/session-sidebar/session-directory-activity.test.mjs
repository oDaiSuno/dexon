import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createDeferred } from "#test-timing";
import {
  session,
  createStorage,
  respondWithSessions,
  createProbe,
  mountProbe,
  withEnvironment,
} from "./session-directory.harness.mjs";
import { api, mountProjectProbe } from "../app-shell/project-spaces-test-harness.mjs";
import { remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";

const UNREAD_STORAGE_KEY = "dexon:unread-session-ids";

test("known delegate completions stay read while root and fork completions remain unread", async () => {
  const sessions = [
    session("root"),
    session("delegate", { parentSessionId: "root", relation: "delegate" }),
    session("fork", { parentSessionId: "root", relation: "fork" }),
    session("legacy-fork", { parentSessionId: "root" }),
  ];
  await withEnvironment({ responses: respondWithSessions(sessions) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => env.running({ sessionIds: ["root", "delegate", "fork", "legacy-fork"] }));
    assert.equal(state.value.activity.of("delegate"), "running");
    await act(async () => env.running({ sessionIds: [] }));
    assert.equal(state.value.activity.of("delegate"), "idle");
    assert.deepEqual([...state.value.unreadSessionIds], ["root", "fork", "legacy-fork"]);
    assert.deepEqual(JSON.parse(env.store.getItem(UNREAD_STORAGE_KEY)), ["root", "fork", "legacy-fork"]);
    await mounted.unmount();
  });
});

test("hydrated delegate unread is cleaned and persisted separately for local and remote directories", async (t) => {
  const storage = createStorage();
  storage.setItem("pi-web:unread-session-ids", JSON.stringify(["shared", "delegate", "fork", "legacy-fork", "gone"]));
  storage.setItem(`${UNREAD_STORAGE_KEY}:gpu`, JSON.stringify(["root", "shared", "fork", "gone"]));
  await withEnvironment(
    {
      storage,
      responses: respondWithSessions([
        session("shared"),
        session("delegate", { parentSessionId: "shared", relation: "delegate" }),
        session("fork", { parentSessionId: "shared", relation: "fork" }),
        session("legacy-fork", { parentSessionId: "shared" }),
      ]),
    },
    async (env) => {
      const { state, Probe } = createProbe();
      const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
      assert.deepEqual([...state.value.unreadSessionIds], ["shared", "fork", "legacy-fork"]);
      assert.equal(state.value.activity.of("delegate"), "idle");
      assert.deepEqual(JSON.parse(storage.getItem(UNREAD_STORAGE_KEY)), ["shared", "fork", "legacy-fork"]);
      assert.equal(storage.getItem("pi-web:unread-session-ids"), null);
      assert.deepEqual(JSON.parse(storage.getItem(`${UNREAD_STORAGE_KEY}:gpu`)), ["root", "shared", "fork", "gone"]);
      await mounted.unmount();
    },
  );
  const host = await mountProjectProbe(t, () => api.useEnvironmentDirectories({ selectedSessionId: null }), {
    target: { localStorage: storage },
    servers: [remoteServer("gpu")],
    reply: (_id, method) => {
      assert.equal(method, "sessions.list");
      return {
        sessions: [
          session("root"),
          session("shared", { parentSessionId: "root", relation: "delegate" }),
          session("fork", { parentSessionId: "root", relation: "fork" }),
        ],
        runningSessionIds: [],
      };
    },
  });
  const remote = host.get().find((directory) => directory.environment.id === "gpu");
  assert.equal(remote.error, null);
  assert.deepEqual([...remote.unreadSessionIds], ["root", "fork"]);
  assert.equal(remote.activity.of("shared"), "idle");
  assert.deepEqual(JSON.parse(storage.getItem(`${UNREAD_STORAGE_KEY}:gpu`)), ["root", "fork"]);
  assert.deepEqual(JSON.parse(storage.getItem(UNREAD_STORAGE_KEY)), ["shared", "fork", "legacy-fork"]);
});

test("a delegate upsert before the first list suppresses completion without pruning unrelated root and fork unread", async () => {
  const snapshot = createDeferred();
  const storage = createStorage();
  storage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(["root", "fork"]));
  const sessions = [
    session("root"),
    session("fork", { parentSessionId: "root", relation: "fork" }),
    session("delegate", { parentSessionId: "root", relation: "delegate" }),
  ];
  await withEnvironment(
    {
      storage,
      responses: (method) => {
        if (method === "sessions.list") return snapshot.promise;
        throw new Error(`unexpected Host request: ${method}`);
      },
    },
    async (env) => {
      const { state, Probe } = createProbe();
      const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
      assert.equal(state.value.loading, true);
      await act(async () => env.sessionChanged({ cwd: sessions[2].cwd, session: sessions[2] }));
      assert.deepEqual(
        state.value.sessions.map((item) => item.id),
        ["delegate"],
      );
      assert.deepEqual([...state.value.unreadSessionIds], ["root", "fork"]);
      assert.deepEqual(JSON.parse(storage.getItem(UNREAD_STORAGE_KEY)), ["root", "fork"]);
      await act(async () => env.running({ sessionIds: ["delegate"] }));
      assert.equal(state.value.activity.of("delegate"), "running");
      await act(async () => env.running({ sessionIds: [] }));
      assert.equal(state.value.activity.of("delegate"), "idle");
      assert.deepEqual([...state.value.unreadSessionIds], ["root", "fork"]);
      env.setReplies(respondWithSessions(sessions));
      await act(async () => snapshot.resolve({ sessions, runningSessionIds: ["delegate"] }));
      assert.equal(state.value.loading, false);
      assert.equal(state.value.activity.of("delegate"), "idle");
      assert.deepEqual(JSON.parse(storage.getItem(UNREAD_STORAGE_KEY)), ["root", "fork"]);
      await mounted.unmount();
    },
  );
});

test("late delegate metadata clears its completion and other partial updates preserve unread eligibility", async () => {
  const root = session("root");
  const fork = session("fork", { parentSessionId: "root", relation: "fork" });
  const delegate = session("delegate", { parentSessionId: "root", relation: "delegate" });
  await withEnvironment({ responses: respondWithSessions([root, fork]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => env.running({ sessionIds: ["root", "fork", "delegate"] }));
    await act(async () => env.running({ sessionIds: [] }));
    assert.deepEqual([...state.value.unreadSessionIds], ["root", "fork", "delegate"]);
    await act(async () => env.sessionChanged({ cwd: delegate.cwd, session: delegate }));
    assert.equal(state.value.activity.of("delegate"), "idle");
    assert.deepEqual([...state.value.unreadSessionIds], ["root", "fork"]);
    assert.deepEqual(JSON.parse(env.store.getItem(UNREAD_STORAGE_KEY)), ["root", "fork"]);
    await act(async () => env.sessionChanged({ cwd: root.cwd, session: { ...root, name: "renamed" } }));
    await act(async () => env.running({ sessionIds: ["root", "fork", "delegate"] }));
    await act(async () => env.running({ sessionIds: [] }));
    assert.equal(state.value.activity.of("delegate"), "idle");
    assert.deepEqual([...state.value.unreadSessionIds], ["root", "fork"]);
    await mounted.unmount();
  });
});

test("restarted snapshots prune removed completions and learn delegate identity without overriding later streams", async () => {
  const root = session("root");
  const fork = session("fork", { parentSessionId: "root", relation: "fork" });
  const delegate = session("delegate", { parentSessionId: "root" });
  await withEnvironment(
    {
      responses: respondWithSessions(
        [root, fork, delegate, session("removed")],
        ["root", "fork", "delegate", "removed"],
      ),
    },
    async (env) => {
      const { state, Probe } = createProbe();
      const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
      assert.deepEqual([...state.value.runningSessionIds], ["root", "fork", "delegate", "removed"]);
      env.setReplies(respondWithSessions([root, fork, { ...delegate, relation: "delegate" }]));
      await act(async () => env.restart());
      assert.equal(state.value.activity.of("delegate"), "idle");
      assert.equal(state.value.activity.of("removed"), "idle");
      assert.deepEqual([...state.value.unreadSessionIds], ["root", "fork"]);
      assert.deepEqual(JSON.parse(env.store.getItem(UNREAD_STORAGE_KEY)), ["root", "fork"]);
      await act(async () => env.running({ sessionIds: ["uncatalogued"] }));
      await act(async () => state.value.refreshSessions(false));
      assert.equal(state.value.activity.of("uncatalogued"), "running");
      assert.deepEqual([...state.value.unreadSessionIds], ["root", "fork"]);
      await mounted.unmount();
    },
  );
});

test("observed runs keep their start across frames and reset it only when another run starts", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  await withEnvironment({ responses: respondWithSessions([session("a")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.deepEqual(state.value.activity.runAge("a"), { kind: "not-running" });
    now = 2000;
    await act(async () => env.running({ sessionIds: ["a"] }));
    assert.deepEqual(state.value.activity.runAge("a"), { kind: "observed", since: 2000 });
    now = 5000;
    await act(async () => env.running({ sessionIds: ["a"] }));
    assert.deepEqual(state.value.activity.runAge("a"), { kind: "observed", since: 2000 });
    await act(async () => env.running({ sessionIds: [], sessionStatuses: { a: "awaiting_input" } }));
    assert.deepEqual(state.value.activity.runAge("a"), { kind: "not-running" });
    now = 7000;
    await act(async () => env.running({ sessionIds: ["a"] }));
    assert.deepEqual(state.value.activity.runAge("a"), { kind: "observed", since: 7000 });
    await act(async () => env.running({ sessionIds: [] }));
    assert.equal(state.value.activity.of("a"), "unread");
    assert.deepEqual(state.value.activity.runAge("a"), { kind: "not-running" });
    await mounted.unmount();
  });
});

test("a stream received during bootstrap owns activity even when the initial snapshot arrives late", async () => {
  const snapshot = createDeferred();
  await withEnvironment({ responses: respondWithSessions([]) }, async (env) => {
    env.setReplies((method) => {
      if (method === "sessions.list") return snapshot.promise;
      if (method === "system.home") return { home: "/Users/tester" };
      throw new Error(`unexpected Host request: ${method}`);
    });
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => env.running({ sessionIds: ["a"], sessionStatuses: { b: "awaiting_input" } }));
    assert.equal(state.value.activity.of("a"), "running");
    assert.deepEqual(state.value.activity.runAge("a"), { kind: "unknown", fallbackModifiedMs: null });
    await act(async () => {
      snapshot.resolve({
        sessions: [session("a"), session("b"), session("stale")],
        runningSessionIds: ["stale"],
        sessionStatuses: { a: "error" },
      });
    });
    assert.equal(state.value.loading, false);
    assert.deepEqual(
      state.value.sessions.map((item) => item.id),
      ["a", "b", "stale"],
    );
    assert.equal(state.value.activity.of("a"), "running");
    assert.equal(state.value.activity.of("b"), "awaiting_input");
    assert.equal(state.value.activity.of("stale"), "idle");
    assert.deepEqual([...state.value.unreadSessionIds], []);
    assert.deepEqual([...state.value.runningSessionIds], ["a"]);
    await mounted.unmount();
  });
});

test("deleting a running session removes its live activity without inventing a later completion", async () => {
  const deleted = [];
  await withEnvironment({ responses: respondWithSessions([session("a")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, {
      selectedSessionId: null,
      refreshKey: 0,
      onSessionDeleted: (id) => deleted.push(id),
    });
    await act(async () => env.running({ sessionIds: ["a"] }));
    assert.equal(state.value.activity.of("a"), "running");
    await act(async () => env.sessionChanged({ cwd: null, deleted: true, sessionId: "a" }));
    assert.equal(state.value.activity.of("a"), "idle");
    assert.deepEqual([...state.value.runningSessionIds], []);
    assert.deepEqual(state.value.sessions, []);
    await act(async () => env.running({ sessionIds: [] }));
    assert.deepEqual([...state.value.unreadSessionIds], []);
    assert.equal(env.store.getItem(UNREAD_STORAGE_KEY), null);
    assert.deepEqual(deleted, ["a"]);
    await mounted.unmount();
  });
});

test("explicit statuses beat running ids in snapshots and streams and clearing errors stays read across restart", async () => {
  const sessions = [session("waiting"), session("failed")];
  const snapshot = {
    sessions,
    runningSessionIds: ["waiting", "failed"],
    sessionStatuses: { waiting: "awaiting_input", failed: "error" },
  };
  const responses = (method) => {
    if (method === "sessions.list") return snapshot;
    if (method === "system.home") return { home: "/Users/tester" };
    throw new Error(`unexpected Host request: ${method}`);
  };
  await withEnvironment({ responses }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.equal(state.value.activity.of("waiting"), "awaiting_input");
    assert.equal(state.value.activity.of("failed"), "error");
    assert.deepEqual([...state.value.runningSessionIds], []);
    await act(async () =>
      env.running({ sessionIds: ["waiting", "failed"], sessionStatuses: snapshot.sessionStatuses }),
    );
    assert.deepEqual([...state.value.runningSessionIds], []);
    assert.deepEqual([...state.value.unreadSessionIds], []);
    env.setReplies(respondWithSessions(sessions));
    await act(async () => env.restart());
    assert.equal(state.value.activity.of("waiting"), "idle");
    assert.equal(state.value.activity.of("failed"), "idle");
    assert.deepEqual([...state.value.unreadSessionIds], []);
    await act(async () => env.running({ sessionIds: [], sessionStatuses: { waiting: "awaiting_input" } }));
    await act(async () => state.value.refreshSessions(false));
    assert.equal(state.value.activity.of("waiting"), "awaiting_input");
    await mounted.unmount();
  });
});
