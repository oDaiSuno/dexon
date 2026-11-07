import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importTestBundle } from "#test-bundle";

const mod = await importTestBundle("automation-run-machine", {
  entryPoints: [fileURLToPath(new URL("./run-machine.ts", import.meta.url))],
});
const { planNext, classifyCommit } = mod;

const run = {
  id: "run-1",
  taskId: "task-1",
  phase: "running",
  laneKey: null,
  createdAtMs: 1000,
  input: { enabled: true },
  trigger: {},
};
const step = {
  stepIndex: 0,
  id: "inspect",
  kind: "agent",
  whenCond: { ref: "input.enabled", op: "eq", value: true },
  stopRunIfCond: null,
  effect: { kind: "read" },
  onFailure: "fail_run",
  onUnknown: "attention",
};

test("a true when condition executes the step rather than skipping it", () => {
  assert.deepEqual(planNext(run, { steps: [step] }, [], [], [], 2000), {
    kind: "run_step",
    stepIndex: 0,
  });
});

test("a non-read open attempt cannot be cleared by a later preflight rejection", () => {
  const error = { code: "unreachable", message: "Offline" };
  const prior = [{ outcome: null, policy: { kind: "unsafe" }, detail: null }];
  assert.deepEqual(
    classifyCommit({ kind: "not_applied", error, transient: false }, { kind: "unsafe" }, 1000, prior, 2000),
    { kind: "outcome_unknown", error },
  );
});

const { normalizeTaskSpec } = await importTestBundle("automation-normalize", {
  entryPoints: [fileURLToPath(new URL("../spec/normalize.ts", import.meta.url))],
});
const { computePlanHash, deriveRequiredGrant } = await importTestBundle("automation-grant", {
  entryPoints: [fileURLToPath(new URL("../spec/grant.ts", import.meta.url))],
});
const spec = {
  schema: "dexon.automation/v1",
  id: "task-1",
  name: "Task",
  cwd: "/tmp",
  triggers: [{ id: "manual", kind: "manual" }],
  steps: [{ kind: "agent", id: "read", prompt: "Read", tools: [], output: { schema: { type: "object" } } }],
};

test("normalization rejects empty, duplicate and forward-referenced step IDs", () => {
  assert.throws(() => normalizeTaskSpec({ ...spec, steps: [{ ...spec.steps[0], id: "" }] }));
  assert.throws(() => normalizeTaskSpec({ ...spec, steps: [spec.steps[0], spec.steps[0]] }));
  assert.throws(() =>
    normalizeTaskSpec({
      ...spec,
      steps: [
        { ...spec.steps[0], prompt: { $tmpl: "{{steps.later.output}}" } },
        { ...spec.steps[0], id: "later" },
      ],
    }),
  );
});

test("the plan hash includes nested effects and ignores object key insertion order", () => {
  const plan = normalizeTaskSpec(spec);
  const changed = structuredClone(plan);
  changed.steps[0].effect = { kind: "unsafe" };
  assert.notEqual(computePlanHash(plan), computePlanHash(changed));
  assert.equal(computePlanHash(plan), computePlanHash(JSON.parse(JSON.stringify(plan, null, 2))));
});

test("a later approval cannot authorize an earlier unattended write", () => {
  const plan = normalizeTaskSpec({
    ...spec,
    steps: [
      {
        kind: "action",
        id: "send",
        call: { action: "channel.send", with: { to: { accountId: "a", peerId: "p" }, text: "Hello" } },
      },
      { kind: "wait", id: "approve", wait: { kind: "approval", title: "Approve" } },
    ],
  });
  assert.deepEqual(deriveRequiredGrant(plan, spec).unattendedWrites, [{ stepId: "send", kind: "channel_send" }]);
});

const triggers = await importTestBundle("automation-triggers", {
  entryPoints: [fileURLToPath(new URL("./triggers.ts", import.meta.url))],
});
test("a health watch creates one alarm after three unhealthy samples and none on healthy samples", () => {
  const plan = normalizeTaskSpec({
    ...spec,
    triggers: [
      {
        id: "health",
        kind: "watch",
        every: "30s",
        probe: { action: "http.request", with: { url: { origin: "http://127.0.0.1:8080" } } },
        mode: {
          type: "threshold",
          healthy: { ref: "probe.ok", op: "eq", value: true },
          consecutive: 3,
          cooldown: "30m",
        },
      },
    ],
  }).triggers[0];
  let state = {
    kind: "threshold",
    consecutiveUnhealthy: 0,
    alarm: "closed",
    cooldownUntilMs: null,
    lastSampleAtMs: null,
  };
  for (let i = 0; i < 4; i++) {
    const result = triggers.reduceWatchSample(
      plan,
      state,
      { kind: "sample_failed", error: { code: "unreachable", message: "Offline" } },
      1000 + i * 30000,
    );
    assert.equal(result.fires.length, i === 2 ? 1 : 0);
    state = result.state;
  }
  assert.equal(triggers.reduceWatchSample(plan, state, { kind: "sample_ok", output: {} }, 150000).fires.length, 0);
});
