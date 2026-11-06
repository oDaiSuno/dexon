import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTestBundle } from "#test-bundle";

const { AutomationStore } = await importTestBundle("automation-store", {
  entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
});
const { computePlanHash } = await importTestBundle("automation-store-grant", {
  entryPoints: [fileURLToPath(new URL("../spec/grant.ts", import.meta.url))],
});
const { planNext } = await importTestBundle("automation-store-machine", {
  entryPoints: [fileURLToPath(new URL("../core/run-machine.ts", import.meta.url))],
});

const clocks = new WeakMap();
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "dexon-automation-"));
  const file = join(dir, "automation.db");
  let now = 1000000;
  let store;
  const open = () => {
    store = AutomationStore.open(file, { now: () => now });
    assert.equal("unavailable" in store, false, store.detail);
    clocks.set(store, () => now);
    return store;
  };
  open();
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    file,
    advance(ms) {
      now += ms;
    },
    reopen() {
      store.close();
      return open();
    },
  };
}
function task(steps, extra = {}) {
  return {
    schema: "dexon.automation/v1",
    id: "task",
    name: "Task",
    cwd: tmpdir(),
    triggers: [{ id: "manual", kind: "manual" }],
    steps,
    ...extra,
  };
}
function enable(store, spec) {
  const saved = store.saveRevision(spec);
  store.enable(saved.id, saved.currentRevision, computePlanHash(store.getTaskPlan(saved.id, saved.currentRevision)), {
    unattendedWriteApproved: true,
    trustedLocalExecApproved: true,
  });
  return saved;
}
function fire(store, input = {}, extra = {}) {
  return store.fire({ taskId: "task", triggerId: "manual", input, ...extra });
}
const approval = {
  kind: "wait",
  id: "approve",
  wait: {
    kind: "approval",
    title: "Publish",
    fields: {
      type: "object",
      required: ["body"],
      properties: { body: { type: "string" } },
      additionalProperties: false,
    },
  },
};

const agent = (id = "draft") => ({
  kind: "agent",
  id,
  prompt: "Draft",
  tools: ["read"],
  output: { schema: { type: "object" } },
});
const read = (id = "load", extra = {}) => ({
  kind: "action",
  id,
  call: { action: "http.request", with: { url: { origin: "http://127.0.0.1:8080" } } },
  ...extra,
});
const signal = (id = "audit", name = "audited") => ({
  kind: "wait",
  id,
  wait: { kind: "signal", signal: name, key: { $tmpl: "{{input.key}}" } },
});
function next(store, lease, now = clocks.get(store)()) {
  const s = store.readRun(lease);
  return planNext(s.run, s.plan, s.steps, s.attempts, s.signals, now);
}
function applied(store, lease, output, policy = { kind: "read" }) {
  const move = next(store, lease);
  assert.equal(move.kind, "run_step");
  const ticket = store.beginAttempt(lease, move, policy);
  store.settleAttempt(ticket, { kind: "committed", output });
  return ticket;
}
function park(store, lease) {
  return store.commitMove(lease, next(store, lease));
}
function answer(store, runId, stepIndex, resolution, requestId = "answer") {
  return store.resolveInbox({ runId, stepIndex, resolution, requestId, expectedVersion: store.getRun(runId).version });
}

export {
  AutomationStore,
  planNext,
  computePlanHash,
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
};
