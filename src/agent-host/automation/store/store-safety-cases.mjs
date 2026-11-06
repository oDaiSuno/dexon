import assert from "node:assert/strict";
import test from "node:test";
import {
  planNext,
  fixture,
  task,
  enable,
  fire,
  read,
  signal,
  agent,
  approval,
  next,
  applied,
  park,
  answer,
} from "./test-support.mjs";

test("the public run version changes when attempt evidence and step results change", (t) => {
  const f = fixture(t);
  enable(f.store, task([agent()]));
  const id = fire(f.store).runId;
  const lease = f.store.claimNextReady();
  const before = f.store.getRun(id).version;
  const ticket = f.store.beginAttempt(lease, next(f.store, lease), { kind: "read" });
  assert.ok(f.store.getRun(id).version > before);
  const started = f.store.getRun(id).version;
  f.store.settleAttempt(ticket, { kind: "committed", output: {} });
  assert.ok(f.store.getRun(id).version > started);
});

const auditTrigger = {
  id: "audit-watch",
  kind: "watch",
  every: "30s",
  probe: { action: "http.request", with: { url: { origin: "http://127.0.0.1:8080" } } },
  mode: { type: "items", itemsPath: "records", keyPath: "id", cursorPath: "cursor", emit: { emitSignal: "audited" } },
};

test("G3 an edited revision drains only its signal watch and removes it after its final waiter wakes", (t) => {
  const f = fixture(t);
  const spec = task([signal()], {
    triggers: [auditTrigger, { id: "manual", kind: "manual" }, { id: "schedule", kind: "schedule", every: "1m" }],
  });
  enable(f.store, spec);
  const id = fire(f.store, { key: "contract-1" }).runId;
  park(f.store, f.store.claimNextReady());
  f.advance(30000);
  const oldDue = f.store.listDueTriggers()[0];
  enable(f.store, spec);
  const due = f.store.listDueTriggers(Number.MAX_SAFE_INTEGER);
  assert.deepEqual(
    due.filter((item) => item.revision === 1).map((item) => [item.triggerId, item.lifecycle]),
    [["audit-watch", "draining"]],
  );
  assert.equal(
    f.store.recordTriggerSample(oldDue, {
      kind: "sample_ok",
      output: { records: [{ id: "contract-1" }], cursor: "page-2" },
    }).discarded,
    false,
  );
  assert.equal(f.store.getRun(id).phase, "ready");
  const remaining = f.store.listDueTriggers(Number.MAX_SAFE_INTEGER);
  assert.equal(
    remaining.some((item) => item.revision === 1),
    false,
  );
  assert.equal(
    remaining.some((item) => item.revision === 2 && item.triggerId === "audit-watch"),
    true,
  );
  assert.equal(f.store.recordTriggerSample(oldDue, { kind: "sample_ok", output: { records: [] } }).discarded, true);
});

test("G3 disabling keeps signal watches draining without admitting new runs", (t) => {
  const f = fixture(t);
  enable(f.store, task([signal()], { triggers: [auditTrigger, { id: "manual", kind: "manual" }] }));
  const id = fire(f.store, { key: "contract-1" }).runId;
  park(f.store, f.store.claimNextReady());
  f.store.disableTask("task");
  assert.equal(fire(f.store).reason, "task_disabled");
  const due = f.store.listDueTriggers(Number.MAX_SAFE_INTEGER)[0];
  assert.equal(due.lifecycle, "draining");
  f.store.recordTriggerSample(due, { kind: "sample_ok", output: { records: [{ id: "contract-1" }] } });
  assert.equal(f.store.getRun(id).phase, "ready");
  assert.equal(f.store.listDueTriggers(Number.MAX_SAFE_INTEGER).length, 0);
});

test("recover retries interrupted reads without consuming their one-attempt budget and stops on crash three", (t) => {
  const f = fixture(t);
  enable(f.store, task([agent()]));
  const id = fire(f.store).runId;
  let key;
  for (let interrupted = 1; interrupted <= 3; interrupted++) {
    const lease = f.store.claimNextReady();
    const ticket = f.store.beginAttempt(lease, next(f.store, lease), { kind: "read" });
    key ??= ticket.effectKey;
    assert.equal(ticket.effectKey, key);
    f.reopen();
    const report = f.store.recover();
    assert.equal(report.orphanedAttempts, 1);
    assert.equal(f.store.getRun(id).phase, interrupted === 3 ? "failed" : "ready");
    if (interrupted === 3) assert.deepEqual(report.crashLoops, [id]);
  }
  assert.deepEqual(
    f.store.getRun(id).attempts.map((attempt) => attempt.detail.code),
    ["host_interrupted", "host_interrupted", "crash_loop"],
  );
  assert.equal(f.store.recover().orphanedAttempts, 0);
});

test("recover quarantines unsafe writes and treats finite idempotency windows as expired after clock rollback", (t) => {
  for (const policy of [{ kind: "unsafe" }, { kind: "idempotent", windowMs: 3600000 }]) {
    const f = fixture(t);
    enable(f.store, task([read()]));
    const id = fire(f.store).runId;
    const lease = f.store.claimNextReady();
    f.store.beginAttempt(lease, next(f.store, lease), policy);
    f.advance(-1000);
    f.reopen();
    f.store.recover();
    assert.equal(f.store.getRun(id).phase, "attention");
    assert.equal(f.store.getRun(id).attempts[0].outcome, "outcome_unknown");
    assert.equal(f.store.listInbox().length, 1);
  }
});

