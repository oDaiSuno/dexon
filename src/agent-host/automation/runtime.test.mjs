import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fixture, task, agent, send, duration, http, localHttp, until, bundle } from "./runtime-test-support.mjs";

test("runtime starts ready before accepting durable work", async (t) => {
  const f = await fixture(t);
  assert.equal(f.runtime.status().kind, "ready");
  await f.runtime.start();
  assert.deepEqual(f.runtime.listTasks(), []);
});

test("Case A drafts JSON, sends a notice, survives approval restart with no sessions, and publishes once with uuid", async (t) => {
  const f = await fixture(t);
  f.draft("Draft announcement", { title: "New product", body: "Original draft" });
  const saved = await f.enable(
    task(f.cwd, [
      agent("draft", "Draft announcement", {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" } },
        required: ["title", "body"],
      }),
      {
        kind: "wait",
        id: "approve",
        wait: {
          kind: "approval",
          title: { $tmpl: "Review {{steps.draft.output.title}}" },
          fields: { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
          defaults: { body: { $ref: "steps.draft.output.body" } },
          notify: { to: { accountId: "feishu", peerId: "ou_review" } },
        },
      },
      send("publish", { $tmpl: "{{steps.approve.output.fields.body}}" }),
    ]),
  );
  const started = f.start("task", null, { expectedRevision: saved.revision, requestId: "manual-1" });
  const waiting = await f.phase(started.runId, "waiting");
  assert.equal(waiting.steps[1].stepId, "approve.notify");
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].peerId, "ou_review");
  assert.equal(bundle.listRpcSessions().length, 0);
  assert.equal(f.runtime.listInbox()[0].title, "Review New product");
  assert.deepEqual(
    f.model.requests()[0].tools.map((tool) => tool.function.name),
    ["automation_result"],
  );
  await f.restart();
  const item = f.runtime.listInbox()[0];
  const resolution = {
    runId: item.runId,
    stepIndex: item.stepIndex,
    expectedVersion: item.expectedVersion,
    requestId: "approve-once",
    resolution: { kind: "approval", approved: true, data: { body: "Reviewed announcement" } },
  };
  assert.equal(f.runtime.resolveInbox(resolution).ok, true);
  assert.equal(f.runtime.resolveInbox(resolution).ok, true);
  await f.phase(started.runId, "succeeded");
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].text, "Reviewed announcement");
  assert.ok(f.sent[1].uuid);
  assert.equal(f.runtime.getRun(started.runId).attempts.filter((attempt) => attempt.stepIndex === 3).length, 1);
  assert.equal(bundle.listRpcSessions().length, 0);
  assert.equal(f.start("task", null, { expectedRevision: saved.revision, requestId: "manual-1" }).runId, started.runId);
});

test("Case B watches health without sessions, ignores probe faults, resets stale failure streaks and observes cooldown", async (t) => {
  const f = await fixture(t);
  let status = 200;
  let malformed = false;
  const endpoint = await localHttp(t, (_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(malformed ? "not-json" : JSON.stringify({ healthy: status === 200 }));
  });
  f.draft("Diagnose outage", { notify: true, diagnosis: "Health endpoint down" });
  await f.enable(
    task(
      f.cwd,
      [
        agent("diagnose", "Diagnose outage"),
        {
          ...send("alert", { $tmpl: "{{steps.diagnose.output.diagnosis}}" }),
          when: { ref: "steps.diagnose.output.notify", op: "eq", value: true },
        },
      ],
      {
        triggers: [
          {
            id: "health",
            kind: "watch",
            every: "30s",
            staleResetGap: "5m",
            probe: { action: "http.request", with: { url: { origin: endpoint.origin } } },
            mode: {
              type: "threshold",
              healthy: { ref: "probe.output.healthy", op: "eq", value: true },
              consecutive: 3,
              cooldown: "30m",
            },
          },
        ],
      },
    ),
  );
  await f.advance(30000);
  assert.equal(f.runtime.listRuns().length, 0);
  assert.equal(f.model.requests().length, 0);
  status = 503;
  await f.advance(30000);
  await f.advance(30000);
  malformed = true;
  status = 200;
  await f.advance(30000);
  assert.equal(f.runtime.listRuns().length, 0);
  malformed = false;
  status = 503;
  await f.advance(600000);
  await f.advance(30000);
  assert.equal(f.runtime.listRuns().length, 0);
  await f.advance(30000);
  const run = await until(() => f.runtime.listRuns()[0]);
  await f.phase(run.id, "succeeded");
  assert.equal(f.sent.length, 1);
  assert.equal(f.runtime.listRuns().length, 1);
  status = 200;
  await f.advance(30000);
  status = 503;
  for (let i = 0; i < 4; i++) await f.advance(30000);
  assert.equal(f.runtime.listRuns().length, 1);
});

