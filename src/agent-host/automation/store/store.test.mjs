import assert from "node:assert/strict";
import test from "node:test";
import {
  planNext,
  fixture,
  task,
  enable,
  fire,
  approval,
  agent,
  read,
  signal,
  next,
  applied,
  park,
  answer,
} from "./test-support.mjs";

test("Case A persists a rendered approval across reopening and resumes the same admitted run", (t) => {
  const f = fixture(t);
  enable(f.store, task([approval]));
  const started = fire(f.store);
  const lease = f.store.claimNextReady();
  const snapshot = f.store.readRun(lease);
  const move = planNext(snapshot.run, snapshot.plan, snapshot.steps, snapshot.attempts, snapshot.signals, 1000000);
  assert.equal(f.store.commitMove(lease, move).kind, "parked");
  const admitted = f.store.getRun(started.runId).admittedAtMs;
  f.reopen();
  assert.equal(f.store.listInbox()[0].title, "Publish");
  const waiting = f.store.getRun(started.runId);
  const result = f.store.resolveInbox({
    runId: started.runId,
    stepIndex: 0,
    expectedVersion: waiting.version,
    requestId: "approve-1",
    resolution: { kind: "approval", approved: true, data: { body: "Edited" } },
  });
  assert.equal(result.ok, true);
  assert.equal(f.store.getRun(started.runId).phase, "ready");
  assert.equal(f.store.getRun(started.runId).admittedAtMs, admitted);
});

test("Case A drafts, sends a nonblocking notice, stores edited approval fields and publishes once", (t) => {
  const f = fixture(t);
  const spec = task([
    agent(),
    {
      ...approval,
      wait: {
        ...approval.wait,
        title: { $tmpl: "Review {{steps.draft.output.title}}" },
        defaults: { body: { $ref: "steps.draft.output.body" } },
        notify: { to: { accountId: "feishu", peerId: "reviewer" } },
      },
    },
    {
      kind: "action",
      id: "publish",
      call: {
        action: "channel.send",
        with: {
          to: { accountId: "feishu", peerId: "announcements" },
          text: { $tmpl: "{{steps.approve.output.fields.body}}" },
        },
      },
    },
  ]);
  enable(f.store, spec);
  const runId = fire(f.store).runId;
  let lease = f.store.claimNextReady();
  applied(f.store, lease, { title: "Feature", body: "Draft" });
  const notice = f.store.beginAttempt(lease, next(f.store, lease), { kind: "unsafe" });
  f.store.settleAttempt(notice, { kind: "outcome_unknown", error: { code: "timeout", message: "No receipt" } });
  assert.equal(park(f.store, lease).kind, "parked");
  assert.equal(f.store.listInbox()[0].title, "Review Feature");
  assert.deepEqual(f.store.listInbox()[0].defaults, { body: "Draft" });
  f.reopen();
  assert.equal(answer(f.store, runId, 2, { kind: "approval", approved: true, data: { body: "Edited" } }).ok, true);
  lease = f.store.claimNextReady();
  applied(f.store, lease, { messageId: "sent-1" }, { kind: "idempotent", windowMs: 3600000 });
  assert.equal(park(f.store, lease).kind, "ended");
  const run = f.store.getRun(runId);
  assert.equal(run.phase, "succeeded");
  assert.equal(run.steps[2].output.fields.body, "Edited");
  assert.deepEqual(run.end, { output: { messageId: "sent-1" } });
  assert.equal(run.attempts.filter((attempt) => attempt.stepIndex === 3).length, 1);
});

