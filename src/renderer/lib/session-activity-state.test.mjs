import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const activityApi = await importTestBundle("session-activity-state", {
  entryPoints: [path.join(import.meta.dirname, "session-activity-state.ts")],
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
});

const { activityReducer, initialActivityState, parseLiveFrame, sessionActivityOf } = activityApi;

test("legacy activity keeps explicit waiting and error statuses ahead of fallback running ids", () => {
  const activity = activityApi.sessionActivityFromLegacySignals({
    liveStatuses: { waiting: "awaiting_input", failed: "error" },
    runningSessionIds: new Set(["waiting", "failed", "running"]),
    unreadSessionIds: new Set(["waiting", "failed", "running", "done"]),
  });
  assert.equal(activity.of("waiting"), "awaiting_input");
  assert.equal(activity.of("failed"), "error");
  assert.equal(activity.of("running"), "running");
  assert.equal(activity.of("done"), "unread");
  assert.equal(activity.of("idle"), "idle");
  assert.deepEqual(activity.runAge("running", "2026-07-15T12:00:00.000Z"), {
    kind: "unknown",
    fallbackModifiedMs: 1784116800000,
  });
  assert.deepEqual(activity.runAge("waiting"), { kind: "not-running" });
});

test("the live boundary accepts both wire shapes and gives explicit statuses priority", () => {
  assert.deepEqual(
    [
      ...parseLiveFrame({
        runningSessionIds: ["running", "waiting", "failed", "running", 42, null],
        sessionIds: ["legacy-ignored"],
        sessionStatuses: { waiting: "awaiting_input", failed: "error", invalid: "idle", other: 7 },
      }),
    ],
    [
      ["running", "running"],
      ["waiting", "awaiting_input"],
      ["failed", "error"],
    ],
  );
  assert.deepEqual(
    [...parseLiveFrame({ sessionIds: ["legacy"], sessionStatuses: { waiting: "awaiting_input" } })],
    [
      ["legacy", "running"],
      ["waiting", "awaiting_input"],
    ],
  );
  assert.deepEqual([...parseLiveFrame({ runningSessionIds: [], sessionIds: ["legacy-ignored"] })], []);
});

test("malformed activity fields cannot enter the live status map", () => {
  for (const raw of [null, undefined, false, 1, "running", [], { sessionIds: "a" }, { sessionStatuses: ["error"] }]) {
    assert.deepEqual([...parseLiveFrame(raw)], []);
  }
  assert.deepEqual(
    [
      ...parseLiveFrame({
        sessionIds: [null, "valid", {}],
        sessionStatuses: { valid: "unexpected", omitted: null },
      }),
    ],
    [["valid", "running"]],
  );
});

function frame(state, statuses, at = 1000, source = "stream") {
  return activityReducer(state, { type: "frame", source, live: parseLiveFrame({ sessionStatuses: statuses }), at });
}

for (const [before, after, expected] of [
  ["running", null, "unread"],
  ["running", "awaiting_input", "awaiting_input"],
  ["running", "error", "error"],
  ["awaiting_input", null, "idle"],
  ["error", null, "idle"],
]) {
  test(`background ${before} to ${after ?? "idle"} is reported as ${expected}`, () => {
    const initial = initialActivityState(new Set());
    const beforeFrame = frame(initial, { a: before });
    const afterFrame = frame(beforeFrame, after ? { a: after } : {});
    assert.equal(sessionActivityOf(afterFrame).of("a"), expected);
    assert.equal(sessionActivityOf(initial).of("a"), "idle");
    assert.equal(sessionActivityOf(beforeFrame).of("a"), before);
  });
}

for (const [status, cleared] of [
  ["running", "unread"],
  ["awaiting_input", "idle"],
  ["error", "idle"],
]) {
  test(`a fresh ${status} frame removes persisted unread activity`, () => {
    const initial = initialActivityState(new Set(["a", "other"]));
    const next = frame(initial, { a: status });
    assert.equal(sessionActivityOf(next).of("a"), status);
    assert.equal(sessionActivityOf(next).of("other"), "unread");
    const ended = frame(next, {});
    assert.equal(sessionActivityOf(ended).of("a"), cleared);
  });
}

