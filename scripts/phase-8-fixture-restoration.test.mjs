// target: scripts/phase-8-fixture-restoration.test.mjs
// Contract: spec §3.4 / plan §2.7 / ASTRA-R10-F001; reviewer-owned whole-class reproduction.
// Expected failure features: RESTORATION_CONTRACT:fetch / RESTORATION_CONTRACT:navigator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureCases, unsupportedSetups } from "./phase-8-fixture-cases.mjs";

const root = process.cwd();
const worker = fileURLToPath(new URL("./phase-8-fixture-restoration-worker.mjs", import.meta.url));
const within = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};
const artifactBase = path.resolve(process.env.PHASE8_FIXTURE_ARTIFACT_DIR || os.tmpdir());
assert.ok(
  within(path.join(root, "gudaspec"), artifactBase) || within(os.tmpdir(), artifactBase),
  "ARTIFACT_DIRECTORY: use repository gudaspec/ or os.tmpdir(), never project source directories",
);
mkdirSync(artifactBase, { recursive: true });
const artifacts = mkdtempSync(path.join(artifactBase, "phase8-fixture-"));
const group = process.env.PHASE8_FIXTURE_GROUP || "all";
assert.ok(["all", "closure", "class"].includes(group), "INSTRUMENTATION_GROUP: all, closure or class required");
const cases = fixtureCases().filter((entry) => group === "all" || entry.group === group);
writeFileSync(path.join(artifacts, "case-plan.json"), JSON.stringify({ cases, unsupportedSetups }, null, 2) + "\n");
console.log("ARTIFACT_DIRECTORY", artifacts);
console.log("CASE_PLAN", JSON.stringify({ registered: cases.length, unsupportedSetups }));

for (const config of cases) {
  test(config.name, { timeout: 35000 }, () => {
    const environment = { ...process.env, PHASE8_FIXTURE_CASE: JSON.stringify(config) };
    delete environment.NODE_TEST_CONTEXT;
    const child = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--test", "--test-timeout=30000", worker],
      { cwd: root, env: environment, encoding: "utf8", timeout: 32000, maxBuffer: 4 * 1024 * 1024 },
    );
    const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
    writeFileSync(path.join(artifacts, `${config.name}.log`), output);
    const records = output.split("\n").filter((line) => /^(?:# )?FIXTURE_RESULT /.test(line));
    assert.equal(child.error, undefined, `PROCESS_BOUNDARY:${child.error?.message}`);
    assert.equal(child.signal, null, `PROCESS_BOUNDARY:${child.signal}`);
    assert.equal(records.length, 1, `INSTRUMENTATION_RESULT_MISSING_OR_AMBIGUOUS\n${output}`);
    const result = JSON.parse(records[0].replace(/^(?:# )?FIXTURE_RESULT /, ""));
    console.log("FIXTURE_RESULT", JSON.stringify(result));
    assert.equal(result.executionValid, true, `FIXTURE_EXECUTION_INVALID\n${output}`);
    assert.equal(
      result.differences.length,
      0,
      `RESTORATION_CONTRACT:${result.differences.map((entry) => entry.name).join(",")}\n${output}`,
    );
    assert.equal(result.followingError, null, `RESTORATION_CONTRACT:following-fixture-acquisition\n${output}`);
    assert.equal(
      result.followingDifferences.length,
      0,
      `RESTORATION_CONTRACT:following-fixture-descriptors\n${output}`,
    );
    assert.equal(
      result.afterFollowing.length,
      0,
      `RESTORATION_CONTRACT:${result.afterFollowing.map((entry) => entry.name).join(",")}\n${output}`,
    );
    assert.equal(child.status, 0, `FIXTURE_EXECUTION_EXIT:${child.status}\n${output}`);
  });
}
