import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const loaded = await importTestBundle("automation-security", {
  stdin: {
    contents: `export * from "./src/main/credential-vault";
      export * from "./src/main/automation-consent";
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
const consent = () => ({
  kind: "enable",
  taskId: "report",
  revision: 3,
  taskName: "Daily report",
  planHash: hash,
  requiredGrant: {
    planHash: hash,
    requiresUnattendedWrite: true,
    requiresTrustedLocalExecution: false,
    httpOrigins: ["https://api.example.com"],
    channelTargets: [],
    scripts: [],
    secrets: ["api"],
    agentTools: [],
  },
});

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

test("native consent defaults to cancellation and binds approval to the displayed immutable definition", async () => {
  const request = consent();
  const shown = [];
  let response = 0;
  const confirm = loaded.createAutomationConsentRequestHandler(async (options) => {
    shown.push(options);
    request.planHash = "b".repeat(64);
    return { response };
  });
  const denied = await confirm("automationConsent.confirm", request);
  assert.equal(denied.confirmed, false);
  assert.equal(denied.planHash, hash);
  assert.equal(shown[0].defaultId, 0);
  assert.equal(shown[0].cancelId, 0);
  assert.match(shown[0].detail, /https:\/\/api.example.com/);
  assert.match(shown[0].detail, /api/);
  response = 1;
  assert.deepEqual(await confirm("automationConsent.confirm", consent()), {
    confirmed: true,
    taskId: "report",
    revision: 3,
    planHash: hash,
    requestId: null,
  });
  const resolution = {
    ...consent(),
    kind: "resolve",
    request: {
      runId: "run-1",
      stepIndex: 2,
      expectedVersion: 4,
      requestId: "decision-1",
      resolution: { kind: "attention", action: "confirm_cancelled" },
    },
  };
  assert.equal((await confirm("automationConsent.confirm", resolution)).requestId, "decision-1");
  assert.match(shown.at(-1).detail, /confirm_cancelled.*run-1.*4/);
  for (const invalid of [null, { ...consent(), planHash: "b".repeat(64) }, { ...consent(), revision: 0 }])
    await assert.rejects(confirm("automationConsent.confirm", invalid), /confirmation/);
  await assert.rejects(confirm("automationConsent.bypass", consent()), /Unsupported/);
});

test("Main Host router owns native consent and cannot mutate automation secrets", async (t) => {
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
  loaded.dialogs.response = 1;
  assert.equal((await main("automationConsent.confirm", consent())).confirmed, true);
  assert.equal(loaded.dialogs.calls.at(-1).defaultId, 0);
  assert.equal(await main("automationSecrets.get", { name: "api" }), "private-token");
  await assert.rejects(main("automationSecrets.set", { name: "api", value: "overwrite" }), /read-only/);
});

test("Desktop secret IPC accepts only the trusted main frame and never offers a value-reading method", async (t) => {
  const vault = fixtureVault(t);
  const mainFrame = {};
  const window = { isDestroyed: () => false, webContents: { mainFrame } };
  loaded.installDesktopIpc({ getMainWindow: () => window, automationSecrets: vault });
  const trusted = { sender: window.webContents, senderFrame: mainFrame };
  const set = loaded.handlers.get("desktop:set-automation-secret");
  const list = loaded.handlers.get("desktop:list-automation-secret-names");
  const remove = loaded.handlers.get("desktop:delete-automation-secret");
  assert.equal(set(trusted, "api", "private-value"), undefined);
  assert.deepEqual(list(trusted), ["api"]);
  assert.throws(() => list({ sender: window.webContents, senderFrame: {} }), /Untrusted/);
  assert.throws(() => set({ sender: {}, senderFrame: mainFrame }, "api", "overwrite"), /Untrusted/);
  assert.equal(loaded.handlers.has("desktop:get-automation-secret"), false);
  remove(trusted, "api");
  assert.deepEqual(list(trusted), []);
});
