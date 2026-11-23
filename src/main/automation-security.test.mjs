import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import { bridgeRendererPort } from "./environments/renderer-port-bridge.ts";
import { RpcError } from "../contract/types.ts";
import { GATEKEEPER_METHODS } from "../contract/gatekeeper-methods.ts";
import { importTestBundle } from "#test-bundle";

const loaded = await importTestBundle("automation-security", {
  stdin: {
    contents: `export * from "./src/main/credential-vault";
      export * from "./src/main/automation-consent";
      export * from "./src/main/automation-authority";
      export * from "./src/main/host-services";
      export { installDesktopIpc } from "./src/main/ipc";
      export { handlers, dialogs } from "electron";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  plugins: [
    {
      name: "electron-vault",
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "vault" }));
        build.onLoad({ filter: /.*/, namespace: "vault" }, () => ({
          contents: `export const handlers = new Map();
            export const dialogs = { calls: [], response: 0 };
            export const dialog = { showMessageBox: async (...args) => { dialogs.calls.push(args.at(-1)); return { response: dialogs.response }; } };
            export const ipcMain = { handle(name, handler) { handlers.set(name, handler); }, on() {} };
            export const app = { getPath: () => "/fixture", getAppPath: () => "/fixture", getVersion: () => "1.0", getLocale: () => "zh-CN" };
            export const BrowserWindow = { getAllWindows: () => [] };
            export const Menu = {}; export const Notification = {}; export const protocol = {}; export const shell = {};
            export const clipboard = {};
            export const nativeTheme = {};
            export const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(Buffer.from(value).toString('base64')), decryptString: (value) => Buffer.from(value.toString(), 'base64').toString() };`,
          loader: "js",
        }));
      },
    },
  ],
});

test("automation secrets are encrypted in their own namespace", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-automation-vault-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "secrets.json");
  const vault = new loaded.CredentialVault(file);
  vault.set("automation:secret:api-key", { value: "private-value" });
  assert.equal(vault.get("automation:secret:api-key").value, "private-value");
  assert.doesNotMatch(readFileSync(file, "utf8"), /private-value/);
});

function fixtureVault(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-automation-secrets-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new loaded.CredentialVault(path.join(directory, "secrets.json"));
}
const hash = "a".repeat(64);
const taskRevision = () => ({
  taskId: "report",
  revision: 3,
  source: { name: "Daily report", cwd: "/srv/work" },
  planHash: hash,
  requiredGrant: {
    cwd: "/srv/work",
    planHash: hash,
    requiresTrustedLocalExecution: true,
    httpOrigins: ["https://api.example.com"],
    channelTargets: [],
    scripts: [{ path: "/srv/work/publish.sh", sha256: "b".repeat(64) }],
    secrets: ["api"],
    agentTools: [],
    unattendedWrites: [{ stepId: "publish", kind: "http_write" }],
  },
});
const enableCommand = (environmentId = "primary") => ({
  type: "enable-task",
  environmentId,
  taskId: "report",
  revision: 3,
  planHash: hash,
});
const attentionCommand = (environmentId = "primary") => ({
  type: "resolve-attention",
  environmentId,
  request: {
    runId: "run-1",
    stepIndex: 2,
    expectedVersion: 4,
    requestId: "decision-1",
    resolution: { kind: "attention", action: "confirm_cancelled" },
  },
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function authorityFixture(t, patch = {}) {
  const calls = [];
  let current = true;
  const revision = taskRevision();
  const run = {
    taskId: "report",
    revision: 3,
    version: 4,
    phase: "attention",
    steps: [{ stepIndex: 2, status: "unknown" }],
  };
  const target = {
    displayName: "GPU server",
    environmentId: "remote-route",
    serverEnvironmentId: "server-identity",
    isStillCurrent: () => current,
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === "automation.getTask") return { task: revision };
      if (method === "automation.getRun") return { run };
      if (method === "automation.enableTask") return { task: { id: "report", enabledRevision: 3 } };
      if (method === "automation.resolveAttention") return { ok: true, run };
      if (method === "automation.listSecretNames") return { names: ["remote.api"], value: "remote-private" };
      return { ok: true, value: params?.value ?? "remote-private" };
    },
  };
  const shown = [];
  const vault = fixtureVault(t);
  const authority = loaded.createAutomationAuthority({
    targets: {
      bindAutomationTarget: (environmentId) => {
        if (environmentId === "offline") throw new RpcError({ code: "DISCONNECTED", message: "Remote is offline" });
        return { ...target, environmentId };
      },
    },
    primarySecrets: vault,
    show: async (options) => {
      shown.push(options);
      return { response: 1 };
    },
    ...patch,
  });
  return {
    authority,
    calls,
    shown,
    vault,
    revision,
    run,
    target,
    invalidate: () => {
      current = false;
    },
  };
}

test("automation secret management exposes sorted names and isolates channel writes from Host read-only access", async (t) => {
  const vault = fixtureVault(t);
  vault.setAutomationSecret("z.api", "value-z");
  vault.setAutomationSecret("api", "private-value");
  vault.set("channel:telegram:demo", { token: "channel-token" });
  assert.deepEqual(vault.listAutomationSecretNames(), ["api", "z.api"]);
  const host = loaded.createAutomationSecretRequestHandler(vault);
  assert.equal(await host("automationSecrets.get", { name: "api" }), "private-value");
  assert.equal(await host("automationSecrets.get", { name: "absent" }), null);
  for (const name of ["", "UPPER", "../api", "channel:telegram:demo", "a".repeat(81), null]) {
    assert.throws(() => vault.setAutomationSecret(name, "value"), /secret name/);
    await assert.rejects(host("automationSecrets.get", { name }), /secret name/);
  }
  for (const value of ["", null, 42, "a".repeat(65537)])
    assert.throws(() => vault.setAutomationSecret("api", value), /secret value/);
  for (const method of ["automationSecrets.set", "automationSecrets.delete", "automationSecrets.list"]) {
    await assert.rejects(host(method, { name: "api", value: "overwrite" }), /read-only/);
  }
  const channel = loaded.createCredentialRequestHandler(vault);
  for (const method of ["channelSecrets.get", "channelSecrets.set", "channelSecrets.delete"]) {
    await assert.rejects(
      channel(method, { key: "automation:secret:api", value: { value: "overwrite" } }),
      /channel credential key/,
    );
  }
  assert.equal(await host("automationSecrets.get", { name: "api" }), "private-value");
  vault.deleteAutomationSecret("api");
  assert.deepEqual(vault.listAutomationSecretNames(), ["z.api"]);
});

test("unified automation IPC uses one cancellation-first native dialog with the complete target and grant", async (t) => {
  for (const environmentId of ["primary", "remote-route"]) {
    const fixture = authorityFixture(t);
    const mainFrame = {};
    const window = { isDestroyed: () => false, webContents: { mainFrame } };
    loaded.installDesktopIpc({ getMainWindow: () => window, automation: fixture.authority });
    const command = loaded.handlers.get("desktop:automation:command");
    const trusted = { sender: window.webContents, senderFrame: mainFrame };
    assert.equal((await command(trusted, enableCommand(environmentId))).outcome, "enabled");
    assert.equal(fixture.shown.length, 1);
    const options = fixture.shown[0];
    assert.equal(options.type, "warning");
    assert.deepEqual(options.buttons, ["取消", "确认"]);
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
    assert.equal(options.noLink, true);
    for (const field of [
      "GPU server",
      environmentId,
      "server-identity",
      "report",
      "3",
      hash,
      "/srv/work",
      "https://api.example.com",
      "/srv/work/publish.sh",
      "b".repeat(64),
      "api",
      "http_write",
      "publish",
    ])
      assert.ok(options.detail.includes(field), field);
    assert.deepEqual(
      await command(trusted, { type: "set-secret", environmentId, name: "api", value: "private-value" }),
      { ok: true },
    );
    assert.deepEqual(await command(trusted, { type: "list-secret-names", environmentId }), {
      names: environmentId === "primary" ? ["api"] : ["remote.api"],
    });
    assert.deepEqual(await command(trusted, { type: "delete-secret", environmentId, name: "api" }), { ok: true });
    assert.equal((await command(trusted, attentionCommand(environmentId))).outcome, "resolved");
    assert.equal(fixture.shown.length, 2);
    await assert.rejects(
      command(trusted, { type: "get-secret", environmentId, name: "api" }),
      /Invalid automation command: type/,
    );
    assert.throws(() => command({ sender: window.webContents, senderFrame: {} }, enableCommand()), /Untrusted/);
    await assert.rejects(
      command(trusted, { type: "set-secret", environmentId, name: "INVALID", value: "x" }),
      /Invalid automation command/,
    );
    await assert.rejects(command(trusted, enableCommand("offline")), /DISCONNECTED: Remote is offline/);
    for (const old of [
      "desktop:set-automation-secret",
      "desktop:delete-automation-secret",
      "desktop:list-automation-secret-names",
      "desktop:get-automation-secret",
    ])
      assert.equal(loaded.handlers.has(old), false);
  }
});

test("enable and attention commands send no restricted RPC until native confirmation and reject changed connections", async (t) => {
  for (const command of [enableCommand("remote-route"), attentionCommand("remote-route")]) {
    for (const decision of ["confirm", "cancel", "reconnect"]) {
      const pending = deferred();
      const opened = deferred();
      const shown = [];
      const fixture = authorityFixture(t, {
        show: (options) => {
          shown.push(options);
          opened.resolve();
          return pending.promise;
        },
      });
      const result = fixture.authority(command);
      await opened.promise;
      const restricted = () =>
        fixture.calls.filter(({ method }) => ["automation.enableTask", "automation.resolveAttention"].includes(method));
      assert.deepEqual(restricted(), []);
      if (command.type === "resolve-attention")
        for (const field of ["confirm_cancelled", "run-1", "4"]) assert.ok(shown[0].detail.includes(field));
      if (decision === "reconnect") fixture.invalidate();
      pending.resolve({ response: decision === "cancel" ? 0 : 1 });
      if (decision === "reconnect") await assert.rejects(result, (error) => error.code === "DISCONNECTED");
      else
        assert.equal(
          (await result).outcome,
          decision === "cancel" ? "cancelled" : command.type === "enable-task" ? "enabled" : "resolved",
        );
      assert.equal(restricted().length, decision === "confirm" ? 1 : 0);
      assert.equal(shown.length, 1);
    }
  }
});

test("stale task bindings and non-attention or stale run versions never open a dialog", async (t) => {
  for (const mutate of [
    (f) => {
      f.revision.planHash = "c".repeat(64);
    },
    (f) => {
      f.revision.requiredGrant.planHash = "c".repeat(64);
    },
    (f) => {
      f.revision.taskId = "other";
    },
    (f) => {
      f.revision.revision = 2;
    },
  ]) {
    const f = authorityFixture(t);
    mutate(f);
    await assert.rejects(f.authority(enableCommand()), (error) => error.code === "CONFLICT");
    assert.equal(f.shown.length, 0);
  }
  for (const mutate of [
    (f) => {
      f.run.phase = "running";
    },
    (f) => {
      f.run.version = 5;
    },
    (f) => {
      f.run.steps[0].status = "succeeded";
    },
  ]) {
    const f = authorityFixture(t);
    mutate(f);
    await assert.rejects(f.authority(attentionCommand()), (error) => error.code === "CONFLICT");
    assert.equal(f.shown.length, 0);
  }
});

test("remote text cannot inject lines into native consent", async () => {
  const task = taskRevision();
  task.source.name = "Task\r\nspoof\u001b";
  task.requiredGrant.cwd = "/srv\nspoof";
  task.requiredGrant.httpOrigins = ["https://api.example.com\r\nspoof"];
  task.requiredGrant.scripts[0].path = "/script\nspoof";
  task.requiredGrant.secrets = ["api\nspoof"];
  const options = loaded.automationDialog({
    kind: "enable",
    task,
    target: {
      displayName: "GPU\r\nspoof\u0001",
      environmentId: "route\nspoof",
      serverEnvironmentId: "server\r\nspoof",
    },
  });
  assert.doesNotMatch(options.message, /\p{Cc}/u);
  assert.doesNotMatch(options.detail, /\r|\nspoof/);
  assert.equal(
    [...options.detail].some((char) => char !== "\n" && /\p{Cc}/u.test(char)),
    false,
  );
  for (const value of ["GPUspoof", "routespoof", "serverspoof", "/srvspoof", "/scriptspoof", "apispoof"])
    assert.ok(options.detail.includes(value), value);
});

test("primary secrets stay in the vault and remote secret commands never fall back or return plaintext", async (t) => {
  const f = authorityFixture(t);
  assert.deepEqual(
    await f.authority({ type: "set-secret", environmentId: "primary", name: "api", value: "local-private" }),
    { ok: true },
  );
  assert.deepEqual(await f.authority({ type: "list-secret-names", environmentId: "primary" }), { names: ["api"] });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(
    await f.authority({ type: "set-secret", environmentId: "remote-route", name: "api", value: "remote-private" }),
    { ok: true },
  );
  assert.deepEqual(await f.authority({ type: "list-secret-names", environmentId: "remote-route" }), {
    names: ["remote.api"],
  });
  assert.equal(f.vault.get("automation:secret:api").value, "local-private");
  assert.deepEqual(await f.authority({ type: "delete-secret", environmentId: "remote-route", name: "api" }), {
    ok: true,
  });
  for (const type of ["set-secret", "delete-secret", "list-secret-names"])
    await assert.rejects(
      f.authority({ type, environmentId: "offline", name: "api", value: "overwrite" }),
      (error) => error.code === "DISCONNECTED",
    );
  assert.equal(f.vault.get("automation:secret:api").value, "local-private");
  assert.deepEqual(
    f.calls.map(({ method }) => method),
    ["automation.setSecret", "automation.listSecretNames", "automation.deleteSecret"],
  );
  assert.deepEqual(await f.authority({ type: "delete-secret", environmentId: "primary", name: "api" }), { ok: true });
  assert.deepEqual(f.vault.listAutomationSecretNames(), []);
});

test("the Host request router retains read-only secrets but rejects all native consent callbacks", async (t) => {
  const vault = fixtureVault(t);
  vault.setAutomationSecret("api", "private-token");
  let main;
  loaded.installHostServices({
    credentialVault: vault,
    getMainWindow: () => null,
    hostManager: {
      setBeforeRestartHandler() {},
      setToolchainSnapshot() {},
      setBrowserCapabilitySnapshot() {},
      setSessionOrchestrationSettings() {},
      setRequestHandler(handler) {
        main = handler;
      },
    },
    toolchainManager: { getSnapshot: () => ({}) },
    browserService: { getCapabilitySnapshot: () => ({}) },
  });
  await assert.rejects(main("automationConsent.confirm", {}), /Unsupported Host request/);
  assert.equal(await main("automationSecrets.get", { name: "api" }), "private-token");
  await assert.rejects(main("automationSecrets.set", { name: "api", value: "overwrite" }), /read-only/);
});

function rendererPort() {
  const port = new EventEmitter();
  port.sent = [];
  port.start = () => {};
  port.close = () => {
    port.closed = true;
  };
  port.postMessage = (message) => port.sent.push(message);
  port.request = (message) => port.emit("message", { data: message });
  return port;
}

test("renderer gatekeeper refusals preserve IDs, subscriptions and subsequent ordinary RPC", () => {
  const port = rendererPort();
  const sent = [];
  let receive;
  const close = bridgeRendererPort(port, {
    send: (message) => sent.push(message),
    onMessage: (listener) => {
      receive = listener;
      return () => {};
    },
    onClose: () => () => {},
  });
  port.request({ kind: "subscribe", id: "sub", topic: "automation.changed", key: "*" });
  for (let index = 0; index < 4100; index++) {
    const method = Object.keys(GATEKEEPER_METHODS)[index % 5];
    const id = `restricted-${index}`;
    port.request({ kind: "request", id, method });
    assert.equal(port.sent.at(-1)?.id, id);
    assert.equal(port.sent.at(-1)?.error.code, "FORBIDDEN");
  }
  assert.equal(sent.length, 1);
  assert.notEqual(port.closed, true);
  receive({ kind: "event", topic: "automation.changed", key: "*", data: { taskIds: ["report"] } });
  assert.deepEqual(port.sent.at(-1).data, { taskIds: ["report"] });
  port.request({ kind: "request", id: "normal", method: "automation.listTasks" });
  receive({ kind: "response", id: sent.at(-1).id, ok: true, result: { tasks: [] } });
  assert.deepEqual(port.sent.at(-1), { kind: "response", id: "normal", ok: true, result: { tasks: [] } });
  close();
});
