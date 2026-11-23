import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import { createServer } from "node:http";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
import { createRpcClient, createRpcServer } from "../../contract/rpc.ts";
import { DaemonAutomationSecrets } from "../daemon-automation-secrets.ts";
import { startDaemonServer } from "../daemon-server.ts";
import { createWebSocketClientPort } from "../../contract/rpc-channel.ts";

const base = mkdtempSync(path.join(tmpdir(), "dexon-automation-handlers-"));
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
process.env.PI_OFFLINE = "1";
mkdirSync(process.env.PI_CODING_AGENT_DIR);
const { registerHandlers, setStandaloneMainRequestHandler, AdapterRegistry, FeishuAdapter } = await importTestBundle(
  "automation-handlers",
  {
    packages: "external",
    stdin: {
      contents: `export { registerHandlers } from "./src/agent-host/handlers";
      export { setStandaloneMainRequestHandler } from "./src/agent-host/parent-rpc";
      export { AdapterRegistry } from "./src/agent-host/channels/adapter-registry";
      export { FeishuAdapter } from "./src/agent-host/channels/adapters/feishu/adapter";`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
  },
);
test.after(() => rmSync(base, { recursive: true, force: true }));

async function until(check, label) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function host(t, options = {}) {
  const server = createRpcServer();
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1, "gatekeeper");
  const client = createRpcClient(port2, { callTimeoutMs: 10000 });
  const rendererChannel = new MessageChannel();
  server.attachPort(rendererChannel.port1);
  const renderer = createRpcClient(rendererChannel.port2, { callTimeoutMs: 10000 });
  const requests = [];
  setStandaloneMainRequestHandler(async (method, params) => {
    requests.push({ method, params });
    if (method === "automationSecrets.get") return options.secrets?.[params.name] ?? null;
    throw new Error(`Unexpected Main request: ${method}`);
  });
  const cleanup = registerHandlers(server, {
    channels: options.channels,
    automationSecrets: options.automationSecrets,
    automation: { dataDirectory: path.join(base, `automation-${t.name.replace(/[^a-z0-9]/giu, "-")}`) },
  });
  let stopped;
  const stop = () => (stopped ??= cleanup());
  t.after(async () => {
    await stop();
    client.close();
    renderer.close();
    server.detachPort(port1);
    server.detachPort(rendererChannel.port1);
  });
  return {
    server,
    client,
    renderer,
    stop,
    requests,
    async enable(spec) {
      const saved = await client.call("automation.saveTask", { spec });
      await client.call("automation.enableTask", {
        taskId: spec.id,
        revision: saved.revision,
        planHash: saved.planHash,
      });
      return saved;
    },
    async start(taskId, extra = {}) {
      return client.call("automation.startRun", { taskId, triggerId: "manual", input: null, ...extra });
    },
    async phase(runId, phase) {
      return until(async () => {
        const { run } = await client.call("automation.getRun", { runId });
        return run.phase === phase && run;
      }, phase);
    },
  };
}
const task = (id, steps) => ({
  schema: "dexon.automation/v1",
  id,
  name: id,
  cwd: base,
  triggers: [{ id: "manual", kind: "manual" }],
  steps,
});
const approval = { kind: "wait", id: "approve", wait: { kind: "approval", title: "Approve publication" } };
const duration = { kind: "wait", id: "hold", wait: { kind: "duration", duration: "7d" } };
async function endpoint(t, respond) {
  const server = createServer(respond);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test("automation handlers expose durable tasks, inbox decisions, signals and changes through the host RPC boundary", async (t) => {
  const f = await host(t);
  assert.deepEqual(await f.client.call("automation.listTasks"), { tasks: [] });
  const changes = [];
  f.client.subscribe("automation.changed", "*", (change) => changes.push(change));
  const saved = await f.enable(
    task("workflow", [
      approval,
      {
        kind: "wait",
        id: "signal",
        wait: { kind: "signal", signal: "audited", key: "contract-1", history: "retained" },
      },
    ]),
  );
  const revision = (await f.client.call("automation.getTask", { taskId: "workflow" })).task;
  assert.equal(revision.planHash, saved.planHash);
  assert.equal(revision.grant.planHash, saved.planHash);
  const started = await f.start("workflow", { expectedRevision: saved.revision, requestId: "workflow-start" });
  assert.equal(
    (await f.start("workflow", { expectedRevision: saved.revision, requestId: "workflow-start" })).runId,
    started.runId,
  );
  await f.phase(started.runId, "waiting");
  const item = (await f.client.call("automation.listInbox")).items[0];
  assert.equal(item.title, "Approve publication");
  const resolution = {
    runId: item.runId,
    stepIndex: item.stepIndex,
    expectedVersion: item.expectedVersion,
    requestId: "workflow-approve",
    resolution: { kind: "approval", approved: true },
  };
  assert.equal((await f.renderer.call("automation.resolveInbox", resolution)).ok, true);
  assert.equal((await f.renderer.call("automation.resolveInbox", resolution)).ok, true);
  await until(
    async () =>
      (await f.client.call("automation.getRun", { runId: started.runId })).run.steps.some(
        (step) => step.stepId === "signal",
      ),
    "signal wait",
  );
  assert.deepEqual(
    await f.client.call("automation.emitSignal", {
      taskId: "workflow",
      name: "audited",
      key: "contract-1",
      eventId: "audit-v1",
      payload: { approved: true },
    }),
    { woke: 1 },
  );
  await f.phase(started.runId, "succeeded");
  assert.equal((await f.client.call("automation.listRuns", { taskId: "workflow" })).runs.length, 1);
  await until(
    () => changes.some((change) => change.inboxChanged && change.runIds.includes(started.runId)),
    "change stream",
  );
  assert.deepEqual(f.requests, []);
  await f.client.call("automation.disableTask", { taskId: "workflow" });
  assert.equal((await f.client.call("automation.getTask", { taskId: "workflow" })).task.revision, 1);
  await f.client.call("automation.deleteTask", { taskId: "workflow" });
  assert.deepEqual((await f.client.call("automation.listTasks")).tasks, []);
});

test("renderer booleans cannot authorize enabling while gatekeeper enabling never asks the host for consent", async (t) => {
  const f = await host(t);
  const spec = task("consent", [duration]);
  const saved = await f.renderer.call("automation.saveTask", { spec });
  const request = {
    taskId: spec.id,
    revision: saved.revision,
    planHash: saved.planHash,
    unattendedWriteApproved: true,
    trustedLocalExecApproved: true,
  };
  await assert.rejects(f.renderer.call("automation.enableTask", request), (error) => error.code === "FORBIDDEN");
  assert.equal((await f.client.call("automation.getTask", { taskId: spec.id })).task.grant, null);
  const enabled = await f.client.call("automation.enableTask", request);
  assert.equal(enabled.task.enabledRevision, saved.revision);
  assert.equal((await f.client.call("automation.getTask", { taskId: spec.id })).task.grant.planHash, saved.planHash);
  assert.deepEqual(f.requests, []);
  await f.renderer.call("automation.saveTask", { spec: { ...spec, name: "Edited after authorization" } });
  await assert.rejects(f.client.call("automation.enableTask", request));
  assert.equal(
    (await f.client.call("automation.listTasks")).tasks.find((entry) => entry.id === spec.id).enabledRevision,
    null,
  );
  await assert.rejects(
    f.renderer.call("automation.listRuns", { phases: ["not-a-phase"] }),
    (error) => error.code === "BAD_REQUEST",
  );
  await assert.rejects(
    f.renderer.call("automation.resolveInbox", { runId: "unknown", resolution: { kind: "approval", approved: "yes" } }),
    (error) => error.code === "BAD_REQUEST",
  );
  await f.client.call("automation.deleteTask", { taskId: spec.id });
});

test("primary HTTP secrets use Main while attention resolution is isolated from renderer approval", async (t) => {
  let authorization;
  const origin = await endpoint(t, (request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(503);
    response.end();
  });
  const f = await host(t, { secrets: { api: "private-token" } });
  await f.enable(
    task("external-write", [
      {
        kind: "action",
        id: "write",
        call: {
          action: "http.request",
          with: { url: { origin }, method: "POST", secretHeaders: { Authorization: "api" }, effect: "unsafe" },
        },
      },
    ]),
  );
  const run = await f.start("external-write");
  await f.phase(run.runId, "attention");
  assert.equal(authorization, "private-token");
  assert.deepEqual(
    f.requests.filter((request) => request.method === "automationSecrets.get").map((request) => request.params),
    [{ name: "api" }],
  );
  const item = (await f.client.call("automation.listInbox")).items[0];
  const resolution = {
    runId: item.runId,
    stepIndex: item.stepIndex,
    expectedVersion: item.expectedVersion,
    requestId: "write-failed",
    resolution: { kind: "attention", action: "mark_failed" },
  };
  await assert.rejects(f.renderer.call("automation.resolveInbox", resolution), (error) => error.code === "BAD_REQUEST");
  await assert.rejects(f.client.call("automation.resolveInbox", resolution), (error) => error.code === "BAD_REQUEST");
  await assert.rejects(
    f.renderer.call("automation.resolveAttention", resolution),
    (error) => error.code === "FORBIDDEN",
  );
  await assert.rejects(
    f.client.call("automation.resolveAttention", { ...resolution, resolution: { kind: "approval", approved: true } }),
    (error) => error.code === "BAD_REQUEST",
  );
  await assert.rejects(
    f.client.call("automation.resolveAttention", {
      ...resolution,
      resolution: { kind: "attention", action: "unknown" },
    }),
    (error) => error.code === "BAD_REQUEST",
  );
  assert.equal((await f.client.call("automation.getRun", { runId: run.runId })).run.phase, "attention");
  assert.equal((await f.client.call("automation.resolveAttention", resolution)).ok, true);
  for (const action of ["mark_succeeded", "retry", "mark_failed", "confirm_cancelled"]) {
    assert.deepEqual(
      await f.client.call("automation.resolveAttention", {
        ...resolution,
        runId: "missing",
        requestId: `missing-${action}`,
        resolution: { kind: "attention", action },
      }),
      { ok: false, reason: "not_found" },
    );
  }
  assert.deepEqual(
    f.requests.map((request) => request.method),
    ["automationSecrets.get"],
  );
  await f.client.call("automation.deleteTask", { taskId: "external-write" });
});

test("run cancellation remains available through RPC for a suspended task", async (t) => {
  const f = await host(t);
  await f.enable(task("cancel", [duration]));
  const fact = { kind: "manual", reason: "operator request" };
  const started = await f.start("cancel", { expectedRevision: null, trigger: fact });
  assert.deepEqual((await f.client.call("automation.getRun", { runId: started.runId })).run.triggerFact, fact);
  await f.phase(started.runId, "waiting");
  assert.equal((await f.client.call("automation.cancelRun", { runId: started.runId })).run.phase, "cancelled");
  await f.client.call("automation.deleteTask", { taskId: "cancel" });
});

test("G17 shutdown drains automation delivery before stopping the shared channel manager", async (t) => {
  const registry = new AdapterRegistry();
  const messages = [];
  let stopped = false;
  let release;
  const delivery = new Promise((resolve) => {
    release = resolve;
  });
  registry.register(
    new FeishuAdapter({
      async getBotIdentity() {
        return { openId: "ou_bot", name: "Automation" };
      },
      async connect() {
        return {
          close() {
            stopped = true;
          },
        };
      },
      async sendText(_credentials, message) {
        messages.push(message);
        await delivery;
        assert.equal(stopped, false);
        return "om_once";
      },
    }),
  );
  const f = await host(t, {
    channels: {
      registry,
      dataDirectory: path.join(base, "channel-fixture"),
      secretAccess: {
        get: async () => ({ token: "fixture", providerAccountId: "ou_bot", baseUrl: "https://open.feishu.cn" }),
        set: async () => {},
        delete: async () => {},
      },
    },
  });
  await f.client.call("channels.accountUpsert", {
    account: {
      id: "feishu",
      channel: "feishu",
      name: "Automation",
      enabled: true,
      appId: "cli_1234567890abcdef",
      domain: "feishu",
      dmPolicy: "open",
      allowFrom: [],
      groupPolicy: "disabled",
      groupIds: [],
      groupAllowFrom: [],
      requireMention: true,
      toolNames: [],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  });
  await f.enable(
    task("delivery", [
      {
        kind: "action",
        id: "send",
        call: {
          action: "channel.send",
          with: { to: { accountId: "feishu", peerId: "ou_user" }, text: "Approved announcement" },
        },
      },
    ]),
  );
  const started = await f.start("delivery");
  await until(() => messages.length === 1, "delivery dispatched");
  const stopping = f.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  release();
  await stopping;
  assert.equal(stopped, true);
  assert.ok(messages[0].uuid);
  await assert.rejects(f.client.call("automation.listTasks"), (error) => error.code === "UNAVAILABLE");
  const restarted = await host(t);
  const restored = (await restarted.client.call("automation.getRun", { runId: started.runId })).run;
  assert.equal(restored.attempts[0].outcome, "committed");
  assert.equal(messages.length, 1);
  await restarted.client.call("automation.deleteTask", { taskId: "delivery" });
});

test("renderer and gatekeeper can observe automation activity without consent", async (t) => {
  const f = await host(t);
  const idle = { executingRuns: 0, cancellingRuns: 0, activeProbes: 0 };
  assert.deepEqual(await f.renderer.call("automation.activity"), idle);
  assert.deepEqual(await f.client.call("automation.activity"), idle);
  assert.deepEqual(f.requests, []);
});

test("primary host refuses all secret management even for gatekeeper ports without contacting Main", async (t) => {
  const f = await host(t);
  for (const [method, params] of [
    ["automation.setSecret", { name: "api", value: "private-token" }],
    ["automation.deleteSecret", { name: "api" }],
    ["automation.listSecretNames", undefined],
    ["automation.setSecret", null],
    ["automation.deleteSecret", null],
  ]) {
    await assert.rejects(f.client.call(method, params), (error) => {
      assert.equal(error.code, "FORBIDDEN");
      assert.equal(error.message, "Primary automation secrets are managed by desktop main process");
      return true;
    });
  }
  assert.deepEqual(f.requests, []);
});

test("standalone gatekeeper owns secret CRUD and HTTP execution while renderer cannot access secrets", async (t) => {
  const store = await DaemonAutomationSecrets.open(path.join(base, "standalone-automation.secrets.json"));
  const f = await host(t, { automationSecrets: store });
  for (const [method, params] of [
    ["automation.setSecret", { name: "api", value: "renderer-value" }],
    ["automation.deleteSecret", { name: "api" }],
    ["automation.listSecretNames", undefined],
  ]) {
    await assert.rejects(f.renderer.call(method, params), (error) => error.code === "FORBIDDEN");
    assert.deepEqual(await f.renderer.call("automation.listTasks"), { tasks: [] });
  }
  assert.deepEqual(await f.client.call("automation.listSecretNames"), { names: [] });
  assert.deepEqual(await f.client.call("automation.setSecret", { name: "z-key", value: "other" }), { ok: true });
  assert.deepEqual(await f.client.call("automation.setSecret", { name: "api", value: "first" }), { ok: true });
  assert.deepEqual(await f.client.call("automation.setSecret", { name: "api", value: "standalone-private-token" }), {
    ok: true,
  });
  assert.deepEqual(await f.client.call("automation.listSecretNames"), { names: ["api", "z-key"] });
  for (const [method, params, message] of [
    ["automation.setSecret", { name: "UPPER", value: "value" }, "Invalid automation secret name"],
    ["automation.deleteSecret", { name: "UPPER" }, "Invalid automation secret name"],
    ["automation.setSecret", { name: "api", value: "" }, "Invalid automation secret value"],
    ["automation.setSecret", { name: "api", value: "密".repeat(21_846) }, "Invalid automation secret value"],
  ]) {
    await assert.rejects(
      f.client.call(method, params),
      (error) => error.code === "BAD_REQUEST" && error.message === message,
    );
  }
  let authorization;
  const origin = await endpoint(t, (request, response) => {
    authorization = request.headers.authorization;
    response.setHeader("content-type", "application/json");
    response.end('{"ok":true}');
  });
  await f.enable(
    task("standalone-http", [
      {
        kind: "action",
        id: "request",
        call: {
          action: "http.request",
          with: {
            url: { origin },
            method: "GET",
            secretHeaders: { Authorization: "api" },
            effect: "read",
          },
        },
      },
    ]),
  );
  const run = await f.start("standalone-http");
  await f.phase(run.runId, "succeeded");
  assert.equal(authorization, "standalone-private-token");
  assert.deepEqual(f.requests, []);
  for (const name of ["api", "api", "missing", "z-key"]) {
    assert.deepEqual(await f.client.call("automation.deleteSecret", { name }), { ok: true });
  }
  assert.deepEqual(await f.client.call("automation.listSecretNames"), { names: [] });
  assert.equal(await store.read("api"), null);
  await f.client.call("automation.deleteTask", { taskId: "standalone-http" });
});

test(
  "token-authenticated daemon WebSockets dispatch gatekeeper methods through real host handlers",
  { timeout: 10_000 },
  async (t) => {
    const store = await DaemonAutomationSecrets.open(path.join(base, "websocket-automation.secrets.json"));
    const f = await host(t, { automationSecrets: store });
    const daemon = await startDaemonServer({
      rpcServer: f.server,
      getDescriptor: () => ({ environmentId: "daemon-automation" }),
      authToken: "a".repeat(64),
      listenPort: 0,
    });
    t.after(() => daemon.close());
    const endpoint = `ws://127.0.0.1:${daemon.port}/rpc?environmentId=daemon-automation`;
    const denied = new globalThis.WebSocket(`${endpoint}&token=wrong`);
    await new Promise((resolve, reject) => {
      denied.addEventListener("error", resolve, { once: true });
      denied.addEventListener("open", () => reject(new Error("Unauthenticated daemon connection was accepted")), {
        once: true,
      });
    });
    const socket = new globalThis.WebSocket(`${endpoint}&token=${"a".repeat(64)}`);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const remote = createRpcClient(createWebSocketClientPort(socket), { callTimeoutMs: 1_000 });
    t.after(() => remote.close());
    assert.deepEqual(await remote.call("automation.setSecret", { name: "api", value: "remote-private-token" }), {
      ok: true,
    });
    assert.deepEqual(await remote.call("automation.listSecretNames"), { names: ["api"] });
    assert.equal(await store.read("api"), "remote-private-token");
    assert.deepEqual(await remote.call("automation.activity"), {
      executingRuns: 0,
      cancellingRuns: 0,
      activeProbes: 0,
    });
    const spec = task("websocket-task", [duration]);
    const saved = await remote.call("automation.saveTask", { spec });
    assert.equal(
      (
        await remote.call("automation.enableTask", {
          taskId: spec.id,
          revision: saved.revision,
          planHash: saved.planHash,
        })
      ).task.enabledRevision,
      saved.revision,
    );
    assert.deepEqual(
      await remote.call("automation.resolveAttention", {
        runId: "missing",
        stepIndex: 0,
        expectedVersion: 1,
        requestId: "remote-attention",
        resolution: { kind: "attention", action: "mark_failed" },
      }),
      { ok: false, reason: "not_found" },
    );
    assert.deepEqual(await remote.call("automation.deleteSecret", { name: "api" }), { ok: true });
    assert.deepEqual(await remote.call("automation.listSecretNames"), { names: [] });
    await remote.call("automation.deleteTask", { taskId: spec.id });
    assert.deepEqual(f.requests, []);
  },
);
