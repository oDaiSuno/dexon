import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTestBundle } from "#test-bundle";

const { openAutomationDb } = await importTestBundle("automation-sqlite", {
  entryPoints: [fileURLToPath(new URL("./db.ts", import.meta.url))],
});
function database(t) {
  const dir = mkdtempSync(join(tmpdir(), "dexon-automation-schema-"));
  const file = join(dir, "automation.db");
  const adb = openAutomationDb(file);
  assert.equal("unavailable" in adb, false, adb.detail);
  t.after(() => {
    adb.close();
    rmSync(dir, { recursive: true, force: true });
  });
  adb.withTx(() => {
    adb.db.prepare("INSERT INTO tasks VALUES ('task', 'Task', '/tmp', 1, NULL, 0, 0)").run();
    adb.db.prepare("INSERT INTO task_revisions VALUES ('task', 1, '{}', '{}', 'hash', '{}', 0)").run();
    adb.db.prepare("INSERT INTO grants VALUES ('task', 1, 'hash', '{}', 1, 1, 0)").run();
  });
  return { adb, db: adb.db, file };
}
let serial = 0;
function insert(db, table, row) {
  const keys = Object.keys(row);
  return db
    .prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...Object.values(row));
}
const terminal = ["succeeded", "failed", "rejected", "expired", "cancelled", "superseded"];
const live = ["ready", "running", "waiting", "backoff", "attention", "cancelling"];
function run(phase = "ready", extra = {}) {
  const ended = terminal.includes(phase);
  return {
    id: `run-${serial++}`,
    task_id: "task",
    revision: 1,
    version: 1,
    trigger_json: "{}",
    input_json: "{}",
    dedupe_key: null,
    lane_key: phase === "pending" ? "lane" : null,
    lane_capacity: phase === "pending" ? 1 : null,
    lane_overflow: phase === "pending" ? "queue" : null,
    max_executing: 1,
    phase,
    admitted_at_ms: phase === "pending" || phase === "superseded" ? null : 1,
    lease_token: ["running", "cancelling"].includes(phase) ? "lease" : null,
    wake_at_ms: phase === "backoff" ? 100 : null,
    end_json: ended ? "{}" : null,
    created_at_ms: 1,
    updated_at_ms: 1,
    ended_at_ms: ended ? 2 : null,
    ...extra,
  };
}
function step(runId, extra = {}) {
  return {
    run_id: runId,
    step_index: serial++,
    status: "done",
    output_json: "null",
    error_json: null,
    wait_kind: null,
    signal_name: null,
    signal_key: null,
    wake_at_ms: null,
    expires_at_ms: null,
    request_json: null,
    opened_at_ms: 1,
    settled_at_ms: 2,
    ...extra,
  };
}
function attempt(runId, extra = {}) {
  return {
    run_id: runId,
    step_index: 0,
    attempt_no: serial++,
    effect_key: "effect",
    policy_json: "{}",
    lease_token: "lease",
    session_id: null,
    origin: "driver",
    started_at_ms: 1,
    settled_at_ms: 2,
    outcome: "committed",
    detail_json: null,
    ...extra,
  };
}

test("SQLite opens only the nine architecture tables and uses durable exclusive WAL settings", (t) => {
  const { db, file } = database(t);
  assert.deepEqual(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name),
    ["attempts", "command_receipts", "grants", "runs", "signals", "steps", "task_revisions", "tasks", "triggers"],
  );
  for (const [pragma, expected] of [
    ["journal_mode", "wal"],
    ["synchronous", 2],
    ["foreign_keys", 1],
    ["locking_mode", "exclusive"],
    ["busy_timeout", 0],
  ]) {
    assert.equal(Object.values(db.prepare(`PRAGMA ${pragma}`).get())[0], expected);
  }
  const blocked = openAutomationDb(file);
  assert.equal(blocked.unavailable, "locked");
});

