import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNoLegacyTestBundleUsage } from "./test-bundle.mjs";

const defaultTimeoutMs = 120_000;
const globalGuard = pathToFileURL(path.join(import.meta.dirname, "test-global-guard.mjs")).href;

export function parseTestTimeout(value) {
  if (value === undefined || value === "") return defaultTimeoutMs;
  if (!/^\d+$/.test(value)) throw new Error(`PI_TEST_TIMEOUT_MS must be a positive integer, received ${value}`);
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error(`PI_TEST_TIMEOUT_MS must be a positive integer, received ${value}`);
  }
  return timeout;
}

export function parseTestConcurrency(value) {
  if (value === undefined || value === "") return 3;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new Error(`PI_TEST_CONCURRENCY must be a positive integer, received ${value}`);
  }
  return Number(value);
}

export function createTestCommand({ timeoutMs = defaultTimeoutMs, concurrency = 3 } = {}) {
  return {
    command: process.execPath,
    args: [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--import",
      globalGuard,
      "--test",
      `--test-timeout=${timeoutMs}`,
      `--test-concurrency=${concurrency}`,
      "src/**/*.test.mjs",
      "scripts/**/*.test.mjs",
      "tests/**/*.test.mjs",
    ],
  };
}

export function assertTestSpawnResult(result) {
  if (result.error) throw new Error(`test runner failed to start: ${result.error.message}`);
  if (result.signal) throw new Error(`test runner terminated by signal ${result.signal}`);
  if (!Number.isInteger(result.status)) throw new Error("test runner returned no exit status");
  if (result.status !== 0) throw new Error(`test runner exited with status ${result.status}`);
}

export function cleanLegacyTestModules(root, fileSystem = fs) {
  fileSystem.rmSync(path.join(root, ".artifacts", "test-modules"), { recursive: true, force: true });
}

export function runTests(root, options = {}) {
  const spawn = options.spawnSync ?? spawnSync;
  const fileSystem = options.fileSystem ?? fs;
  const command = createTestCommand({
    timeoutMs: parseTestTimeout(options.timeout ?? process.env.PI_TEST_TIMEOUT_MS),
    concurrency: parseTestConcurrency(options.concurrency ?? process.env.PI_TEST_CONCURRENCY),
  });
  assertNoLegacyTestBundleUsage(root);
  cleanLegacyTestModules(root, fileSystem);
  try {
    const result = spawn(command.command, command.args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    assertTestSpawnResult(result);
  } finally {
    cleanLegacyTestModules(root, fileSystem);
  }
}
