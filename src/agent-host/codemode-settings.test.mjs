import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { importTestBundle } from "#test-bundle";

const root = path.resolve(import.meta.dirname, "../..");
const directory = await mkdtemp(path.join(tmpdir(), "dexon-codemode-settings-"));
const agentDir = path.join(directory, "agent");
const settingsFile = path.join(agentDir, "settings.json");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const settings = await importTestBundle("codemode-settings", {
  packages: "external",
  absWorkingDir: root,
  entryPoints: ["src/agent-host/codemode-settings.ts"],
});

beforeEach(async () => {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
});

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(directory, { recursive: true, force: true });
});

async function store(value, filePath = settingsFile) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value));
}

async function saved() {
  return JSON.parse(await readFile(settingsFile, "utf8"));
}

test("an unset host enables Code Mode with on mode and readable sandbox assets", async () => {
  const result = await settings.readCodemodeSettings();
  assert.deepEqual(result, {
    enabled: true,
    mode: "on",
    configPath: settingsFile,
    availability: { available: true },
    projectOverride: null,
  });
  assert.equal(settings.isCodemodeEnabledForCwd(), true);
  assert.equal(settings.isCodemodeEnabledForCwd(path.join(directory, "unknown")), true);
});

test("global selections use plain names before ordered modifiers and preserve the Dexon default", async () => {
  for (const [defaultTools, enabled] of [
    [undefined, true],
    [null, true],
    ["codemode", true],
    [[], false],
    [["+grep"], true],
    [["-codemode", "+codemode", "-codemode"], false],
    [["read", "codemode"], true],
    [["read"], false],
    [["+codemode", "read"], true],
    [["-codemode", "codemode"], false],
    [["read", "-codemode", "+codemode"], true],
  ]) {
    await store({ defaultTools, codemode: { mode: "invalid" } });
    const result = await settings.readCodemodeSettings();
    assert.equal(result.enabled, enabled, JSON.stringify(defaultTools));
    assert.equal(result.mode, "on");
  }
});

test("enabled changes preserve other settings and other tool entries without replacing pi selections", async () => {
  for (const [defaultTools, enabled, expected] of [
    [undefined, false, ["-codemode"]],
    [undefined, true, ["+codemode"]],
    [["+grep", "-codemode", "+codemode", "-bash"], false, ["+grep", "-bash", "-codemode"]],
    [["+grep", "-codemode"], true, ["+grep", "+codemode"]],
    [[], false, []],
    [[], true, ["codemode"]],
    [["read", "codemode", "-codemode", "+codemode", "-bash"], false, ["read", "-bash"]],
    [["read", "-codemode", "+codemode"], true, ["read", "codemode"]],
  ]) {
    await store({ defaultTools, theme: "dark", codemode: { mode: "only", inlineBudget: 1200 } });
    const result = await settings.writeCodemodeSettings({ enabled });
    assert.equal(result.enabled, enabled);
    assert.equal(result.mode, "only");
    assert.deepEqual(await saved(), {
      defaultTools: expected,
      theme: "dark",
      codemode: { mode: "only", inlineBudget: 1200 },
    });
  }
});

test("disabling the only allowlisted tool persists a disabled empty allowlist", async () => {
  await store({ defaultTools: ["codemode"] });
  const result = await settings.writeCodemodeSettings({ enabled: false });
  assert.deepEqual((await saved()).defaultTools, []);
  assert.equal(result.enabled, false);
  assert.equal((await settings.readCodemodeSettings()).enabled, false);
});

test("mode-only changes and concurrent partial writes retain unrelated settings", async () => {
  await store({ defaultTools: ["read", "codemode"], codemode: { inlineBudget: 700 }, retry: { enabled: false } });
  await settings.writeCodemodeSettings({ mode: "only" });
  assert.deepEqual((await saved()).defaultTools, ["read", "codemode"]);
  await Promise.all([
    settings.writeCodemodeSettings({ enabled: false }),
    settings.writeCodemodeSettings({ mode: "on" }),
  ]);
  assert.deepEqual(await saved(), {
    defaultTools: ["read"],
    codemode: { inlineBudget: 700, mode: "on" },
    retry: { enabled: false },
  });
  assert.deepEqual(await readdir(agentDir), ["settings.json"]);
});

test("project allowlists replace global choices while project modifiers inherit them", async () => {
  const cwd = path.join(directory, "project");
  const projectFile = path.join(cwd, ".pi", "settings.json");
  await store({ defaultTools: ["read"], codemode: { mode: "only" } });
  for (const [project, expected] of [
    [{ defaultTools: ["+grep"] }, null],
    [{ defaultTools: [] }, { enabled: false }],
    [{ defaultTools: ["+codemode"] }, { enabled: true }],
    [{ defaultTools: ["+codemode", "-codemode"] }, { enabled: false }],
    [
      { defaultTools: ["read", "codemode"], codemode: { mode: "on" } },
      { enabled: true, mode: "on" },
    ],
    [{ defaultTools: ["read"] }, { enabled: false }],
    [{ codemode: { mode: "only", inlineBudget: 12 } }, { mode: "only" }],
    [{ codemode: { mode: "invalid" } }, null],
  ]) {
    await store(project, projectFile);
    const result = await settings.readCodemodeSettings(cwd);
    assert.equal(result.enabled, false);
    assert.equal(result.mode, "only");
    assert.deepEqual(result.projectOverride, expected ? { filePath: projectFile, ...expected } : null);
  }
});

