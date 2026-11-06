import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadRenderer, restoreGlobals } from "../../../../tests/support/renderer.mjs";

const { buildProjectSpaceRows, mountSpace, projectRowFace } = await loadRenderer(
  "project-space-rows",
  'export { buildProjectSpaceRows } from "./src/renderer/components/app-nav/project-space-rows.ts";' +
    'export { mountSpace } from "./src/renderer/lib/project-spaces.ts";' +
    'export { projectRowFace } from "./src/renderer/components/app-nav/project-row-status.tsx";',
);
after(restoreGlobals);
const environment = (id, status = { phase: "connected", generation: 1, since: 1000 }) => ({
  id,
  label: id,
  enabled: true,
  target: id === "primary" ? { kind: "primary" } : { kind: "ssh", sshAlias: id },
  status,
  descriptor: null,
});
const session = (id, cwd, extra = {}) => ({
  id,
  cwd,
  path: `/sessions/${id}`,
  firstMessage: "",
  created: "2026-01-01",
  modified: "2026-01-01",
  messageCount: 1,
  ...extra,
});
const activity = (status) => ({ of: () => status, runAge: () => ({ kind: "not-running" }) });
const directory = (id, sessions, status = "idle", connection) => ({
  environment: environment(id, connection),
  sessions,
  activity: activity(status),
  loading: false,
  error: null,
});
const focus = { environmentId: "staging", spaceKey: '["staging","/work/app"]', sessionId: "same" };

test("rows follow mounted order, scope identical paths and ids, group worktrees at project roots and do not revive unmounted histories", () => {
  const spaces = ["staging", "primary", "gpu"].map((environmentId) => mountSpace({ environmentId, path: "/work/app" }));
  const rows = buildProjectSpaceRows({
    spaces,
    focus,
    now: 2000,
    directories: [
      directory("primary", [session("same", "/work/app")]),
      directory(
        "gpu",
        [session("same", "/work/app-review", { projectRoot: "/work/app" }), session("hidden", "/unmounted")],
        "running",
      ),
      directory("staging", [session("same", "/work/app")], "awaiting_input"),
    ],
  });
  assert.deepEqual(
    rows.map((row) => row.environmentId),
    ["staging", "primary", "gpu"],
  );
  assert.equal(new Set(rows.map((row) => row.key)).size, 3);
  assert.deepEqual(
    rows.map((row) => row.current),
    [true, false, false],
  );
  assert.deepEqual(
    rows.map((row) => row.sessions.map((item) => item.id)),
    [["same"], ["same"], ["same"]],
  );
  assert.equal(rows[0].activity.sessionCounts.awaiting_input, 1);
  assert.equal(rows[1].activity.workInFlight, false);
  assert.equal(rows[2].activity.sessionCounts.running, 1);
  assert.equal(rows[2].sessions[0].cwd, "/work/app-review");
});

for (const [phase, status, tone] of [
  ["connected", { phase: "connected", generation: 1, since: 1000 }, "online"],
  ["connecting", { phase: "connecting", stage: "opening", attempt: 1, progress: null }, "pending"],
  ["backoff", { phase: "backoff", reason: "network", detail: "lost", retryAt: 5000, failureCount: 1 }, "pending"],
  ["offline", { phase: "offline", lastFailure: null }, "offline"],
  [
    "blocked",
    { phase: "blocked", diagnosis: { reason: "authentication", detail: "key required", copyIdCommand: null } },
    "blocked",
  ],
])
  test(`${phase} connection has the ${tone} tone without replacing independent session activity`, () => {
    const space = mountSpace({ environmentId: "gpu", path: "/work/app" });
    const [row] = buildProjectSpaceRows({
      spaces: [space],
      directories: [directory("gpu", [session("same", "/work/app")], "unread", status)],
      focus,
      now: 2000,
    });
    assert.equal(row.connection.tone, tone);
    assert.equal(row.activity.unread, 1);
    assert.equal(row.missing, false);
    assert.equal(
      projectRowFace({ open: false, missing: row.missing, totalSessions: row.sessions.length, activity: row.activity })
        .kind,
      "closed-unread",
    );
  });