test("SQLite enforces every run phase, lane, lease, wake and termination CHECK", (t) => {
  const { db } = database(t);
  const invalid = [
    run("ready", { max_executing: 0 }),
    run("typo"),
    run("ready", { lane_key: "x" }),
    run("ready", { lane_capacity: 1 }),
    run("ready", { lane_overflow: "queue" }),
    run("ready", { lane_key: "x", lane_capacity: 1, lane_overflow: "invalid" }),
    run("pending", { admitted_at_ms: 1 }),
    run("pending", { lane_key: null, lane_capacity: null, lane_overflow: null }),
    run("superseded", { admitted_at_ms: 1 }),
    ...live.map((phase) => run(phase, { admitted_at_ms: null })),
    ...["running", "cancelling"].map((phase) => run(phase, { lease_token: null })),
    run("ready", { lease_token: "stale" }),
    run("backoff", { wake_at_ms: null }),
    run("ready", { wake_at_ms: 5 }),
    ...terminal.map((phase) => run(phase, { ended_at_ms: null, end_json: null })),
    run("ready", { ended_at_ms: 2, end_json: "{}" }),
    run("succeeded", { end_json: null }),
    run("ready", { end_json: "{}" }),
    run("ready", { max_executing: "wrong-type" }),
    run("ready", { task_id: "missing" }),
  ];
  for (const row of invalid)
    assert.throws(() => insert(db, "runs", row), /constraint|cannot store/i, JSON.stringify(row));
  for (const phase of ["pending", ...live, ...terminal])
    insert(db, "runs", run(phase, phase === "pending" ? { lane_key: `lane-${serial}` } : {}));
});

test("SQLite enforces every step status, settlement and wait metadata CHECK", (t) => {
  const { db } = database(t);
  const r = run();
  insert(db, "runs", r);
  const invalid = [
    step(r.id, { step_index: -1 }),
    step(r.id, { status: "invalid" }),
    step(r.id, { wait_kind: "invalid" }),
    step(r.id, { status: "waiting", settled_at_ms: null }),
    step(r.id, { settled_at_ms: null }),
    step(r.id, { status: "waiting", wait_kind: "approval", request_json: "{}", settled_at_ms: 2 }),
    step(r.id, { output_json: null }),
    step(r.id, { status: "failed" }),
    step(r.id, { status: "unknown" }),
    step(r.id, { wait_kind: "signal", signal_name: "ok" }),
    step(r.id, { wait_kind: "signal", signal_key: "key" }),
    step(r.id, { wait_kind: "approval" }),
    step(r.id, { wait_kind: "duration" }),
  ];
  for (const row of invalid) assert.throws(() => insert(db, "steps", row), /CHECK/);
  for (const row of [
    step(r.id),
    step(r.id, { status: "skipped", output_json: null }),
    step(r.id, { status: "unknown", error_json: "{}" }),
    step(r.id, { status: "failed", error_json: "{}" }),
    step(r.id, { status: "waiting", settled_at_ms: null, wait_kind: "signal", signal_name: "ok", signal_key: "key" }),
    step(r.id, { status: "waiting", settled_at_ms: null, wait_kind: "approval", request_json: "{}" }),
    step(r.id, { status: "waiting", settled_at_ms: null, wait_kind: "duration", wake_at_ms: 5 }),
  ])
    insert(db, "steps", row);
});

