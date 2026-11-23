import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DaemonAutomationSecrets } from "./daemon-automation-secrets.ts";
import { StandaloneSecretStore } from "./standalone-secrets.ts";
import { importTestBundle } from "#test-bundle";

async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-daemon-automation-secrets-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "automation.secrets.json");
  return { directory, filePath, store: await DaemonAutomationSecrets.open(filePath) };
}

test("automation secrets survive reopening, overwrite idempotently and list sorted names", async (t) => {
  const { filePath, store } = await fixture(t);
  assert.equal(await store.read("api"), null);
  await store.set("z-key", "first");
  assert.equal(await store.read("z-key"), "first");
  await store.set("z-key", "replacement");
  await store.set("z-key", "replacement");
  await store.set("api", "other");
  const reopened = await DaemonAutomationSecrets.open(filePath);
  assert.equal(await reopened.read("z-key"), "replacement");
  assert.deepEqual(await reopened.listNames(), ["api", "z-key"]);
  await reopened.delete("missing");
  await reopened.delete("z-key");
  await reopened.delete("z-key");
  assert.equal(await store.read("z-key"), null);
  assert.deepEqual(await store.listNames(), ["api"]);
});

test("prototype-related names are ordinary persisted secrets and missing reads never expose inherited values", async (t) => {
  const { filePath, store } = await fixture(t);
  for (const name of ["__proto__", "constructor", "tostring", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(await store.read(name), null);
  }
  await store.set("__proto__", "proto-secret");
  await store.set("constructor", "constructor-secret");
  await store.set("tostring", "tostring-secret");
  const reopened = await DaemonAutomationSecrets.open(filePath);
  assert.deepEqual(await reopened.listNames(), ["__proto__", "constructor", "tostring"]);
  assert.equal(await reopened.read("__proto__"), "proto-secret");
  assert.equal(await reopened.read("constructor"), "constructor-secret");
  assert.equal(await reopened.read("tostring"), "tostring-secret");
  const persisted = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(Object.hasOwn(persisted.secrets, "__proto__"), true);
  assert.equal(persisted.secrets.__proto__, "proto-secret");
  for (const name of ["__proto__", "constructor", "tostring"]) {
    await reopened.delete(name);
    assert.equal(await store.read(name), null);
  }
  assert.deepEqual(await (await DaemonAutomationSecrets.open(filePath)).listNames(), []);
});

const badRequest = (message) => (error) => error.code === "BAD_REQUEST" && error.message === message;

test("secret mutations validate shared names and UTF-8 value limits without changing stored values", async (t) => {
  const { store } = await fixture(t);
  await store.set("api", "original");
  for (const name of ["", "UPPER", "a".repeat(81), "api\n", "channel:weixin:api", null, 12]) {
    await assert.rejects(store.set(name, "replacement"), badRequest("Invalid automation secret name"));
    await assert.rejects(store.delete(name), badRequest("Invalid automation secret name"));
  }
  for (const value of ["", null, 12, "a".repeat(65_537), "密".repeat(21_846)]) {
    await assert.rejects(store.set("api", value), badRequest("Invalid automation secret value"));
  }
  assert.equal(await store.read("api"), "original");
  await store.set("__proto__", "literal-key");
  assert.equal(await store.read("__proto__"), "literal-key");
  await store.set("limit", "a".repeat(65_536));
  assert.equal((await store.read("limit")).length, 65_536);
  await store.set("utf8", "密".repeat(21_845));
  assert.equal(await store.read("utf8"), "密".repeat(21_845));
});

test("secret files refuse existing and replacement symlinks without reading or changing their targets", async (t) => {
  const { directory, filePath, store } = await fixture(t);
  const target = path.join(directory, "sensitive.json");
  const contents = JSON.stringify({ version: 1, secrets: { api: "target-plaintext" } });
  writeFileSync(target, contents, { mode: 0o644 });
  if (process.platform !== "win32") chmodSync(target, 0o644);
  rmSync(filePath);
  try {
    symlinkSync(target, filePath);
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM")
      return t.skip("Symlink creation requires Windows privilege");
    throw error;
  }
  const safe = (error) => error.message === "Unable to read automation secrets" && error.cause === undefined;
  await assert.rejects(DaemonAutomationSecrets.open(filePath), safe);
  await assert.rejects(store.read("api"), safe);
  await assert.rejects(store.listNames(), safe);
  await assert.rejects(store.set("api", "replacement"), safe);
  await assert.rejects(store.delete("api"), safe);
  assert.equal(readFileSync(target, "utf8"), contents);
  assert.equal(lstatSync(filePath).isSymbolicLink(), true);
  if (process.platform !== "win32") assert.equal(lstatSync(target).mode & 0o777, 0o644);
});

test("corrupt or invalid secret files fail closed with fixed errors that never quote plaintext", async (t) => {
  const { filePath, store } = await fixture(t);
  for (const contents of [
    '{"version":1,"secrets":{"api":"private-plaintext"},broken}',
    JSON.stringify({ version: 2, secrets: { api: "private-plaintext" } }),
    JSON.stringify({ version: 1, secrets: ["private-plaintext"] }),
    JSON.stringify({ version: 1, secrets: { UPPER: "private-plaintext" } }),
    JSON.stringify({ version: 1, secrets: { api: 17 } }),
    "null",
  ]) {
    writeFileSync(filePath, contents);
    const safe = (error) => error.message === "Invalid automation secret file" && error.cause === undefined;
    await assert.rejects(DaemonAutomationSecrets.open(filePath), safe);
    await assert.rejects(store.read("api"), safe);
    await assert.rejects(store.listNames(), safe);
    await assert.rejects(store.set("api", "replacement"), safe);
    await assert.rejects(store.delete("api"), safe);
    assert.equal(readFileSync(filePath, "utf8"), contents);
  }
  rmSync(filePath);
  mkdirSync(filePath);
  await assert.rejects(store.read("api"), { message: "Unable to read automation secrets" });
});

test("every public secret operation wraps missing and non-file storage errors with the same safe message", async (t) => {
  for (const replacement of ["missing", "directory"]) {
    const { filePath, store } = await fixture(t);
    await store.set("api", "private-plaintext");
    rmSync(filePath);
    if (replacement === "directory") mkdirSync(filePath);
    const safe = (error) => error.message === "Unable to read automation secrets" && error.cause === undefined;
    await assert.rejects(store.read("api"), safe);
    await assert.rejects(store.set("api", "replacement"), safe);
    await assert.rejects(store.delete("api"), safe);
    await assert.rejects(store.listNames(), safe);
  }
});

test("every public secret operation wraps read permission errors without exposing file contents or causes", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) return t.skip("Requires POSIX file permissions");
  const { filePath, store } = await fixture(t);
  await store.set("api", "private-plaintext");
  chmodSync(filePath, 0o000);
  try {
    const safe = (error) => error.message === "Unable to read automation secrets" && error.cause === undefined;
    await assert.rejects(DaemonAutomationSecrets.open(filePath), safe);
    await assert.rejects(store.read("api"), safe);
    await assert.rejects(store.set("api", "replacement"), safe);
    await assert.rejects(store.delete("api"), safe);
    await assert.rejects(store.listNames(), safe);
  } finally {
    chmodSync(filePath, 0o600);
  }
  assert.equal(await store.read("api"), "private-plaintext");
});

