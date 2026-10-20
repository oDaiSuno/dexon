import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_VIOLATION_EXIT_STATUS,
  FIRST_INSTALL_PHASE,
  shouldRetryFirstInstall,
  shouldRetryRefusedFreshInstall,
} from "./windows-installer-retry.mjs";

const cleanInstallState = { entries: 0, shortcut: false, processes: 0 };

const accessViolation = { status: ACCESS_VIOLATION_EXIT_STATUS, signal: null, error: undefined };

function retries(overrides = {}) {
  return shouldRetryFirstInstall({
    phase: FIRST_INSTALL_PHASE,
    result: accessViolation,
    installState: cleanInstallState,
    installDirectoryEntries: [],
    ...overrides,
  });
}

const refusedInstall = { status: 2, signal: null, error: undefined };

function refusedRetries(overrides = {}) {
  return shouldRetryRefusedFreshInstall({ result: accessViolation, installState: cleanInstallState, ...overrides });
}

test("when a refused fresh install dies with an access violation and leaves no trace, the system retries it", () => {
  assert.equal(refusedRetries(), true);
});

test("when the installer really refuses with code 2, the system does not retry it", () => {
  assert.equal(refusedRetries({ result: refusedInstall }), false);
});

test("when a refused fresh install exits with any other status, the system does not retry it", () => {
  assert.equal(refusedRetries({ result: { status: 0, signal: null, error: undefined } }), false);
  assert.equal(refusedRetries({ result: { status: 1, signal: null, error: undefined } }), false);
  assert.equal(refusedRetries({ result: { status: -1073741819, signal: null, error: undefined } }), false);
});

test("when the access violation of a refused install arrives with a spawn error or a termination signal, the system does not retry it", () => {
  const spawnError = new Error("spawn UNKNOWN");
  assert.equal(refusedRetries({ result: { status: null, signal: null, error: spawnError } }), false);
  assert.equal(
    refusedRetries({ result: { status: ACCESS_VIOLATION_EXIT_STATUS, signal: null, error: spawnError } }),
    false,
  );
  assert.equal(refusedRetries({ result: { status: null, signal: "SIGTERM", error: undefined } }), false);
  assert.equal(
    refusedRetries({ result: { status: ACCESS_VIOLATION_EXIT_STATUS, signal: "SIGSEGV", error: undefined } }),
    false,
  );
});

test("when the crashed refusal left a registry entry, a shortcut, or a running Dexon process, the system does not retry it", () => {
  assert.equal(refusedRetries({ installState: { entries: 1, shortcut: false, processes: 0 } }), false);
  assert.equal(refusedRetries({ installState: { entries: 0, shortcut: true, processes: 0 } }), false);
  assert.equal(refusedRetries({ installState: { entries: 0, shortcut: false, processes: 1 } }), false);
});

test("when the first install of the previous installer dies with an access violation and leaves no trace, the system retries once", () => {
  assert.equal(ACCESS_VIOLATION_EXIT_STATUS, 3221225477);
  assert.equal(retries(), true);
});

test("when the first install succeeds or exits with any other status, the system does not retry", () => {
  assert.equal(retries({ result: { status: 0, signal: null, error: undefined } }), false);
  assert.equal(retries({ result: { status: 1, signal: null, error: undefined } }), false);
  assert.equal(retries({ result: { status: -1073741819, signal: null, error: undefined } }), false);
});

test("when the upgrade or the rollback dies with the same access violation, the system does not retry", () => {
  assert.equal(retries({ phase: "upgrade" }), false);
  assert.equal(retries({ phase: "rollback" }), false);
});

test("when the access violation arrives with a spawn error or a termination signal, the system does not retry", () => {
  const spawnError = new Error("spawn UNKNOWN");
  assert.equal(retries({ result: { status: null, signal: null, error: spawnError } }), false);
  assert.equal(retries({ result: { status: ACCESS_VIOLATION_EXIT_STATUS, signal: null, error: spawnError } }), false);
  assert.equal(retries({ result: { status: null, signal: "SIGTERM", error: undefined } }), false);
  assert.equal(
    retries({ result: { status: ACCESS_VIOLATION_EXIT_STATUS, signal: "SIGSEGV", error: undefined } }),
    false,
  );
});

test("when the crashed install left a registry entry, a shortcut, or a running Dexon process, the system does not retry", () => {
  assert.equal(retries({ installState: { entries: 1, shortcut: false, processes: 0 } }), false);
  assert.equal(retries({ installState: { entries: 0, shortcut: true, processes: 0 } }), false);
  assert.equal(retries({ installState: { entries: 0, shortcut: false, processes: 1 } }), false);
});

test("when the crashed install left files in the install directory, the system does not retry", () => {
  assert.equal(retries({ installDirectoryEntries: ["Dexon.exe"] }), false);
  assert.equal(retries({ installDirectoryEntries: ["resources"] }), false);
});
