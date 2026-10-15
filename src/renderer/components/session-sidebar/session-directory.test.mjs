import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createDeferred, createManualScheduler } from "#test-timing";
import {
  session,
  respondWithSessions,
  createProbe,
  mountProbe,
  withEnvironment,
} from "./session-directory.harness.mjs";
const UNREAD_STORAGE_KEY = "dexon:unread-session-ids";

test("loads sessions, the fetched running fallback, and the home directory on mount", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")], ["a"]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.equal(state.value.loading, false);
    assert.deepEqual(
      state.value.sessions.map((item) => item.id),
      ["a", "b"],
    );
    assert.deepEqual([...state.value.runningSessionIds], ["a"]);
    assert.equal(state.value.homeDir, "/Users/tester");
    assert.equal(state.value.error, null);
    await mounted.unmount();
  });
});

test("the live running stream outranks later fetched snapshots", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a")], ["a"]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.deepEqual([...state.value.runningSessionIds], ["a"]);
    await act(async () => {
      env.running({ sessionIds: ["b"] });
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
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => {
      env.running({ sessionIds: ["x"] });
    });
    await act(async () => {
      env.restart();
    });
    assert.deepEqual([...state.value.runningSessionIds], ["a"]);
    await act(async () => {
      env.running({ sessionIds: ["y"] });
    });
    assert.deepEqual([...state.value.runningSessionIds], ["y"]);
    await mounted.unmount();
  });
});

test("flags background completions as unread and clears them when running again", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => {
      env.running({ sessionIds: ["a", "b"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], []);
    await act(async () => {
      env.running({ sessionIds: ["a"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], ["b"]);
    await act(async () => {
      env.running({ sessionIds: ["a", "b"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], []);
    await mounted.unmount();
  });
});

test("keeps a completion of the selected session out of the unread set", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: "b", refreshKey: 0 });
    await act(async () => {
      env.running({ sessionIds: ["a", "b"] });
    });
    await act(async () => {
      env.running({ sessionIds: ["a"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], []);
    await act(async () => {
      env.running({ sessionIds: [] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], ["a"]);
    await mounted.unmount();
  });
});

test("clears the unread marker of the session the user opens", async () => {
  await withEnvironment({ responses: respondWithSessions([session("a"), session("b")]) }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => {
      env.running({ sessionIds: ["a"] });
    });
    await act(async () => {
      env.running({ sessionIds: [] });
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
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => {
      env.sessionChanged({
        cwd: null,
        session: session("c", { modified: "2026-07-16T12:00:00.000Z" }),
      });
    });
    assert.deepEqual(
      state.value.sessions.map((item) => item.id),
      ["c", "a", "b"],
    );
    await act(async () => {
      env.sessionChanged({
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
    const mounted = await mountProbe(env, Probe, {
      selectedSessionId: null,
      refreshKey: 0,
      onSessionDeleted: (id) => deletedIds.push(id),
    });
    await act(async () => {
      env.running({ sessionIds: [] });
    });
    await act(async () => {
      env.running({ sessionIds: ["b"] });
    });
    await act(async () => {
      env.running({ sessionIds: [] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], ["b"]);
    await act(async () => {
      env.sessionChanged({ cwd: null, deleted: true, sessionId: "b" });
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
  const responses = (method) => {
    if (method === "sessions.list") {
      fetchCount += 1;
      return { sessions: [session("a")], runningSessionIds: [] };
    }
    return { home: "/Users/tester" };
  };
  await withEnvironment({ responses }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.equal(fetchCount, 1);
    await act(async () => {
      env.sessionChanged({ cwd: "/workspace/dexon", fullRefresh: true });
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
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    await act(async () => {
      env.running({ sessionIds: ["a", "b"] });
    });
    await act(async () => {
      env.running({ sessionIds: ["a"] });
    });
    assert.deepEqual([...state.value.unreadSessionIds], ["b"]);
    assert.deepEqual(JSON.parse(env.store.getItem(UNREAD_STORAGE_KEY)), ["b"]);
    // A later list without "b" must prune the stale unread marker and persist the cleanup.
    let refreshCount = 0;
    env.setReplies((method) => {
      if (method === "sessions.list") {
        refreshCount += 1;
        return { sessions: [session("a")], runningSessionIds: [] };
      }
      throw new Error(`unexpected Host request: ${method}`);
    });
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
  await withEnvironment({ responses: respondWithSessions([session("a")]), scheduler }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
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
  await withEnvironment({ responses: respondWithSessions([session("a")]), scheduler }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    const focusCalls = [];
    await act(async () => {
      state.value.deferFocus(() => focusCalls.push("first"));
    });
    assert.deepEqual(focusCalls, []);
    await act(async () => {
      while (focusCalls.length === 0 && scheduler.pendingCount() > 0) await scheduler.runNext();
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

test("unmounting cancels an in-flight refresh-feedback timer", async () => {
  const scheduler = createManualScheduler();
  await withEnvironment({ responses: respondWithSessions([]), scheduler }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    assert.equal(state.value.loading, false);

    await act(async () => {
      await state.value.refreshSessions(false);
    });
    assert.equal(state.value.sessionRefreshDone, true, "the background refresh leaves the feedback timer in flight");
    await mounted.unmount();
    assert.equal(scheduler.pendingCount(), 0, "unmount cancels the in-flight feedback timer");
  });
});

test("a background refresh response that lands after unmount schedules nothing", async () => {
  const scheduler = createManualScheduler();
  const refreshDeferred = createDeferred();
  const responses = (method) => {
    if (method === "sessions.list") return refreshDeferred.promise;
    if (method === "system.home") return { home: "/Users/tester" };
    throw new Error(`unexpected Host request: ${method}`);
  };
  await withEnvironment({ responses, scheduler }, async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, { selectedSessionId: null, refreshKey: 0 });
    const refresh = state.value.refreshSessions(false);
    await mounted.unmount();

    refreshDeferred.resolve({ sessions: [], runningSessionIds: [] });
    await refresh;
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(scheduler.pendingCount(), 0, "a late refresh response must not schedule the feedback timer");
  });
});
