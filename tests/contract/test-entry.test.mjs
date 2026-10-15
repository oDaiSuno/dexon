import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runTests } from "../../scripts/test-runner.mjs";

// Specification: one command must run behaviors from all three supported
// locations. The output file is written by independent child tests, not by
// inspecting the runner's command line or substituting its implementation.
test("the test entry runs source, script, and new-directory behaviors together", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "dexon-test-entry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["src", "scripts", "tests/logic"]) {
    mkdirSync(path.join(root, directory), { recursive: true });
    writeFileSync(
      path.join(root, directory, "sample.test.mjs"),
      `import test from "node:test"; import {appendFileSync} from "node:fs";
       test(${JSON.stringify(directory)}, () => appendFileSync("observed.txt", ${JSON.stringify(`${directory}\n`)}));`,
    );
  }
  // A nested child runner must not inherit Node's own test-child marker.
  const marker = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    runTests(root, { concurrency: "1" });
  } finally {
    if (marker !== undefined) process.env.NODE_TEST_CONTEXT = marker;
  }
  assert.deepEqual(readFileSync(path.join(root, "observed.txt"), "utf8").trim().split("\n").sort(), [
    "scripts",
    "src",
    "tests/logic",
  ]);
});
