import assert from "node:assert/strict";
import { after } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { importTestBundle } from "#test-bundle";
import { startHeldModelServer, heldModel } from "../../../tests/fixtures/held-model-server.mjs";
import { installMainProcessPort } from "../../../tests/fixtures/main-process-port.mjs";

const restoreMain = installMainProcessPort();
after(restoreMain);

export const bundle = await importTestBundle("automation-runtime", {
  packages: "external",
  stdin: {
    contents: `export * from "./src/agent-host/automation/index";
      export { ChannelManager } from "./src/agent-host/channels/channel-manager";
      export { AdapterRegistry } from "./src/agent-host/channels/adapter-registry";
      export { ChannelConfigStore } from "./src/agent-host/channels/config-store";
      export { FeishuAdapter } from "./src/agent-host/channels/adapters/feishu/adapter";
      export { initializeSessionLauncher, launchAutomationSession } from "./src/agent-host/session-launcher";
      export { listRpcSessions } from "./src/agent-host/rpc-manager";
      export { registerHandlers } from "./src/agent-host/handlers";
      export { setStandaloneMainRequestHandler } from "./src/agent-host/parent-rpc";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
});
export async function until(check, label = "condition", timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
export async function fixture(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-automation-runtime-"));
  const cwd = path.join(directory, "workspace");
  mkdirSync(cwd);
  const model = await startHeldModelServer();
  const previous = new Map(
    ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_OFFLINE"].map((name) => [name, process.env[name]]),
  );
  const agentDir = path.join(directory, "agent");
  mkdirSync(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_CODING_AGENT_SESSION_DIR = path.join(directory, "sessions");
  process.env.PI_OFFLINE = "1";
  model.configure(agentDir);
  const sent = [];
  const registry = new bundle.AdapterRegistry();
  registry.register(
    new bundle.FeishuAdapter({
      async getBotIdentity() {
        return { openId: "ou_bot", name: "Automation" };
      },
      async connect() {
        return { close() {} };
      },
      async sendText(_credentials, message) {
        sent.push(message);
        return `om_${sent.length}`;
      },
      async sendCard(_credentials, message) {
        sent.push(message);
        return `om_${sent.length}`;
      },
    }),
  );
  const channelDir = path.join(directory, "channels");
  new bundle.ChannelConfigStore(path.join(channelDir, "channels.json")).upsertAccount({
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
  });
  const server = { emit() {}, handle() {} };
  bundle.initializeSessionLauncher(server);
  const channels = new bundle.ChannelManager(server, () => {}, {
    dataDirectory: channelDir,
    registry,
    bridge: {},
    secretAccess: {
      get: async () => ({ token: "fixture", providerAccountId: "ou_bot", baseUrl: "https://open.feishu.cn" }),
      set: async () => {},
      delete: async () => {},
    },
  });
  let now = 1000000;
  const errors = [];
  const deps = {
    dataDirectory: path.join(directory, "automation"),
    clock: { now: () => now },
    channels,
    agentSessions: { launch: bundle.launchAutomationSession },
    secrets: { read: async (name) => options.secrets?.[name] ?? null },
    limits: { maxConcurrentDrivers: 6, resumeGraceMs: 0, ...options.limits },
    onError: (error) => errors.push(error),
  };
  let runtime = bundle.createAutomationRuntime(deps);
  await runtime.start();
  assert.deepEqual(runtime.status(), { kind: "ready" });
  t.after(async () => {
    await runtime.stop();
    await channels.shutdown();
    await model.close();
    for (const [name, value] of previous)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    rmSync(directory, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  return {
    cwd,
    directory,
    model,
    sent,
    channels,
    deps,
    get runtime() {
      return runtime;
    },
    async restart() {
      await runtime.stop();
      runtime = bundle.createAutomationRuntime(deps);
      await runtime.start();
      assert.equal(runtime.status().kind, "ready");
    },
    async advance(ms) {
      now += ms;
      await runtime.tickNow();
    },
    now: () => now,
    async enable(spec) {
      const saved = await runtime.saveTask(spec);
      runtime.enableTask({
        taskId: spec.id,
        revision: saved.revision,
        planHash: saved.planHash,
        unattendedWriteApproved: true,
        trustedLocalExecApproved: true,
      });
      return saved;
    },
    start(taskId = "task", input = null, extra = {}) {
      return runtime.startRun({ taskId, triggerId: "manual", input, ...extra });
    },
    phase(runId, phase) {
      return until(() => runtime.getRun(runId).phase === phase && runtime.getRun(runId), `run ${runId} ${phase}`);
    },
    draft(prompt, result) {
      model.script(prompt, [{ toolCall: { name: "automation_result", input: result } }]);
    },
  };
}
export const task = (cwd, steps, extra = {}) => ({
  schema: "dexon.automation/v1",
  id: "task",
  name: "Automation",
  cwd,
  triggers: [{ id: "manual", kind: "manual" }],
  steps,
  ...extra,
});
export const agent = (id, prompt, schema = { type: "object" }) => ({
  kind: "agent",
  id,
  prompt,
  tools: [],
  model: heldModel,
  output: { schema },
});
export const send = (id, text, peerId = "ou_publish") => ({
  kind: "action",
  id,
  call: { action: "channel.send", with: { to: { accountId: "feishu", peerId }, text } },
});
export const http = (id, origin, options = {}) => ({
  kind: "action",
  id,
  call: { action: "http.request", with: { url: { origin }, ...options } },
});
export const duration = (duration = "7d") => ({ kind: "wait", id: "hold", wait: { kind: "duration", duration } });
export async function localHttp(t, respond) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({ method: request.method, headers: request.headers, url: request.url, body });
      respond(request, response, body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, server };
}