test("project modifiers are applied after global modifiers and never treat the global file as an override", async () => {
  const cwd = path.join(directory, "project");
  const projectFile = path.join(cwd, ".pi", "settings.json");
  await store({ defaultTools: ["codemode", "-codemode"] });
  await store({ defaultTools: ["+codemode"] }, projectFile);
  assert.equal(await settings.refreshEffectiveCodemode(cwd), true);
  assert.equal(settings.isCodemodeEnabledForCwd(path.join(cwd, "nested", "..")), true);
  process.env.PI_CODING_AGENT_DIR = path.join(cwd, ".pi");
  try {
    assert.equal((await settings.readCodemodeSettings(cwd)).projectOverride, null);
  } finally {
    process.env.PI_CODING_AGENT_DIR = agentDir;
  }
});

test("saving global changes immediately updates every cached project while retaining project overrides", async () => {
  const inherited = path.join(directory, "inherited");
  const overridden = path.join(directory, "overridden");
  await store({ defaultTools: ["+codemode"] }, path.join(overridden, ".pi", "settings.json"));
  await settings.refreshEffectiveCodemode(inherited);
  await settings.refreshEffectiveCodemode(overridden);
  await settings.writeCodemodeSettings({ enabled: false, cwd: inherited });
  assert.equal(settings.isCodemodeEnabledForCwd(), false);
  assert.equal(settings.isCodemodeEnabledForCwd(inherited), false);
  assert.equal(settings.isCodemodeEnabledForCwd(overridden), true);
  await settings.writeCodemodeSettings({ enabled: true });
  assert.equal(settings.isCodemodeEnabledForCwd(inherited), true);
});

async function withFilesystemBoundary(name, contents) {
  return importTestBundle(name, {
    packages: "external",
    absWorkingDir: root,
    entryPoints: ["src/agent-host/codemode-settings.ts"],
    plugins: [
      {
        name: "filesystem-boundary",
        setup(build) {
          build.onResolve({ filter: /^node:fs\/promises$/ }, () => ({
            path: "filesystem-boundary",
            namespace: "boundary",
          }));
          build.onLoad({ filter: /.*/, namespace: "boundary" }, () => ({ contents, loader: "js" }));
        },
      },
    ],
  });
}

test("missing sandbox assets disable effective activation without changing the configured preference", async () => {
  const unavailable = await withFilesystemBoundary(
    "codemode-missing-sandbox",
    `
    import fs from "fs/promises";
    export default { ...fs, async access(file, mode) {
      if (file.endsWith("quickjs.wasm")) throw Object.assign(new Error("Sandbox asset is missing"), { code: "ENOENT" });
      return fs.access(file, mode);
    } };
  `,
  );
  const result = await unavailable.readCodemodeSettings();
  assert.equal(result.enabled, true);
  assert.deepEqual(result.availability, {
    available: false,
    reason: "missing_sandbox",
    detail: "Sandbox asset is missing",
  });
  assert.equal(await unavailable.refreshEffectiveCodemode(), false);
  assert.equal(unavailable.isCodemodeEnabledForCwd(), false);
  await unavailable.writeCodemodeSettings({ enabled: true });
  assert.equal(unavailable.isCodemodeEnabledForCwd(), false);
});

test("transient Windows rename errors still save settings atomically without leftover temporary files", async () => {
  const windows = await withFilesystemBoundary(
    "codemode-windows-rename",
    `
    import fs from "fs/promises";
    const pending = ["EPERM", "EBUSY", "EACCES"];
    export default { ...fs, async rename(source, target) {
      const code = pending.shift();
      if (code) throw Object.assign(new Error("File is busy"), { code });
      return fs.rename(source, target);
    } };
  `,
  );
  const result = await windows.writeCodemodeSettings({ enabled: false, mode: "only" });
  assert.equal(result.enabled, false);
  assert.equal(result.mode, "only");
  assert.deepEqual(await saved(), { defaultTools: ["-codemode"], codemode: { mode: "only" } });
  assert.deepEqual(await readdir(agentDir), ["settings.json"]);
});

test("invalid patches are bad requests and cannot change settings", async () => {
  await settings.writeCodemodeSettings({ enabled: false, mode: "only" });
  const before = await readFile(settingsFile, "utf8");
  for (const patch of [
    null,
    [],
    true,
    "settings",
    { enabled: null },
    { enabled: "true" },
    { mode: null },
    { mode: "off" },
    { cwd: 12 },
  ]) {
    await assert.rejects(
      () => settings.writeCodemodeSettings(patch),
      (error) => error.code === "BAD_REQUEST",
    );
    assert.equal(await readFile(settingsFile, "utf8"), before);
  }
});

test("invalid project JSON is ignored and failed writes do not poison the async queue or leave temporary files", async () => {
  const cwd = path.join(directory, "project");
  const projectFile = path.join(cwd, ".pi", "settings.json");
  await mkdir(path.dirname(projectFile), { recursive: true });
  for (const text of ["{broken", "null", "[]", "42"]) {
    await writeFile(projectFile, text);
    assert.equal((await settings.readCodemodeSettings(cwd)).projectOverride, null);
  }
  await mkdir(settingsFile, { recursive: true });
  await assert.rejects(() => settings.writeCodemodeSettings({ enabled: false }));
  assert.deepEqual(await readdir(agentDir), ["settings.json"]);
  await rm(settingsFile, { recursive: true });
  assert.equal((await settings.writeCodemodeSettings({ enabled: false })).enabled, false);
});
