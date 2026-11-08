import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const statusApi = await importTestBundle("session-tree-status", {
  stdin: {
    contents:
      'export * from "./src/renderer/lib/session-tree-status.ts";' +
      'export * from "./src/renderer/lib/session-activity-state.ts";' +
      'export { buildSessionTree } from "./src/renderer/lib/session-tree.ts";',
    resolveDir: path.join(import.meta.dirname, "../../.."),
    sourcefile: "session-tree-status-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
});

const { buildSessionTree, descendantActivity } = statusApi;

function session(id, overrides = {}) {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    name: id,
    firstMessage: "",
    cwd: "/workspace/dexon",
    created: "2026-07-15T12:00:00.000Z",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

test("work remains in flight while running or waiting for an answer but not after an error", () => {
  assert.equal(statusApi.isWorkInFlight("awaiting_input"), true);
  assert.equal(statusApi.isWorkInFlight("running"), true);
  assert.equal(statusApi.isWorkInFlight("error"), false);
  assert.equal(statusApi.isWorkInFlight("unread"), false);
  assert.equal(statusApi.isWorkInFlight("idle"), false);
});

test("descendant summaries count unread separately and focus the first most urgent descendant in tree order", () => {
  const root = session("root");
  const running = session("running", { parentSessionId: "root", created: "2026-07-15T12:01:00.000Z" });
  const firstWaiting = session("first-waiting", { parentSessionId: "running" });
  const laterWaiting = session("later-waiting", { parentSessionId: "root", created: "2026-07-15T12:02:00.000Z" });
  const failed = session("failed", { parentSessionId: "root", created: "2026-07-15T12:03:00.000Z" });
  const unread = session("unread", { parentSessionId: "root", created: "2026-07-15T12:04:00.000Z" });
  const [tree] = buildSessionTree([root, laterWaiting, failed, running, unread, firstWaiting]);
  const summary = descendantActivity(tree, {
    liveStatuses: {
      root: "running",
      "first-waiting": "awaiting_input",
      "later-waiting": "awaiting_input",
      failed: "error",
    },
    runningSessionIds: new Set(["running"]),
    unreadSessionIds: new Set(["root", "unread"]),
  });
  assert.equal(summary.unread, 1);
  assert.equal(summary.status, "awaiting_input");
  assert.deepEqual(summary.counts, { awaiting_input: 2, error: 1, running: 1 });
  assert.deepEqual(summary.focus, {
    session: firstWaiting,
    status: "awaiting_input",
    runAge: { kind: "not-running" },
  });
});

test("own activity supports both the facade and legacy signals with live status ahead of unread", () => {
  const signals = {
    liveStatuses: { a: "awaiting_input", b: "error" },
    runningSessionIds: new Set(["a", "b", "c"]),
    unreadSessionIds: new Set(["a", "b", "c", "d"]),
  };
  const facade = statusApi.sessionActivityFromLegacySignals(signals);
  for (const activity of [signals, facade]) {
    assert.equal(statusApi.ownActivity("a", activity), "awaiting_input");
    assert.equal(statusApi.ownActivity("b", activity), "error");
    assert.equal(statusApi.ownActivity("c", activity), "running");
    assert.equal(statusApi.ownActivity("d", activity), "unread");
    assert.equal(statusApi.ownActivity("none", activity), "idle");
  }
  assert.equal(statusApi.NO_SESSION_ACTIVITY.of("a"), "idle");
  assert.deepEqual(statusApi.NO_SESSION_ACTIVITY.runAge("a"), { kind: "not-running" });
});

test("counted activity and urgency preserve the waiting, error, running ordering", () => {
  assert.deepEqual(statusApi.COUNTED_ACTIVITIES, ["awaiting_input", "error", "running"]);
  assert.equal(statusApi.isCountedActivity("awaiting_input"), true);
  assert.equal(statusApi.isCountedActivity("error"), true);
  assert.equal(statusApi.isCountedActivity("running"), true);
  assert.equal(statusApi.isCountedActivity("unread"), false);
  assert.equal(statusApi.isCountedActivity("idle"), false);
  for (const [left, right, expected] of [
    ["unread", "awaiting_input", "awaiting_input"],
    ["running", "error", "error"],
    ["awaiting_input", "error", "awaiting_input"],
    ["error", "running", "error"],
    ["idle", "unread", "unread"],
    ["unread", "idle", "unread"],
    ["running", "running", "running"],
  ]) {
    assert.equal(statusApi.moreUrgent(left, right), expected);
  }
});

test("Pulse activity includes unread after live activity without changing counted activity", () => {
  assert.deepEqual(statusApi.PULSE_ACTIVITIES, ["awaiting_input", "error", "running", "unread"]);
  for (const status of ["awaiting_input", "error", "running", "unread"]) {
    assert.equal(statusApi.isPulseActivity(status), true);
  }
  assert.equal(statusApi.isPulseActivity("idle"), false);
});

test("collapsed rows and Pulse roots surface unread fork descendants without overriding live activity", () => {
  const [tree] = buildSessionTree([
    session("root"),
    session("branch", { parentSessionId: "root", relation: "fork" }),
    session("child", { parentSessionId: "branch", relation: "fork" }),
  ]);
  const signals = { liveStatuses: {}, runningSessionIds: new Set(), unreadSessionIds: new Set(["child"]) };
  const descendants = descendantActivity(tree, signals);
  assert.equal(statusApi.indicatedPulseActivity("idle", descendants), "unread");
  assert.equal(statusApi.indicatedActivity("idle", descendants), "unread");
  for (const own of ["awaiting_input", "error", "running", "unread"]) {
    assert.equal(statusApi.indicatedPulseActivity(own, descendants), own);
    assert.equal(statusApi.indicatedActivity(own, descendants), own);
  }
  assert.equal(statusApi.indicatedPulseActivity("unread", null), "unread");
  assert.equal(statusApi.indicatedActivity("idle", null), "idle");
});

test("the first unread descendant follows creation-tree order with live status ahead of unread", () => {
  const root = session("root");
  const earlyBranch = session("early", { parentSessionId: "root", created: "2026-07-15T12:01:00.000Z" });
  const nested = session("nested", { parentSessionId: "early", created: "2026-07-15T12:04:00.000Z" });
  const later = session("later", { parentSessionId: "root", created: "2026-07-15T12:02:00.000Z" });
  const [tree] = buildSessionTree([later, nested, root, earlyBranch]);
  const signals = {
    liveStatuses: { early: "running" },
    runningSessionIds: new Set(),
    unreadSessionIds: new Set(["root", "early", "nested", "later"]),
  };
  for (const activity of [signals, statusApi.sessionActivityFromLegacySignals(signals)]) {
    assert.equal(statusApi.firstUnreadDescendant(tree, activity), nested);
    assert.equal(statusApi.firstUnreadDescendant(tree.children[0], activity), nested);
    assert.equal(statusApi.firstUnreadDescendant(tree.children[1], activity), null);
  }
  assert.equal(statusApi.firstUnreadDescendant(tree, statusApi.NO_SESSION_ACTIVITY), null);
});

for (const [own, childStatus, expected] of [
  ["unread", "awaiting_input", "awaiting_input"],
  ["unread", "error", "error"],
  ["unread", "running", "running"],
  ["running", "awaiting_input", "awaiting_input"],
  ["running", "error", "error"],
  ["awaiting_input", "error", "awaiting_input"],
  ["error", "running", "error"],
  ["running", "unread", "running"],
]) {
  test(`a parent in ${own} with descendant status ${childStatus} indicates ${expected}`, () => {
    const [tree] = buildSessionTree([session("root"), session("child", { parentSessionId: "root" })]);
    const facade = statusApi.sessionActivityFromLegacySignals({
      liveStatuses: childStatus === "unread" ? {} : { child: childStatus },
      runningSessionIds: new Set(),
      unreadSessionIds: new Set(childStatus === "unread" ? ["child"] : []),
    });
    const descendants = descendantActivity(tree, facade);
    assert.equal(statusApi.indicatedActivity(own, descendants), expected);
    assert.equal(statusApi.indicatedActivity(own, null), own);
  });
}

test("a running focus carries the facade's observed age instead of its last message time", () => {
  const child = session("child", { parentSessionId: "root" });
  const [tree] = buildSessionTree([session("root"), child]);
  let ledger = statusApi.initialActivityState(new Set());
  ledger = statusApi.activityReducer(ledger, { type: "frame", source: "snapshot", live: new Map(), at: 1000 });
  ledger = statusApi.activityReducer(ledger, {
    type: "frame",
    source: "stream",
    live: new Map([["child", "running"]]),
    at: 2000,
  });
  const summary = descendantActivity(tree, statusApi.sessionActivityOf(ledger));
  assert.deepEqual(summary, {
    status: "running",
    counts: { awaiting_input: 0, error: 0, running: 1 },
    unread: 0,
    focus: { session: child, status: "running", runAge: { kind: "observed", since: 2000 } },
  });
});

test("unread-only descendants have no active focus and a leaf has an empty summary", () => {
  const [tree] = buildSessionTree([session("root"), session("child", { parentSessionId: "root" })]);
  const signals = { liveStatuses: {}, runningSessionIds: new Set(), unreadSessionIds: new Set(["child"]) };
  assert.deepEqual(descendantActivity(tree, signals), {
    status: "unread",
    counts: { awaiting_input: 0, error: 0, running: 0 },
    unread: 1,
    focus: null,
  });
  assert.deepEqual(descendantActivity(tree.children[0], signals), {
    status: null,
    counts: { awaiting_input: 0, error: 0, running: 0 },
    unread: 0,
    focus: null,
  });
});