test("Case C1 archives 101 unique contracts, caps three executing runs, and draining signal watches finish old revisions", async (t) => {
  const f = await fixture(t);
  const archive = path.join(f.cwd, "archive.mjs");
  writeFileSync(
    archive,
    `import { writeFileSync } from 'node:fs'; let input = ''; for await (const chunk of process.stdin) input += chunk; const { args } = JSON.parse(input); writeFileSync(args.contractNo + '.json', JSON.stringify(args)); console.log(JSON.stringify({ archived: args.contractNo }));`,
  );
  const contracts = Array.from({ length: 101 }, (_, i) => ({ contractNo: `contract-${String(i).padStart(3, "0")}` }));
  let audited = [];
  let gating = true;
  const gates = [];
  const endpoint = await localHttp(t, (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/gate" && gating) {
      gates.push(response);
      return;
    }
    response.end(JSON.stringify({ items: request.url === "/audit" ? audited : contracts }));
  });
  for (const contract of contracts) {
    const prompt = `Parse ${contract.contractNo}!`;
    f.draft(prompt, contract);
  }
  const spec = task(
    f.cwd,
    [
      http("gate", endpoint.origin, { url: { origin: endpoint.origin, path: "/gate" } }),
      agent("parse", { $tmpl: "Parse {{input.contractNo}}!" }),
      {
        kind: "action",
        id: "archive",
        call: {
          action: "script.run",
          with: {
            path: "archive.mjs",
            args: { $ref: "steps.parse.output" },
            effect: { idempotent: { window: "forever" } },
          },
        },
      },
      {
        kind: "wait",
        id: "audit",
        wait: { kind: "signal", signal: "contract_audited", key: { $tmpl: "{{input.contractNo}}" } },
      },
    ],
    {
      concurrency: { maxExecuting: 3 },
      triggers: [
        { id: "manual", kind: "manual" },
        {
          id: "poll",
          kind: "watch",
          every: "30s",
          probe: { action: "http.request", with: { url: { origin: endpoint.origin, path: "/contracts" } } },
          mode: { type: "items", itemsPath: "items", keyPath: "contractNo", emit: { startRun: {} } },
        },
        {
          id: "audits",
          kind: "watch",
          every: "30s",
          probe: { action: "http.request", with: { url: { origin: endpoint.origin, path: "/audit" } } },
          mode: { type: "items", itemsPath: "items", keyPath: "contractNo", emit: { emitSignal: "contract_audited" } },
        },
      ],
    },
  );
  await f.enable(spec);
  await f.advance(30000);
  await until(() => gates.length === 3, "three active drivers");
  assert.equal(f.runtime.listRuns({ limit: 200, phases: ["running"] }).length, 3);
  assert.equal(f.runtime.listRuns({ limit: 200 }).length, 101);
  gating = false;
  for (const response of gates) response.end("{}");
  await until(() => f.runtime.listRuns({ limit: 200, phases: ["waiting"] }).length === 101, "101 durable waits", 90000);
  assert.equal(bundle.listRpcSessions().length, 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.cwd, "contract-000.json"), "utf8")), {
    contractNo: "contract-000",
  });
  await f.advance(30000);
  assert.equal(f.runtime.listRuns({ limit: 200 }).length, 101);
  await f.runtime.saveTask({ ...spec, name: "Edited contracts" });
  audited = contracts;
  await f.advance(30000);
  await until(() => f.runtime.listRuns({ limit: 200, phases: ["succeeded"] }).length === 101, "old revision audited");
  assert.equal(f.model.requests().length >= 101, true);
});

test("Case C2 singleton holds its lane while waiting and dirty cancellation keeps inventory reserved for reconciliation", async (t) => {
  const f = await fixture(t);
  const endpoint = await localHttp(t, (_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end('{"reserved":true}');
  });
  await f.enable(
    task(
      f.cwd,
      [
        http("reserve", endpoint.origin, {
          method: "POST",
          effect: { idempotent: { window: "forever" } },
          body: { batchId: { $ref: "run.id" } },
        }),
        duration(),
      ],
      { concurrency: { lane: { key: "singleton:inventory-plan", capacity: 1, overflow: "latest" } } },
    ),
  );
  const first = f.start();
  const waiting = await f.phase(first.runId, "waiting");
  assert.equal(JSON.parse(endpoint.requests[0].body).batchId, first.runId);
  const second = f.start();
  const third = f.start();
  assert.equal(f.runtime.getRun(second.runId).phase, "superseded");
  assert.equal(f.runtime.getRun(third.runId).phase, "pending");
  const cancelled = await f.runtime.cancelRun(first.runId);
  assert.equal(cancelled.phase, "attention");
  assert.equal(cancelled.admittedAtMs, waiting.admittedAtMs);
  assert.equal(f.runtime.getRun(third.runId).phase, "pending");
  const attention = f.runtime.listInbox()[0];
  assert.equal(attention.error.code, "cancel_requires_reconciliation");
  f.runtime.resolveInbox({
    ...attention,
    requestId: "reconciled",
    resolution: { kind: "attention", action: "confirm_cancelled" },
  });
  await f.phase(third.runId, "waiting");
  assert.equal(endpoint.requests.length, 2);
});
