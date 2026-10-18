import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-ci-results.mjs", import.meta.url));

function check(results, required = ["quality", "platforms"]) {
  return spawnSync(process.execPath, [script, ...required], {
    env: { ...process.env, CI_NEEDS: JSON.stringify(results) },
    encoding: "utf8",
  });
}

test("a failed required job blocks the merge even when another job succeeded", () => {
  const result = check({ quality: { result: "failure" }, platforms: { result: "success" } });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /quality.*failure/);
});

test("cancelled, skipped, neutral, unknown and missing required jobs cannot produce a green gate", () => {
  for (const state of ["cancelled", "skipped", "neutral", "pending", "unknown", undefined]) {
    const result = check({ quality: { result: "success" }, platforms: state ? { result: state } : undefined });
    assert.equal(result.status, 1, `${state}: ${result.stderr}`);
    assert.match(result.stderr, /platforms/);
  }
});

test("an empty required-job contract cannot approve a merge", () => {
  const result = check({}, []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /required jobs/);
});

test("all required jobs succeeding approves the merge", () => {
  const result = check({ quality: { result: "success" }, platforms: { result: "success" } });
  assert.equal(result.status, 0, result.stderr);
});

test("a missing or unreadable results document never approves a merge", () => {
  for (const value of [undefined, "", "{", "null", "[]"]) {
    const result = spawnSync(process.execPath, [script, "quality"], {
      env: { ...process.env, CI_NEEDS: value },
      encoding: "utf8",
    });
    assert.equal(result.status, 1, String(value));
  }
});