test("SQLite enforces task revision, consent, trigger and attempt CHECKs", (t) => {
  const { db } = database(t);
  assert.throws(() => db.prepare("UPDATE tasks SET enabled_revision = 2 WHERE id = 'task'").run(), /CHECK/);
  assert.throws(
    () => db.prepare("INSERT INTO task_revisions VALUES ('task', 0, '{}', '{}', 'h', '{}', 0)").run(),
    /CHECK/,
  );
  for (const field of ["unattended_write_approved", "trusted_local_exec_approved"])
    assert.throws(() => db.prepare(`UPDATE grants SET ${field} = 2`).run(), /CHECK/);
  for (const [kind, lifecycle] of [
    ["manual", "armed"],
    ["watch", "invalid"],
  ])
    assert.throws(
      () => db.prepare("INSERT INTO triggers VALUES ('task', 1, 't', ?, ?, 0, 0, '{}', NULL)").run(kind, lifecycle),
      /CHECK/,
    );
  const r = run();
  insert(db, "runs", r);
  for (const row of [
    attempt(r.id, { attempt_no: 0 }),
    attempt(r.id, { origin: "invalid" }),
    attempt(r.id, { outcome: "invalid" }),
    attempt(r.id, { outcome: null }),
    attempt(r.id, { settled_at_ms: null }),
  ])
    assert.throws(() => insert(db, "attempts", row), /CHECK/);
});

test("partial unique indexes enforce singleton live lanes and a single latest pending run", (t) => {
  const { db } = database(t);
  for (const phase of live) {
    const lane = `singleton-${phase}`;
    insert(db, "runs", run(phase, { lane_key: lane, lane_capacity: 1, lane_overflow: "queue" }));
    assert.throws(
      () => insert(db, "runs", run("ready", { lane_key: lane, lane_capacity: 1, lane_overflow: "queue" })),
      /UNIQUE/,
    );
  }
  insert(db, "runs", run("pending", { lane_key: "latest", lane_overflow: "latest" }));
  assert.throws(() => insert(db, "runs", run("pending", { lane_key: "latest", lane_overflow: "latest" })), /UNIQUE/);
  insert(db, "runs", run("cancelled", { lane_key: "latest", lane_capacity: 1, lane_overflow: "latest" }));
  const openRun = run("running");
  insert(db, "runs", openRun);
  insert(db, "attempts", attempt(openRun.id, { outcome: null, settled_at_ms: null }));
  assert.throws(
    () => insert(db, "attempts", attempt(openRun.id, { step_index: 1, outcome: null, settled_at_ms: null })),
    /UNIQUE/,
  );
  insert(db, "attempts", attempt(openRun.id));
});

test("dedupe excludes only cancelled and superseded runs and receipts and signals retain their primary keys", (t) => {
  const { db } = database(t);
  insert(db, "runs", run("succeeded", { dedupe_key: "order" }));
  assert.throws(() => insert(db, "runs", run("ready", { dedupe_key: "order" })), /UNIQUE/);
  insert(db, "runs", run("cancelled", { dedupe_key: "order" }));
  insert(db, "runs", run("superseded", { dedupe_key: "order" }));
  db.prepare("INSERT INTO command_receipts VALUES ('fire', 'request', 'digest', '{}', 1)").run();
  assert.throws(
    () => db.prepare("INSERT INTO command_receipts VALUES ('fire', 'request', 'other', '{}', 2)").run(),
    /UNIQUE/,
  );
  db.prepare("INSERT INTO signals VALUES ('task', 'audit', 'order', 'event', '{}', 1, 1)").run();
  assert.throws(
    () => db.prepare("INSERT INTO signals VALUES ('task', 'audit', 'order', 'event2', '{}', 1, 2)").run(),
    /UNIQUE/,
  );
});

test("transactions roll back data and notifications, then notify observers only after commit", (t) => {
  const { adb, db } = database(t);
  const notices = [];
  adb.onCommit((change) => {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs").get().n, 1);
    notices.push(change);
  });
  assert.throws(
    () =>
      adb.withTx(() => {
        insert(db, "runs", run());
        adb.notifyChange({ kind: "run_ready", runId: "rollback" });
        throw new Error("abort");
      }),
    /abort/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs").get().n, 0);
  assert.deepEqual(notices, []);
  adb.withTx(() => {
    insert(db, "runs", run());
    adb.notifyChange({ kind: "run_ready", runId: "committed" });
    assert.deepEqual(notices, []);
  });
  assert.deepEqual(notices, [{ kind: "run_ready", runId: "committed" }]);
});
