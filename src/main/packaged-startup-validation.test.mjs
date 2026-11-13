import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const report = {
  models: { ok: true, modelCount: 0, catalogSource: "offline" },
  pluginWorker: { ok: true, installed: true, removed: true },
  managedProcess: { ok: true, readyLineSeen: true, finalState: "killed" },
};

async function validationFixture(t, selfCheck) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "packaged-validation-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { PackagedStartupValidation, state } = await importTestBundle("packaged-validation", {
    stdin: {
      contents:
        'export { PackagedStartupValidation } from "./src/main/packaged-startup-validation.ts"; export { state } from "electron";',
      resolveDir: path.resolve(import.meta.dirname, "../.."),
      loader: "ts",
    },
    packages: "external",
    plugins: [
      {
        name: "electron-boundary",
        setup(build) {
          build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `export const state = { exits: [] }; export const app = { getVersion: () => "0.3.8", getPath: () => ${JSON.stringify(directory)}, exit: (code) => state.exits.push(code) }; export const BrowserWindow = { getAllWindows: () => [] };`,
            loader: "js",
          }));
        },
      },
    ],
  });
  let calls = 0;
  const host = {
    getPiVersion: () => "1.4.0",
    getToolchainAckRevision: () => 1,
    async call(method, params, timeout) {
      assert.equal(method, "host.selfCheck");
      assert.equal(params, undefined);
      assert.equal(timeout, 55000);
      calls++;
      return selfCheck;
    },
    async stop() {},
  };
  const validation = new PackagedStartupValidation({
    enabled: true,
    expectedPiVersion: "1.4.0",
    getHostManager: () => host,
    getUpdateManager: () => null,
    setQuitting() {},
  });
  validation.rendererReady = true;
  validation.hostReady = true;
  validation.toolchainSnapshot = {
    revision: 1,
    publicState: {
      coreReady: true,
      capabilities: Object.fromEntries(
        ["search.rg", "search.fd"].map((capability) => [
          capability,
          { candidates: [{ provider: "bundled", health: "healthy" }] },
        ]),
      ),
    },
  };
  return { validation, state, directory, calls: () => calls };
}

test("packaged readiness runs exactly one real host self-check before reporting success", async (t) => {
  const fixture = await validationFixture(t, report);
  fixture.validation.start();
  fixture.validation.finish();
  fixture.validation.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.calls(), 1);
  assert.deepEqual(fixture.state.exits, [0]);
  const written = JSON.parse(fs.readFileSync(path.join(fixture.directory, "packaged-startup-check.json"), "utf8"));
  assert.deepEqual(written.selfCheck, report);
  assert.equal(written.ok, true);
  assert.equal(fs.existsSync(path.join(fixture.directory, "ui-state.json")), false);
});

test("a failed grandchild probe makes packaged startup fail with its full self-check report", async (t) => {
  const selfCheck = { ...report, models: { ok: false, error: "catalog ENOTDIR spawn" } };
  const fixture = await validationFixture(t, selfCheck);
  fixture.validation.finish();
  await new Promise((resolve) => setImmediate(resolve));
  const written = JSON.parse(fs.readFileSync(path.join(fixture.directory, "packaged-startup-check.json"), "utf8"));
  assert.equal(written.ok, false);
  assert.match(written.error, /models: catalog ENOTDIR spawn/);
  assert.deepEqual(written.selfCheck, selfCheck);
  assert.deepEqual(fixture.state.exits, [1]);
});
