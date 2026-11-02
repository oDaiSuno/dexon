import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const api = await importTestBundle("sidebar-activity", {
  stdin: {
    contents:
      'export * from "./src/renderer/lib/sidebar-activity.ts";' +
      'export * from "./src/renderer/lib/session-activity-state.ts";' +
      'export { projectSessionGroups, sessionProjectKey } from "./src/renderer/lib/session-list.ts";',
    resolveDir: path.join(import.meta.dirname, "../../.."),
    sourcefile: "sidebar-activity-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
});

function session(id, overrides = {}) {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    name: id,
    firstMessage: "",
    cwd: "/work/alpha",
    created: "2026-07-15T12:00:00.000Z",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

function project(sessions, statuses = {}, unread = [], listing = {}) {
  return api.buildSidebarActivity(
    api.projectSessionGroups(sessions, { currentProject: "/work/alpha", ...listing }),
    api.sessionActivityFromLegacySignals({
      liveStatuses: statuses,
      runningSessionIds: new Set(),
      unreadSessionIds: new Set(unread),
    }),
    (root) => root.split("/").at(-1),
  );
}

test("a root task aggregates active descendants into one urgent row without losing true session counts", () => {
  const root = session("root");
  const waiting = session("waiting", { parentSessionId: "root", relation: "delegate" });
  const running = session("running", { parentSessionId: "root", relation: "fork" });
  const failed = session("failed", { parentSessionId: "running" });
  const unread = session("unread", { parentSessionId: "root" });
  const sidebar = project(
    [root, waiting, running, failed, unread],
    {
      root: "running",
      waiting: "awaiting_input",
      running: "running",
      failed: "error",
    },
    ["unread"],
  );
  assert.deepEqual(sidebar.pulse.sessionCounts, { awaiting_input: 1, error: 1, running: 2 });
  assert.deepEqual(sidebar.project(api.sessionProjectKey("/work/alpha")), {
    sessionCounts: { awaiting_input: 1, error: 1, running: 2 },
    taskCounts: { awaiting_input: 1, error: 0, running: 0 },
    unread: 1,
    workInFlight: true,
  });
  assert.equal(sidebar.urgency, "awaiting_input");
  assert.equal(sidebar.pulse.rows.length, 1);
  assert.deepEqual(sidebar.pulse.rows[0], {
    key: "root",
    status: "awaiting_input",
    projectKey: api.sessionProjectKey("/work/alpha"),
    projectName: "alpha",
    root,
    target: waiting,
    subagents: 3,
    runAge: { kind: "not-running" },
    sortTimestampMs: Date.parse(waiting.modified),
  });
  assert.deepEqual(sidebar.pulse.projectNames, ["alpha"]);
});

test("idle and unread projects produce no pulse rows and unknown keys have an idle summary", () => {
  const sidebar = project([session("read"), session("unread")], {}, ["unread"]);
  assert.deepEqual(sidebar.pulse, {
    rows: [],
    sessionCounts: { awaiting_input: 0, error: 0, running: 0 },
    projectNames: [],
  });
  assert.equal(sidebar.urgency, null);
  assert.deepEqual(sidebar.project(api.sessionProjectKey("/work/alpha")), {
    sessionCounts: { awaiting_input: 0, error: 0, running: 0 },
    taskCounts: { awaiting_input: 0, error: 0, running: 0 },
    unread: 1,
    workInFlight: false,
  });
  assert.deepEqual(sidebar.project(api.sessionProjectKey("/unknown")), api.IDLE_PROJECT_ACTIVITY);
});

test("listed-project ownership excludes orphan sessions but retains missing projects and empty rows", () => {
  const retained = session("retained", { cwd: "/work/checkout", projectRoot: "/work/missing" });
  const orphan = session("orphan", { cwd: "/work/orphan" });
  const sidebar = project([retained, orphan], { retained: "error", orphan: "awaiting_input" }, [], {
    listedProjects: [
      { root: "/work/missing", missing: true },
      { root: "/work/empty", missing: false },
    ],
  });
  assert.equal(sidebar.urgency, "error");
  assert.deepEqual(sidebar.pulse.sessionCounts, { awaiting_input: 0, error: 1, running: 0 });
  assert.deepEqual(
    sidebar.pulse.rows.map((row) => row.target.id),
    ["retained"],
  );
  assert.equal(sidebar.project(api.sessionProjectKey("/work/missing")).workInFlight, false);
  assert.deepEqual(sidebar.project(api.sessionProjectKey("/work/orphan")), api.IDLE_PROJECT_ACTIVITY);
  assert.deepEqual(sidebar.project(api.sessionProjectKey("/work/empty")), api.IDLE_PROJECT_ACTIVITY);
});

test("the urgent root wins ties and the first urgent descendant follows creation-tree order, not input order", () => {
  const root = session("root");
  const earlyBranch = session("early", { parentSessionId: "root", created: "2026-07-15T12:01:00.000Z" });
  const nested = session("nested", { parentSessionId: "early", created: "2026-07-15T12:04:00.000Z" });
  const later = session("later", { parentSessionId: "root", created: "2026-07-15T12:02:00.000Z" });
  const sessions = [later, nested, root, earlyBranch];
  const statuses = { nested: "awaiting_input", later: "awaiting_input", early: "running" };
  assert.equal(project(sessions, { ...statuses, root: "awaiting_input" }).pulse.rows[0].target.id, "root");
  assert.equal(project(sessions, { ...statuses, root: "running" }).pulse.rows[0].target.id, "nested");
});

test("mixed roots sort by urgency then newest target timestamp and project names follow row order once", () => {
  const sessions = [
    session("run", { cwd: "/work/beta", modified: "2026-07-15T13:00:00.000Z" }),
    session("error", { cwd: "/work/alpha", modified: "2026-07-15T12:04:00.000Z" }),
    session("wait-old", { cwd: "/work/beta", modified: "2026-07-15T12:01:00.000Z" }),
    session("wait-new", { cwd: "/work/alpha", modified: "2026-07-15T12:02:00.000Z" }),
  ];
  const sidebar = project(sessions, {
    run: "running",
    error: "error",
    "wait-old": "awaiting_input",
    "wait-new": "awaiting_input",
  });
  assert.deepEqual(
    sidebar.pulse.rows.map((row) => row.key),
    ["wait-new", "wait-old", "error", "run"],
  );
  assert.deepEqual(sidebar.pulse.projectNames, ["alpha", "beta"]);
  assert.deepEqual(sidebar.project(api.sessionProjectKey("/work/alpha")).taskCounts, {
    awaiting_input: 1,
    error: 1,
    running: 0,
  });
});

test("running rows preserve unknown bootstrap ages and observed starts from the public activity facade", () => {
  const child = session("child", { parentSessionId: "root" });
  const sessions = [session("root"), child];
  let state = api.initialActivityState(new Set());
  state = api.activityReducer(state, {
    type: "frame",
    source: "snapshot",
    live: new Map([["child", "running"]]),
    at: 1000,
  });
  const groups = api.projectSessionGroups(sessions, { currentProject: "/work/alpha" });
  const build = () => api.buildSidebarActivity(groups, api.sessionActivityOf(state), () => "alpha").pulse.rows[0];
  assert.deepEqual(build().runAge, { kind: "unknown", fallbackModifiedMs: Date.parse(child.modified) });
  assert.equal(build().sortTimestampMs, Date.parse(child.modified));
  state = api.activityReducer(state, { type: "frame", source: "stream", live: new Map(), at: 2000 });
  state = api.activityReducer(state, {
    type: "frame",
    source: "stream",
    live: new Map([["child", "running"]]),
    at: 3000,
  });
  assert.equal(build().target.id, "child");
  assert.deepEqual(build().runAge, { kind: "observed", since: 3000 });
  assert.equal(build().sortTimestampMs, 3000);
});

test("a running session with an invalid message timestamp has an honest unknown age and stable sort fallback", () => {
  const sidebar = project([session("run", { modified: "invalid" })], { run: "running" });
  assert.deepEqual(sidebar.pulse.rows[0].runAge, { kind: "unknown", fallbackModifiedMs: null });
  assert.equal(sidebar.pulse.rows[0].sortTimestampMs, 0);
});
