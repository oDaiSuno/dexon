import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { installDependencies, parseRetryDelaysMs } from "./ci-install-dependencies.mjs";

const scriptPath = path.join(import.meta.dirname, "ci-install-dependencies.mjs");
const repositoryRoot = path.resolve(import.meta.dirname, "..");

const fakeNpmSource = [
  'import { appendFileSync, existsSync, writeFileSync } from "node:fs";',
  "const statePath = process.env.DEXON_FAKE_NPM_STATE;",
  "const recordPath = process.env.DEXON_FAKE_NPM_RECORD;",
  'appendFileSync(recordPath, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");',
  'if (process.env.DEXON_FAKE_NPM_MODE === "always-fail") {',
  '  console.error("fake npm: simulated EEXIST");',
  "  process.exitCode = 7;",
  "} else if (existsSync(statePath)) {",
  '  console.log("fake npm: dependencies installed");',
  "} else {",
  '  writeFileSync(statePath, "the first attempt was made to fail");',
  '  console.error("fake npm: simulated ECONNRESET");',
  "  process.exitCode = 1;",
  "}",
].join("\n");

function failingOnceThenSucceeding() {
  const results = [{ status: 1 }, { status: 0 }];
  return () => results.shift() ?? { status: 0 };
}

function runInstallScript(env = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "dexon-ci-install-dependencies-"));
  try {
    const fakeNpmPath = path.join(directory, "fake-npm.mjs");
    const recordPath = path.join(directory, "calls.jsonl");
    writeFileSync(fakeNpmPath, fakeNpmSource, "utf8");
    const result = spawnSync(process.execPath, [scriptPath, "--ignore-scripts"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_execpath: fakeNpmPath,
        DEXON_CI_INSTALL_RETRY_DELAYS_MS: "0,0",
        DEXON_FAKE_NPM_STATE: path.join(directory, "failed-once"),
        DEXON_FAKE_NPM_RECORD: recordPath,
        ...env,
      },
    });
    const calls = existsSync(recordPath)
      ? readFileSync(recordPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
    return { result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("installation succeeds after one warning when npm ci fails once and then succeeds", async () => {
  const warnings = [];
  const status = await installDependencies([], {
    spawn: failingOnceThenSucceeding(),
    retryDelaysMs: [0, 0],
    warn: (message) => warnings.push(message),
  });
  assert.equal(status, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /npm ci/);
  assert.match(warnings[0], /attempt 1\/3/);
});

test("npm ci's own exit status is surfaced after the last of three attempts fails", async () => {
  const warnings = [];
  let attempts = 0;
  await assert.rejects(
    installDependencies([], {
      spawn: () => {
        attempts += 1;
        return { status: 3 };
      },
      retryDelaysMs: [0, 0],
      warn: (message) => warnings.push(message),
    }),
    (error) => error.exitStatus === 3,
  );
  assert.equal(attempts, 3);
  assert.equal(warnings.length, 2);
});

test("npm ci that cannot even start is retried and finally reported as a plain failure", async () => {
  const warnings = [];
  let attempts = 0;
  await assert.rejects(
    installDependencies([], {
      spawn: () => {
        attempts += 1;
        return { error: Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT" }) };
      },
      retryDelaysMs: [0, 0],
      warn: (message) => warnings.push(message),
    }),
    (error) => error.exitStatus === 1 && /could not start/.test(error.message),
  );
  assert.equal(attempts, 3);
  assert.equal(warnings.length, 2);
});

test("the script retries npm ci itself and passes its arguments through unchanged", () => {
  const { result, calls } = runInstallScript();
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /::warning::.*attempt 1\/3/);
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ["ci", "--ignore-scripts"],
      ["ci", "--ignore-scripts"],
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.cwd),
    [repositoryRoot, repositoryRoot],
  );
});

test("npm ci that keeps failing ends the script with npm's own exit status", () => {
  const { result, calls } = runInstallScript({ DEXON_FAKE_NPM_MODE: "always-fail" });
  assert.equal(result.signal, null);
  assert.equal(result.status, 7);
  assert.equal(calls.length, 3);
  assert.match(result.stderr, /exited with status 7/);
});

test("an unusable retry delay override is refused instead of quietly ignored", () => {
  assert.deepEqual(parseRetryDelaysMs(undefined), [10_000, 30_000]);
  assert.deepEqual(parseRetryDelaysMs("0,0"), [0, 0]);
  for (const garbage of ["", "0,abc", "-1,0", "1;2", "0,0,", " 0,0", "1.5,0", "0,0,0"]) {
    assert.throws(
      () => parseRetryDelaysMs(garbage),
      (error) => /DEXON_CI_INSTALL_RETRY_DELAYS_MS/.test(error.message) && error.message.includes(garbage),
      `expected ${JSON.stringify(garbage)} to be refused`,
    );
  }
});