test("failed private writes return a fixed safe error and preserve previous secrets", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) return t.skip("Requires POSIX directory permissions");
  const { directory, store } = await fixture(t);
  await store.set("api", "private-plaintext");
  chmodSync(directory, 0o500);
  try {
    const safe = (error) => error.message === "Unable to write automation secrets" && error.cause === undefined;
    await assert.rejects(store.set("api", "replacement"), safe);
    await assert.rejects(store.delete("api"), safe);
    assert.equal(await store.read("api"), "private-plaintext");
    assert.deepEqual(await store.listNames(), ["api"]);
  } finally {
    chmodSync(directory, 0o700);
  }
});

test("private automation files use mode 0600 and leave only the versioned final file after mutations", async (t) => {
  const { directory, filePath, store } = await fixture(t);
  await store.set("api", "private-value");
  await store.set("api", "replaced-value");
  if (process.platform !== "win32") {
    assert.equal(lstatSync(filePath).mode & 0o777, 0o600);
    chmodSync(filePath, 0o644);
    await DaemonAutomationSecrets.open(filePath);
    assert.equal(lstatSync(filePath).mode & 0o777, 0o600);
  }
  assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), { version: 1, secrets: { api: "replaced-value" } });
  await store.delete("api");
  assert.deepEqual(readdirSync(directory), ["automation.secrets.json"]);
  assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), { version: 1, secrets: {} });
});

