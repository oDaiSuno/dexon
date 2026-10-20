import assert from "node:assert/strict";
import test from "node:test";
import { retry, workflowWarning } from "./ci-retry.mjs";

function failure(message, code) {
  return Object.assign(new Error(message), { code });
}

test("a transient failure is retried once with a visible warning and the later result is returned", async () => {
  const warnings = [];
  let calls = 0;
  const result = await retry(
    "npm ci",
    async () => {
      calls += 1;
      if (calls === 1) throw failure("socket hang up", "ECONNRESET");
      return "installed";
    },
    { retryDelaysMs: [1, 1], warn: (message) => warnings.push(message) },
  );
  assert.equal(result, "installed");
  assert.equal(calls, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /npm ci/);
  assert.match(warnings[0], /attempt 1\/3/);
  assert.match(warnings[0], /ECONNRESET/);
});

test("an error the caller does not consider transient fails immediately without a warning", async () => {
  const warnings = [];
  let calls = 0;
  const integrity = failure("checksum mismatch", "TOOLCHAIN_INTEGRITY_FAILED");
  await assert.rejects(
    retry(
      "download ripgrep",
      async () => {
        calls += 1;
        throw integrity;
      },
      {
        retryDelaysMs: [1, 1],
        shouldRetry: (error) => error.code === "ECONNRESET",
        warn: (message) => warnings.push(message),
      },
    ),
    (error) => error === integrity,
  );
  assert.equal(calls, 1);
  assert.deepEqual(warnings, []);
});

test("a failure that persists through every allowed attempt surfaces the last real error", async () => {
  const warnings = [];
  let calls = 0;
  await assert.rejects(
    retry(
      "npm ci",
      async () => {
        calls += 1;
        throw failure(`attempt ${calls} failed`, "ECONNRESET");
      },
      { retryDelaysMs: [1, 1], warn: (message) => warnings.push(message) },
    ),
    /attempt 3 failed/,
  );
  assert.equal(calls, 3);
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /attempt 2\/3/);
});

test("warnings are written as single-line GitHub annotations even when the message spans lines", () => {
  assert.equal(workflowWarning("50% done\r\nnext line"), "::warning::50%25 done%0D%0Anext line");
});