test("unknown effects can be explicitly retried with the same effect key or manually reconciled", (t) => {
  const f = fixture(t);
  enable(f.store, task([read()]));
  const id = fire(f.store).runId;
  let lease = f.store.claimNextReady();
  const ticket = f.store.beginAttempt(lease, next(f.store, lease), { kind: "unsafe" });
  f.store.settleAttempt(ticket, { kind: "outcome_unknown", error: { code: "timeout", message: "Uncertain" } });
  assert.equal(answer(f.store, id, 0, { kind: "attention", action: "retry" }, "retry").ok, true);
  lease = f.store.claimNextReady();
  const second = f.store.beginAttempt(lease, next(f.store, lease), { kind: "unsafe" });
  assert.equal(second.effectKey, ticket.effectKey);
  assert.equal(f.store.getRun(id).attempts[1].origin, "user_retry");
  f.store.settleAttempt(second, { kind: "outcome_unknown", error: { code: "timeout", message: "Still uncertain" } });
  assert.equal(
    answer(f.store, id, 0, { kind: "attention", action: "mark_succeeded", output: { reconciled: true } }, "reconciled")
      .ok,
    true,
  );
  park(f.store, f.store.claimNextReady());
  assert.equal(f.store.getRun(id).phase, "succeeded");
});

test("duration waits and backoffs release execution slots and expiry respects continue versus fail", (t) => {
  const f = fixture(t);
  enable(
    f.store,
    task([
      { kind: "wait", id: "delay", wait: { kind: "duration", duration: "1s" } },
      { ...signal(), expiresIn: "1s", onTimeout: "continue" },
      read(),
    ]),
  );
  const id = fire(f.store, { key: "never" }).runId;
  park(f.store, f.store.claimNextReady());
  f.advance(1000);
  f.store.wakeDueRuns();
  assert.equal(f.store.getRun(id).phase, "ready");
  const lease = f.store.claimNextReady();
  const s = f.store.readRun(lease);
  f.store.commitMove(lease, planNextAt(s, 1001000));
  f.advance(1000);
  f.store.wakeDueRuns();
  assert.deepEqual(f.store.getRun(id).steps[1].output, { timedOut: true });
  assert.equal(f.store.getRun(id).phase, "ready");
  enable(f.store, task([{ ...approval, expiresIn: "1s" }], { id: "expires" }));
  const expiring = f.store.fire({ taskId: "expires", triggerId: "manual", input: {} }).runId;
  const other = f.store.claimNextReady();
  applied(f.store, other, {});
  park(f.store, other);
  const waiting = f.store.claimNextReady();
  park(f.store, waiting);
  f.advance(1000);
  f.store.wakeDueRuns();
  assert.equal(f.store.getRun(expiring).phase, "expired");
  assert.equal(f.store.listInbox().length, 0);
});

function planNextAt(snapshot, now) {
  return planNext(snapshot.run, snapshot.plan, snapshot.steps, snapshot.attempts, snapshot.signals, now);
}

test("queue caps, resolved lane keys, revision checks and deletion protect live runs", (t) => {
  const f = fixture(t);
  enable(
    f.store,
    task([read()], {
      concurrency: { lane: { key: { $tmpl: "{{input.warehouse}}" }, capacity: 1, overflow: "queue", maxPending: 1 } },
    }),
  );
  const first = fire(f.store, { warehouse: "north" }, { dedupeKey: "north-1" });
  assert.equal(first.outcome, "admitted");
  assert.equal(fire(f.store, { warehouse: "north" }).outcome, "enqueued");
  assert.equal(fire(f.store, { warehouse: "north" }).reason, "lane_full");
  assert.equal(fire(f.store, { warehouse: "south" }).outcome, "admitted");
  assert.equal(fire(f.store, { warehouse: "west" }, { expectedRevision: 99 }).reason, "revision_mismatch");
  assert.throws(() => f.store.deleteTask("task"), /live runs/);
  f.store.disableTask("task", true);
  assert.ok(f.store.listRuns().every((run) => run.phase === "cancelled"));
  f.store.deleteTask("task");
  assert.equal(f.store.getTask("task"), null);
});

test("task enabling requires the exact deep plan hash and both applicable desktop consents", (t) => {
  const f = fixture(t);
  const saved = f.store.saveTask(task([{ ...agent(), tools: ["bash"] }]));
  const hash = f.store.getTaskRevision("task", saved.currentRevision).planHash;
  assert.throws(
    () => f.store.enableTask("task", 1, "wrong", { unattendedWriteApproved: true, trustedLocalExecApproved: true }),
    /hash/,
  );
  assert.throws(
    () => f.store.enableTask("task", 1, hash, { unattendedWriteApproved: false, trustedLocalExecApproved: true }),
    /write consent/,
  );
  assert.throws(
    () => f.store.enableTask("task", 1, hash, { unattendedWriteApproved: true, trustedLocalExecApproved: false }),
    /local execution consent/,
  );
  f.store.enableTask("task", 1, hash, { unattendedWriteApproved: true, trustedLocalExecApproved: true });
  assert.equal(f.store.getTask("task").enabledRevision, 1);
});
