import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const agentDirectory = mkdtempSync(path.join(tmpdir(), "pi-plugin-origin-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(agentDirectory, "sessions");
process.env.PI_OFFLINE = "1";
test.after(() => rmSync(agentDirectory, { recursive: true, force: true }));

const bundle = await importTestBundle("plugin-origin", {
  packages: "external",
  absWorkingDir: root,
  stdin: {
    contents:
      'export { registerHandlers } from "./src/agent-host/handlers.ts"; export { readPlugins, notePluginUpdates } from "./src/agent-host/plugins-service.ts";',
    resolveDir: root,
    loader: "ts",
  },
});

function handlers() {
  const registered = {};
  bundle.registerHandlers({
    handle(next) {
      Object.assign(registered, next);
    },
    emit() {},
  });
  return registered;
}

function writeSkill(directory, name) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} test skill.\n---\n\n# ${name}\n`,
    "utf8",
  );
}

function writeManifest(packageDirectory, manifest) {
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify(manifest), "utf8");
}

function setup(t) {
  const base = mkdtempSync(path.join(tmpdir(), "pi-plugin-origin-"));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
    rmSync(path.join(agentDirectory, "settings.json"), { force: true });
    rmSync(path.join(agentDirectory, "skills"), { recursive: true, force: true });
  });
  const project = path.join(base, "project");
  mkdirSync(project, { recursive: true });
  const titled = path.join(base, "browser-tools-package");
  writeManifest(titled, {
    name: "browser-tools-package",
    displayName: "Browser tools",
    version: "1.0.0",
    keywords: ["pi-package"],
    pi: { skills: ["./skills"] },
  });
  writeSkill(path.join(titled, "skills", "web-research"), "web-research");
  const untitled = path.join(base, "deploy-package");
  writeManifest(untitled, {
    name: "pi-deploy",
    version: "0.3.0",
    keywords: ["pi-package"],
    pi: { skills: ["./skills"] },
  });
  writeSkill(path.join(untitled, "skills", "deploy-preview"), "deploy-preview");
  writeSkill(path.join(agentDirectory, "skills", "commit-message"), "commit-message");
  writeFileSync(path.join(agentDirectory, "settings.json"), JSON.stringify({ packages: [titled, untitled] }), "utf8");
  return { project, titled, untitled };
}

test("a skill provided by a plugin reports that plugin's title and package name; a plain global skill reports none", async (t) => {
  const { project, titled, untitled } = setup(t);
  const { skills } = await handlers()["skills.list"]({ cwd: project });
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  assert.deepEqual(
    {
      displayName: byName.get("web-research").plugin?.displayName,
      packageName: byName.get("web-research").plugin?.packageName,
      source: byName.get("web-research").plugin?.source,
      scope: byName.get("web-research").plugin?.scope,
    },
    { displayName: "Browser tools", packageName: "browser-tools-package", source: titled, scope: "global" },
  );
  assert.equal(byName.get("deploy-preview").plugin?.displayName, undefined);
  assert.equal(byName.get("deploy-preview").plugin?.packageName, "pi-deploy");
  assert.equal(byName.get("deploy-preview").plugin?.source, untitled);
  assert.equal(byName.get("commit-message").plugin, undefined);
});

test("the plugin list carries each package's own title when its manifest declares one", async (t) => {
  const { project, titled, untitled } = setup(t);
  const { packages } = await handlers()["plugins.list"]({ cwd: project });
  assert.equal(packages.find((pkg) => pkg.source === titled).displayName, "Browser tools");
  assert.equal(packages.find((pkg) => pkg.source === untitled).displayName, undefined);
});

test("an update that changes a plugin's version is remembered as waiting for a reload until the session is reloaded", async (t) => {
  const { project, titled, untitled } = setup(t);
  const before = await bundle.readPlugins(project);
  writeManifest(titled, {
    name: "browser-tools-package",
    displayName: "Browser tools",
    version: "1.1.0",
    keywords: ["pi-package"],
    pi: { skills: ["./skills"] },
  });
  const after = await bundle.readPlugins(project);
  const noted = bundle.notePluginUpdates(project, before, after);
  assert.equal(noted.packages.find((pkg) => pkg.source === titled).pendingReloadVersion, "1.1.0");
  assert.equal(noted.packages.find((pkg) => pkg.source === untitled).pendingReloadVersion, undefined);

  const listed = await handlers()["plugins.list"]({ cwd: project });
  assert.equal(listed.packages.find((pkg) => pkg.source === titled).pendingReloadVersion, "1.1.0");

  const reloaded = await handlers()["plugins.markReloaded"]({ cwd: project });
  assert.equal(reloaded.packages.find((pkg) => pkg.source === titled).pendingReloadVersion, undefined);
  const relisted = await handlers()["plugins.list"]({ cwd: project });
  assert.equal(relisted.packages.find((pkg) => pkg.source === titled).pendingReloadVersion, undefined);
});

test("an update that leaves every version unchanged asks for no reload", async (t) => {
  const { project } = setup(t);
  const before = await bundle.readPlugins(project);
  const after = await bundle.readPlugins(project);
  const noted = bundle.notePluginUpdates(project, before, after);
  assert.deepEqual(
    noted.packages.map((pkg) => pkg.pendingReloadVersion),
    noted.packages.map(() => undefined),
  );
});
