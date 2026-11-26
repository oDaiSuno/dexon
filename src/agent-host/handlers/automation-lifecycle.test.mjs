import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
import { createRpcClient, createRpcServer } from "../../contract/rpc.ts";

const base = await fs.mkdtemp(path.join(tmpdir(), "dexon-automation-lifecycle-"));
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
process.env.PI_OFFLINE = "1";
const loaded = await importTestBundle("automation-lifecycle", {
  packages: "external",
  stdin: {
    contents: `export { registerAutomationHandlers } from "./src/agent-host/handlers/automation";
    export { createAutomationRuntime } from "./src/agent-host/automation";
    export { cacheSessionPath } from "./src/agent-host/session-reader";
    export { setSessionOrigin, getSessionOrigin, flushSessionOrigins } from "./src/agent-host/session-origin-store";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
});
test.after(async () => {
  await loaded.flushSessionOrigins();
  await fs.rm(base, { recursive: true, force: true });
});

async function fixture(t) {
  const home = path.join(base, t.name.replace(/[^a-z0-9]/giu, "-"));
  await fs.mkdir(home, { recursive: true });
  const runtime = loaded.createAutomationRuntime({
    dataDirectory: path.join(home, "data"),
    channels: {
      async sendAutomationMessage() {
        throw new Error("Unexpected delivery");
      },
    },
    agentSessions: {
      async launch() {
        throw new Error("Unexpected agent launch");
      },
    },
    secrets: {
      async read() {
        return null;
      },
    },
  });
  await runtime.start();
  const server = createRpcServer();
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1, "gatekeeper");
  const client = createRpcClient(port2, { callTimeoutMs: 3000 });
  const unsubscribe = loaded.registerAutomationHandlers(
    server,
    runtime,
    { kind: "desktop-main" },
    { getHome: () => home },
  );
  t.after(async () => {
    unsubscribe();
    client.close();
    server.detachPort(port1);
    await runtime.stop();
  });
  return { home, client, runtime };
}

function spec(id, cwd) {
  return {
    schema: "dexon.automation/v1",
    id,
    name: id,
    cwd,
    triggers: [{ id: "manual", kind: "manual" }],
    steps: [{ id: "hold", kind: "wait", wait: { kind: "duration", duration: "7d" } }],
  };
}

async function session(id, taskId, relation = "automation") {
  const file = path.join(base, "sessions", `${id}.jsonl`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: base }) + "\n",
  );
  loaded.cacheSessionPath(id, file);
  loaded.setSessionOrigin(id, {
    relation,
    ...(relation === "delegate" ? { createdBySessionId: "parent" } : {}),
    automationStep: { taskId, runId: "run", stepId: "hold", attemptNo: 1 },
  });
  return file;
}

async function missing(file) {
  await assert.rejects(fs.access(file), { code: "ENOENT" });
}

test("deleting a task removes only its sealed sessions and preserves external files and unrelated origins", async (t) => {
  const f = await fixture(t);
  const cwd = path.join(f.home, "external-project");
  await fs.mkdir(cwd);
  await fs.writeFile(path.join(cwd, "source.txt"), "keep source");
  const own = await session("owned", "external-task");
  const other = await session("other", "other-task");
  const delegated = await session("delegated", "external-task", "delegate");
  loaded.setSessionOrigin("missing-owned", {
    relation: "automation",
    automationStep: { taskId: "external-task", runId: "run", stepId: "hold", attemptNo: 1 },
  });
  await f.client.call("automation.saveTask", { spec: spec("external-task", cwd) });
  assert.deepEqual(await f.client.call("automation.deleteTask", { taskId: "external-task" }), { ok: true });
  await missing(own);
  assert.equal(loaded.getSessionOrigin("owned"), undefined);
  assert.equal(loaded.getSessionOrigin("missing-owned"), undefined);
  assert.equal(await fs.readFile(path.join(cwd, "source.txt"), "utf8"), "keep source");
  await fs.access(other);
  await fs.access(delegated);
  assert.equal(loaded.getSessionOrigin("other").automationStep.taskId, "other-task");
  assert.equal(loaded.getSessionOrigin("delegated").relation, "delegate");
  assert.deepEqual(await f.client.call("automation.listTasks"), { tasks: [] });
});

test("validating a task through RPC returns structured issues without saving or pausing its enabled revision", async (t) => {
  const f = await fixture(t);
  const definition = spec("validation", f.home);
  const saved = await f.client.call("automation.saveTask", { spec: definition });
  await f.client.call("automation.enableTask", {
    taskId: definition.id,
    revision: saved.revision,
    planHash: saved.planHash,
  });
  const invalid = await f.client.call("automation.validateTask", { spec: { ...definition, name: "" } });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => typeof issue.path === "string" && issue.message));
  const valid = await f.client.call("automation.validateTask", { spec: { ...definition, name: "Proposed edit" } });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.spec.name, "Proposed edit");
  assert.match(valid.planHash, /^[a-f0-9]{64}$/u);
  assert.ok(valid.requiredGrant);
  const current = (await f.client.call("automation.listTasks")).tasks[0];
  assert.equal(current.currentRevision, 1);
  assert.equal(current.enabledRevision, 1);
  assert.equal(current.name, "validation");
});

test("standalone validation leaves the workspace untouched and saving prepares its managed directory", async (t) => {
  const f = await fixture(t);
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = f.home;
  process.env.USERPROFILE = f.home;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const cwd = path.join(f.home, ".dexon", "automations", "standalone");
  const definition = spec("standalone", cwd);
  const validated = await f.client.call("automation.validateTask", { spec: definition });
  assert.equal(validated.valid, true);
  assert.deepEqual(await fs.readdir(f.home), []);
  const saved = await f.client.call("automation.saveTask", { spec: definition });
  assert.equal((await fs.stat(cwd)).isDirectory(), true);
  assert.equal(saved.planHash, validated.planHash);
  assert.deepEqual(saved.requiredGrant, validated.requiredGrant);
  await f.client.call("automation.deleteTask", { taskId: definition.id });
  await missing(cwd);
});

test("revision RPC reports newest first with authorization history and revision-specific run counts", async (t) => {
  const f = await fixture(t);
  const definition = spec("history", f.home);
  const first = await f.client.call("automation.saveTask", { spec: definition });
  await f.client.call("automation.enableTask", {
    taskId: definition.id,
    revision: first.revision,
    planHash: first.planHash,
  });
  const run = await f.client.call("automation.startRun", { taskId: definition.id, triggerId: "manual", input: null });
  await f.client.call("automation.cancelRun", { runId: run.runId });
  const second = await f.client.call("automation.saveTask", { spec: { ...definition, name: "Updated history" } });
  const { revisions } = await f.client.call("automation.listRevisions", { taskId: definition.id });
  assert.deepEqual(
    revisions.map(({ revision, isCurrent, isEnabled, wasGranted, runCount }) => ({
      revision,
      isCurrent,
      isEnabled,
      wasGranted,
      runCount,
    })),
    [
      { revision: 2, isCurrent: true, isEnabled: false, wasGranted: false, runCount: 0 },
      { revision: 1, isCurrent: false, isEnabled: false, wasGranted: true, runCount: 1 },
    ],
  );
  assert.equal(revisions[0].taskId, definition.id);
  assert.equal(revisions[0].planHash, second.planHash);
  assert.deepEqual(revisions[0].requiredGrant, second.requiredGrant);
  assert.ok(revisions.every((revision) => Number.isSafeInteger(revision.createdAtMs)));
  assert.deepEqual(await f.client.call("automation.listRevisions", { taskId: "missing" }), { revisions: [] });
});

test("deletion rejects active runs before touching sessions or managed task files", async (t) => {
  const f = await fixture(t);
  const cwd = path.join(f.home, ".dexon", "automations", "active");
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(path.join(cwd, "state.txt"), "keep state");
  const file = await session("active-owned", "active-task");
  const saved = await f.client.call("automation.saveTask", { spec: spec("active-task", cwd) });
  await f.client.call("automation.enableTask", {
    taskId: "active-task",
    revision: saved.revision,
    planHash: saved.planHash,
  });
  const run = await f.client.call("automation.startRun", { taskId: "active-task", triggerId: "manual", input: null });
  await assert.rejects(f.client.call("automation.deleteTask", { taskId: "active-task" }));
  assert.equal((await f.client.call("automation.listTasks")).tasks.length, 1);
  assert.equal(await fs.readFile(path.join(cwd, "state.txt"), "utf8"), "keep state");
  await fs.access(file);
  assert.equal(loaded.getSessionOrigin("active-owned").automationStep.taskId, "active-task");
  await f.client.call("automation.cancelRun", { runId: run.runId });
  await f.client.call("automation.deleteTask", { taskId: "active-task" });
  await missing(cwd);
  await missing(file);
  await fs.access(path.dirname(cwd));
});