test("automation stores never fall back to environment variables or share secrets across hosts or channel storage", async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const channels = new StandaloneSecretStore(path.join(first.directory, "channels.secrets.json"));
  const name = "dexon_automation_env_isolation";
  const previous = process.env[name];
  const upper = process.env[name.toUpperCase()];
  process.env[name] = "environment-private-value";
  process.env[name.toUpperCase()] = "environment-upper-private-value";
  try {
    assert.equal(await first.store.read(name), null);
    await first.store.set("api", "first-host-value");
    await second.store.set("api", "second-host-value");
    assert.equal(await first.store.read("api"), "first-host-value");
    assert.equal(await second.store.read("api"), "second-host-value");
    await first.store.delete("api");
    assert.equal(await second.store.read("api"), "second-host-value");
    await channels.handle("channelSecrets.set", { key: "channel:weixin:api", value: { token: "channel-value" } });
    assert.equal(await first.store.read("channel:weixin:api"), null);
    await first.store.set("api", "automation-value");
    assert.equal(await channels.handle("channelSecrets.get", { key: "channel:weixin:automation" }), null);
    await assert.rejects(channels.handle("channelSecrets.get", { key: "api" }), {
      message: "Invalid channel credential key",
    });
    assert.deepEqual(await channels.handle("channelSecrets.get", { key: "channel:weixin:api" }), {
      token: "channel-value",
    });
    assert.deepEqual(await first.store.listNames(), ["api"]);
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
    if (upper === undefined) delete process.env[name.toUpperCase()];
    else process.env[name.toUpperCase()] = upper;
  }
});

test("standalone platform exposes its own automation store but never provides automation main requests", async (t) => {
  const { directory } = await fixture(t);
  const temporaryRoot = path.join(process.cwd(), ".artifacts");
  mkdirSync(temporaryRoot, { recursive: true });
  const { initializeStandaloneHostPlatform, callMain } = await importTestBundle(
    "standalone-automation-platform",
    {
      packages: "external",
      stdin: {
        contents:
          'export { initializeStandaloneHostPlatform } from "./src/agent-host/platform-services"; export { callMain } from "./src/agent-host/parent-rpc";',
        resolveDir: process.cwd(),
        loader: "ts",
      },
    },
    { temporaryRoot },
  );
  const previous = process.env.PI_DESKTOP_USER_DATA;
  let platform;
  try {
    platform = await initializeStandaloneHostPlatform({ stateDir: directory, piVersion: "1.4.0" });
    assert.equal(typeof platform.automationSecrets?.set, "function");
    await platform.automationSecrets.set("api", "standalone-only");
    assert.equal(
      await (await DaemonAutomationSecrets.open(path.join(directory, "automation.secrets.json"))).read("api"),
      "standalone-only",
    );
    for (const method of [
      "automationSecrets.get",
      "automationSecrets.set",
      "automationSecrets.delete",
      "automationSecrets.listNames",
      "automationConsent.confirm",
    ]) {
      await assert.rejects(callMain(method, { name: "api", value: "rejected" }), {
        message: `Unsupported Host request: ${method}`,
      });
    }
    assert.equal(await platform.automationSecrets.read("api"), "standalone-only");
    await callMain("channelSecrets.set", { key: "channel:weixin:platform", value: { token: "channel-only" } });
    assert.equal(await platform.automationSecrets.read("channel:weixin:platform"), null);
  } finally {
    await platform?.dispose();
    if (previous === undefined) delete process.env.PI_DESKTOP_USER_DATA;
    else process.env.PI_DESKTOP_USER_DATA = previous;
  }
});