test("Case B performs healthy and failed samples without runs until the third failure", (t) => {
  const f = fixture(t);
  enable(
    f.store,
    task([agent()], {
      triggers: [
        {
          id: "health",
          kind: "watch",
          every: "30s",
          staleResetGap: "5m",
          probe: { action: "http.request", with: { url: { origin: "http://127.0.0.1:8080" } } },
          mode: {
            type: "threshold",
            healthy: { ref: "probe.ok", op: "eq", value: true },
            consecutive: 3,
            cooldown: "30m",
          },
        },
      ],
    }),
  );
  for (let i = 0; i < 6; i++) {
    f.advance(30000);
    const due = f.store.listDueTriggers(Number.MAX_SAFE_INTEGER)[0];
    f.store.recordTriggerSample(
      due,
      i < 2
        ? { kind: "sample_ok", output: { ok: true } }
        : { kind: "sample_failed", error: { code: "unreachable", message: "Offline" } },
    );
    assert.equal(f.store.listRuns().length, i < 4 ? 0 : 1);
  }
  const lease = f.store.claimNextReady();
  applied(f.store, lease, { diagnosis: "Service down" });
  park(f.store, lease);
  assert.equal(f.store.listRuns()[0].phase, "succeeded");
});

test("Case C1 allows 101 durable contract waits while enforcing three executing runs", (t) => {
  const f = fixture(t);
  enable(f.store, task([agent("parse"), signal()], { concurrency: { maxExecuting: 3 } }));
  const ids = Array.from(
    { length: 101 },
    (_, index) => fire(f.store, { key: `contract-${index}` }, { dedupeKey: `contract-${index}` }).runId,
  );
  const first = [f.store.claimNextReady(), f.store.claimNextReady(), f.store.claimNextReady()];
  assert.equal(f.store.claimNextReady(), null);
  for (const lease of first) {
    applied(f.store, lease, {});
    park(f.store, lease);
  }
  let lease;
  while ((lease = f.store.claimNextReady())) {
    applied(f.store, lease, {});
    park(f.store, lease);
  }
  assert.equal(f.store.listRuns({ phases: ["waiting"], limit: 200 }).length, 101);
  f.reopen();
  assert.equal(
    f.store.emitSignal("task", {
      name: "audited",
      key: "contract-0",
      eventId: "approved-0",
      payload: { approved: true },
    }).woke.length,
    1,
  );
  lease = f.store.claimNextReady();
  assert.equal(lease.runId, ids[0]);
  park(f.store, lease);
  assert.equal(f.store.getRun(ids[0]).phase, "succeeded");
  assert.equal(f.store.listRuns({ phases: ["waiting"], limit: 200 }).length, 100);
});

test("Case C2 retains the singleton lane during waiting and supersedes only pending planners", (t) => {
  const f = fixture(t);
  enable(
    f.store,
    task([read(), signal("confirm", "confirmed")], {
      concurrency: { lane: { capacity: 1, overflow: "latest", key: "inventory" } },
    }),
  );
  const first = fire(f.store, { key: "batch-1" }).runId;
  const lease = f.store.claimNextReady();
  applied(f.store, lease, { stock: 12 });
  park(f.store, lease);
  const second = fire(f.store, { key: "batch-2" }).runId;
  const third = fire(f.store, { key: "batch-3" }).runId;
  assert.equal(f.store.getRun(second).phase, "superseded");
  assert.equal(f.store.getRun(third).phase, "pending");
  assert.equal(f.store.claimNextReady(), null);
  f.store.emitSignal("task", { name: "confirmed", key: "batch-1", eventId: "batch-1-confirmed", payload: true });
  const resumed = f.store.claimNextReady();
  assert.equal(resumed.runId, first);
  park(f.store, resumed);
  assert.equal(f.store.getRun(third).phase, "ready");
});

