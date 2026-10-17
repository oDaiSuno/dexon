import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { assertTestSpawnResult, createTestCommand, parseTestTimeout, runTests } from "./test-runner.mjs";

test("test discovery covers the legacy tree and the new tests tree with a per-test timeout", () => {
  const command = createTestCommand({ timeoutMs: 4567 });
  assert.equal(command.command, process.execPath);
  assert.deepEqual(command.args, [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--import",
    pathToFileURL(path.join(import.meta.dirname, "test-global-guard.mjs")).href,
    "--test",
    "--test-timeout=4567",
    "--test-concurrency=3",
    "src/**/*.test.mjs",
    "scripts/**/*.test.mjs",
    "tests/**/*.test.mjs",
  ]);
  assert.equal(command.args.filter((argument) => argument.endsWith(".test.mjs")).length, 3);
});

test("timeout parsing rejects malformed, zero, and unsafe values", () => {
  assert.equal(parseTestTimeout(undefined), 120_000);
  assert.equal(parseTestTimeout("9000"), 9000);
  for (const invalid of ["0", "-1", "5.5", "soon", "9007199254740992"]) {
    assert.throws(() => parseTestTimeout(invalid), /positive integer/);
  }
});

test("spawn diagnostics distinguish start errors, signals, missing statuses, and failures", () => {
  assert.doesNotThrow(() => assertTestSpawnResult({ error: undefined, signal: null, status: 0 }));
  assert.throws(() => assertTestSpawnResult({ error: new Error("ENOENT") }), /failed to start: ENOENT/);
  assert.throws(() => assertTestSpawnResult({ signal: "SIGKILL", status: null }), /signal SIGKILL/);
  assert.throws(() => assertTestSpawnResult({ signal: null, status: null }), /no exit status/);
  assert.throws(() => assertTestSpawnResult({ signal: null, status: 3 }), /status 3/);
});

test("legacy test modules are cleaned before and after every result", () => {
  const removed = [];
  assert.throws(
    () =>
      runTests("/repo", {
        timeout: "50",
        fileSystem: { rmSync: (target, options) => removed.push({ target, options }) },
        spawnSync: (command, args, options) => {
          assert.equal(command, process.execPath);
          assert.ok(args.includes("src/**/*.test.mjs"));
          assert.equal(options.shell, false);
          return { error: undefined, signal: null, status: 7 };
        },
      }),
    /status 7/,
  );
  assert.deepEqual(
    removed,
    [0, 1].map(() => ({
      target: path.join("/repo", ".artifacts", "test-modules"),
      options: { recursive: true, force: true },
    })),
  );
});
