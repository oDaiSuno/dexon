import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const agentDirectory = mkdtempSync(path.join(tmpdir(), "dexon-session-naming-settings-"));
const variables = ["PI_CODING_AGENT_DIR", "PI_DESKTOP_USER_DATA"];
const previous = new Map(variables.map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = agentDirectory;
delete process.env.PI_DESKTOP_USER_DATA;
const settingsFile = path.join(agentDirectory, "desktop", "session-naming.json");
const defaults = { enabled: true, model: null, configured: false };
const preferred = { provider: "naming-provider", modelId: "naming-model" };

beforeEach(() => rmSync(path.dirname(settingsFile), { recursive: true, force: true }));
after(() => {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(agentDirectory, { recursive: true, force: true });
});

const settings = await importTestBundle("session-naming-settings", {
  packages: "external",
  absWorkingDir: root,
  entryPoints: ["src/agent-host/session-naming-settings.ts"],
});

function store(value) {
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(value));
}

test("a host without saved naming settings enables automatic naming without a model preference", async () => {
  assert.deepEqual(await settings.readSessionNamingSettings(), defaults);
});

test("a version one naming file is configured and normalizes its fields", async () => {
  store({ version: 1, enabled: false, model: preferred });
  assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: false, model: preferred, configured: true });
  store({ version: 1 });
  assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: true, model: null, configured: true });
  store({ version: 1, enabled: "false", model: { provider: " naming-provider ", modelId: " naming-model " } });
  assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: true, model: preferred, configured: true });
});

test("saved naming choices survive a process restart and partial changes preserve omitted fields", async () => {
  assert.deepEqual(await settings.writeSessionNamingSettings({ enabled: false, model: preferred }), {
    enabled: false,
    model: preferred,
    configured: true,
  });
  assert.deepEqual(JSON.parse(readFileSync(settingsFile, "utf8")), { version: 1, enabled: false, model: preferred });
  const restartEnvironment = { ...process.env };
  delete restartEnvironment.NODE_TEST_CONTEXT;
  const restarted = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { importTestBundle } from "./scripts/test-bundle.mjs";
const { readSessionNamingSettings } = await importTestBundle("restarted-naming-settings", {
  packages: "external", entryPoints: ["src/agent-host/session-naming-settings.ts"]
});
process.stdout.write(JSON.stringify(await readSessionNamingSettings()));`,
    ],
    { cwd: root, encoding: "utf8", env: restartEnvironment },
  );
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), { enabled: false, model: preferred, configured: true });
  assert.deepEqual(await settings.writeSessionNamingSettings({ enabled: true }), {
    enabled: true,
    model: preferred,
    configured: true,
  });
  assert.deepEqual(await settings.writeSessionNamingSettings({ model: null }), {
    enabled: true,
    model: null,
    configured: true,
  });
  assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: true, model: null, configured: true });
  assert.deepEqual(await settings.writeSessionNamingSettings({}), { enabled: true, model: null, configured: true });
});

test("malformed naming changes are rejected as bad requests without altering saved choices", async () => {
  await settings.writeSessionNamingSettings({ enabled: false, model: preferred });
  const invalidModels = [false, "model", [], {}, { provider: "provider" }, { provider: 3, modelId: "model" }];
  for (const field of ["provider", "modelId"]) {
    for (const value of [
      null,
      42,
      "",
      " \t ",
      "a".repeat(201),
      "bad\nvalue",
      "bad\u0000value",
      "bad\u007fvalue",
      "bad\u0085value",
    ]) {
      invalidModels.push({ ...preferred, [field]: value });
    }
  }
  const invalidPatches = [
    undefined,
    null,
    false,
    3,
    "settings",
    [],
    { enabled: null },
    { enabled: "false" },
    { enabled: 0 },
    ...invalidModels.map((model) => ({ enabled: true, model })),
  ];
  for (const patch of invalidPatches) {
    await assert.rejects(
      () => settings.writeSessionNamingSettings(patch),
      (error) => error.code === "BAD_REQUEST",
    );
    assert.deepEqual(await settings.readSessionNamingSettings(), {
      enabled: false,
      model: preferred,
      configured: true,
    });
  }
});

test("corrupt, incompatible, or unreadable naming files fall back to defaults and can be replaced by a valid save", async () => {
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  for (const text of ["{broken", "", "null", "[]", "42", '"settings"', "{}", '{"version":2,"enabled":false}']) {
    writeFileSync(settingsFile, text);
    assert.deepEqual(await settings.readSessionNamingSettings(), defaults);
    assert.deepEqual(await settings.writeSessionNamingSettings({ model: preferred }), {
      enabled: true,
      model: preferred,
      configured: true,
    });
    assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: true, model: preferred, configured: true });
  }
  rmSync(settingsFile);
  mkdirSync(settingsFile);
  assert.deepEqual(await settings.readSessionNamingSettings(), defaults);
});

test("invalid stored model references are cleared without forgetting that the host was configured", async () => {
  const invalidModels = [false, [], {}, { provider: "provider" }, { provider: 123, modelId: "model" }];
  for (const field of ["provider", "modelId"]) {
    for (const value of ["", "   ", "a".repeat(201), "bad\nvalue", "bad\u0085value"]) {
      invalidModels.push({ ...preferred, [field]: value });
    }
  }
  for (const model of invalidModels) {
    store({ version: 1, enabled: false, model });
    assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: false, model: null, configured: true });
  }
});

test("model-only changes preserve the naming toggle and undefined fields preserve both saved values", async () => {
  await settings.writeSessionNamingSettings({ enabled: false });
  assert.deepEqual(await settings.writeSessionNamingSettings({ model: preferred }), {
    enabled: false,
    model: preferred,
    configured: true,
  });
  assert.deepEqual(await settings.writeSessionNamingSettings({ enabled: undefined, model: undefined }), {
    enabled: false,
    model: preferred,
    configured: true,
  });
  const longest = { provider: "p".repeat(200), modelId: "m".repeat(200) };
  assert.deepEqual(await settings.writeSessionNamingSettings({ model: longest }), {
    enabled: false,
    model: longest,
    configured: true,
  });
});

test("each host data directory has its own naming settings", async () => {
  await settings.writeSessionNamingSettings({ enabled: false, model: preferred });
  process.env.PI_DESKTOP_USER_DATA = path.join(agentDirectory, "other-host");
  try {
    assert.deepEqual(await settings.readSessionNamingSettings(), defaults);
    await settings.writeSessionNamingSettings({ enabled: true, model: null });
    assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: true, model: null, configured: true });
  } finally {
    delete process.env.PI_DESKTOP_USER_DATA;
  }
  assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: false, model: preferred, configured: true });
});

test("concurrent partial updates preserve both fields without racing", async () => {
  await Promise.all([
    settings.writeSessionNamingSettings({ enabled: false }),
    settings.writeSessionNamingSettings({ model: preferred }),
  ]);
  assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: false, model: preferred, configured: true });
});

test("a filesystem write failure rejects only the caller without unhandled rejection and keeps later writes working", async () => {
  mkdirSync(settingsFile, { recursive: true });
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await assert.rejects(() => settings.writeSessionNamingSettings({ enabled: false }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled.length, 0);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    rmSync(settingsFile, { recursive: true, force: true });
  }
  assert.deepEqual(await settings.writeSessionNamingSettings({ enabled: false, model: preferred }), {
    enabled: false,
    model: preferred,
    configured: true,
  });
  assert.deepEqual(await settings.readSessionNamingSettings(), { enabled: false, model: preferred, configured: true });
});