test("G1 dirty running cancellation keeps its lease until quiescence and holds the lane until reconciliation", (t) => {
  const f = fixture(t);
  const write = {
    kind: "action",
    id: "reserve",
    call: { action: "http.request", with: { method: "POST", url: { origin: "http://127.0.0.1:8080" } } },
  };
  enable(f.store, task([write], { concurrency: { lane: { capacity: 1, overflow: "queue" } } }));
  const first = fire(f.store).runId;
  const second = fire(f.store).runId;
  const lease = f.store.claimNextReady();
  const ticket = f.store.beginAttempt(lease, next(f.store, lease), { kind: "unsafe" });
  assert.equal(f.store.cancelRun(first).phase, "cancelling");
  assert.equal(f.store.getRun(first).leaseToken, lease.leaseToken);
  assert.throws(() => f.store.settleCancelledRun(lease), /quiesce/);
  f.store.settleAttempt(ticket, { kind: "committed", output: { reserved: true } });
  assert.equal(f.store.settleCancelledRun(lease).phase, "attention");
  assert.notEqual(f.store.getRun(first).admittedAtMs, null);
  assert.equal(f.store.getRun(second).phase, "pending");
  assert.equal(answer(f.store, first, 0, { kind: "attention", action: "confirm_cancelled" }).ok, true);
  assert.equal(f.store.getRun(second).phase, "ready");
});

test("clean cancellation releases the lane only after a running read quiesces", (t) => {
  const f = fixture(t);
  enable(f.store, task([read()], { concurrency: { lane: { capacity: 1, overflow: "queue" } } }));
  const first = fire(f.store).runId;
  const second = fire(f.store).runId;
  const lease = f.store.claimNextReady();
  assert.equal(f.store.cancelRun(first).phase, "cancelling");
  assert.equal(f.store.getRun(second).phase, "pending");
  assert.equal(f.store.settleCancelledRun(lease).phase, "cancelled");
  assert.equal(f.store.getRun(second).phase, "ready");
});

test("G5 command receipts reject changed content and approvals enforce expectedVersion", (t) => {
  const f = fixture(t);
  enable(f.store, task([approval]));
  const first = fire(f.store, {}, { requestId: "fire-once" });
  assert.deepEqual(fire(f.store, {}, { requestId: "fire-once" }), first);
  assert.throws(() => fire(f.store, { changed: true }, { requestId: "fire-once" }), /different command/);
  park(f.store, f.store.claimNextReady());
  const waiting = f.store.getRun(first.runId);
  const request = {
    runId: first.runId,
    stepIndex: 0,
    requestId: "approval-once",
    expectedVersion: waiting.version,
    resolution: { kind: "approval", approved: true, data: { body: "Final" } },
  };
  assert.equal(
    f.store.resolveInbox({ ...request, requestId: "stale", expectedVersion: waiting.version - 1 }).reason,
    "version_conflict",
  );
  const accepted = f.store.resolveInbox(request);
  assert.equal(accepted.ok, true);
  assert.deepEqual(f.store.resolveInbox(request), accepted);
  assert.throws(
    () => f.store.resolveInbox({ ...request, resolution: { kind: "approval", approved: false } }),
    /different command/,
  );
});

test("G7 mailbox linearizes signal arrival between planning and opening a wait", (t) => {
  const f = fixture(t);
  enable(f.store, task([signal()]));
  const id = fire(f.store, { key: "early" }).runId;
  const lease = f.store.claimNextReady();
  const move = next(f.store, lease);
  assert.equal(move.kind, "open_wait");
  const emit = { name: "audited", key: "early", eventId: "same-fact", payload: { ready: true } };
  assert.deepEqual(f.store.emitSignal("task", emit).woke, []);
  assert.equal(f.store.commitMove(lease, move).kind, "continue");
  assert.deepEqual(f.store.getRun(id).steps[0].output, { ready: true });
  park(f.store, lease);
  f.advance(1000);
  fire(f.store, { key: "early" });
  const second = f.store.claimNextReady();
  park(f.store, second);
  assert.deepEqual(f.store.emitSignal("task", emit).woke, []);
  assert.equal(f.store.getRun(second.runId).phase, "waiting");
  assert.equal(f.store.emitSignal("task", { ...emit, eventId: "new-fact" }).woke.length, 1);
});

import "./store-safety-cases.mjs";

import "./schema-cases.mjs";
