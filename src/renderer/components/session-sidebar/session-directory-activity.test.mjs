import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createDeferred } from "#test-timing";
import {
  session,
  respondWithSessions,
  createProbe,
  mountProbe,
  withEnvironment,
} from "./session-directory.harness.mjs";

const UNREAD_STORAGE_KEY = "dexon:unread-session-ids";

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