test("selected sessions stay read on completion and opening or deleting clears previous unread activity", () => {
  let ledger = initialActivityState(new Set(["opened", "deleted"]));
  ledger = activityReducer(ledger, { type: "selected", sessionId: "running" });
  ledger = frame(ledger, { running: "running", background: "running" });
  ledger = frame(ledger, {});
  assert.equal(sessionActivityOf(ledger).of("running"), "idle");
  assert.equal(sessionActivityOf(ledger).of("background"), "unread");
  ledger = activityReducer(ledger, { type: "selected", sessionId: "opened" });
  assert.equal(sessionActivityOf(ledger).of("opened"), "idle");
  ledger = activityReducer(ledger, { type: "deleted", sessionId: "deleted" });
  assert.equal(sessionActivityOf(ledger).of("deleted"), "idle");
  ledger = activityReducer(ledger, { type: "listed", sessions: [] });
  assert.equal(sessionActivityOf(ledger).of("background"), "idle");
});

test("deleting a delegate forgets its identity before later unclassified activity completes", () => {
  let ledger = initialActivityState(new Set());
  ledger = activityReducer(ledger, { type: "listed", sessions: [{ id: "a", relation: "delegate" }] });
  ledger = frame(ledger, { a: "running" });
  ledger = activityReducer(ledger, { type: "deleted", sessionId: "a" });
  ledger = frame(ledger, {});
  assert.equal(sessionActivityOf(ledger).of("a"), "idle");
  ledger = frame(ledger, { a: "running" });
  ledger = frame(ledger, {});
  assert.equal(sessionActivityOf(ledger).of("a"), "unread");
});

test("stream authority survives stale snapshots and resumes after a host restart", () => {
  let ledger = frame(initialActivityState(new Set()), { a: "running" }, 1000, "snapshot");
  ledger = frame(ledger, { a: "awaiting_input", b: "error" }, 2000);
  ledger = frame(ledger, { a: "running", stale: "running" }, 3000, "snapshot");
  assert.equal(sessionActivityOf(ledger).of("a"), "awaiting_input");
  assert.equal(sessionActivityOf(ledger).of("b"), "error");
  assert.equal(sessionActivityOf(ledger).of("stale"), "idle");
  ledger = activityReducer(ledger, { type: "host_restarted" });
  ledger = frame(ledger, {}, 4000, "snapshot");
  assert.equal(sessionActivityOf(ledger).of("a"), "idle");
  assert.equal(sessionActivityOf(ledger).of("b"), "idle");
  ledger = frame(ledger, { b: "running" }, 5000);
  ledger = frame(ledger, {}, 6000, "snapshot");
  assert.equal(sessionActivityOf(ledger).of("b"), "running");
});

test("run ages distinguish bootstrap uncertainty from an observed start including time zero", () => {
  let bootstrap = frame(initialActivityState(new Set()), { a: "running" }, 1000);
  assert.deepEqual(sessionActivityOf(bootstrap).runAge("a"), { kind: "unknown", fallbackModifiedMs: null });
  bootstrap = frame(bootstrap, { a: "running" }, 2000);
  assert.deepEqual(sessionActivityOf(bootstrap).runAge("a", "not-a-date"), {
    kind: "unknown",
    fallbackModifiedMs: null,
  });
  assert.deepEqual(sessionActivityOf(bootstrap).runAge("a", "1970-01-01T00:00:00.000Z"), {
    kind: "unknown",
    fallbackModifiedMs: 0,
  });
  let observed = frame(initialActivityState(new Set()), {}, -1000, "snapshot");
  observed = frame(observed, { a: "running" }, 0);
  assert.deepEqual(sessionActivityOf(observed).runAge("a"), { kind: "observed", since: 0 });
  observed = frame(observed, { a: "running" }, 9000);
  assert.deepEqual(sessionActivityOf(observed).runAge("a"), { kind: "observed", since: 0 });
  observed = frame(observed, { a: "error" }, 10000);
  assert.deepEqual(sessionActivityOf(observed).runAge("a"), { kind: "not-running" });
  observed = frame(observed, { a: "running" }, 11000);
  assert.deepEqual(sessionActivityOf(observed).runAge("a"), { kind: "observed", since: 11000 });
});
