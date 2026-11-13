import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preparePackagedStartupRun } from "./packaged-startup-fixture.mjs";

test("packaged verification seeds offline models and enabled managed processes without inheriting desktop data", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "packaged-fixture-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const prepared = preparePackagedStartupRun(directory, { PI_DESKTOP_USER_DATA: "/must-not-use", EXTRA: "kept" });
  assert.equal(prepared.env.PI_OFFLINE, "1");
  assert.equal(prepared.env.PI_DESKTOP_USER_DATA, undefined);
  assert.equal(prepared.env.EXTRA, "kept");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(prepared.userData, "ui-state.json"), "utf8")).managedProcessesEnabled,
    true,
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(prepared.env.PI_CODING_AGENT_DIR, "models.json"), "utf8")), {
    providers: {},
  });
});
