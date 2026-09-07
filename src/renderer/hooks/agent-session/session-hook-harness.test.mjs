import { test } from "node:test";
import assert from "node:assert/strict";
import { setupSessionHookEnvironment } from "./session-hook-harness.mjs";

/**
 * Environment isolation contract for the harness support layer itself.
 *
 * setupSessionHookEnvironment() swaps a fixed set of globals for the duration
 * of a test. These tests pin the three properties the rest of the suite relies
 * on:
 *  1. a single harness restores every swapped global to its exact pre-test
 *     descriptor (value, writability, enumerability, configurability);
 *  2. several harnesses inside one test share ONE active environment — the
 *     second install must never rebuild window/document/scheduler/listeners
 *     (task and listener identity survive) and the last release restores the
 *     true pre-test state;
 *  3. every handle's restore() is idempotent and can never consume another
 *     handle's lease.
 * Each test cleans up through t.after, so a failed assertion can never leak a
 * half-restored environment into the next test.
 */

const GLOBAL_NAMES = [
  "window",
  "document",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
  "KeyboardEvent",
  "WheelEvent",
  "TouchEvent",
  "Element",
  "ResizeObserver",
];

function snapshotDescriptors() {
  return new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
}

function assertDescriptorsEqual(actual, expected, label) {
  for (const name of GLOBAL_NAMES) {
    const before = expected.get(name);
    const after = actual.get(name);
    assert.deepEqual(after, before, `${label}: descriptor of ${name} changed`);
  }
}

/** Installs a harness for the duration of the test, restoring on t.after. */
function withEnvironment(t) {
  const env = setupSessionHookEnvironment();
  t.after(() => env.restore());
  return env;
}

test("a single harness restores every swapped global descriptor", (t) => {
  const before = snapshotDescriptors();
  const env = withEnvironment(t);
  assert.ok(globalThis.window, "window stand-in installed");
  assert.ok(globalThis.document, "document stand-in installed");
  assert.equal(globalThis.IS_REACT_ACT_ENVIRONMENT, true, "act environment flag installed");
  env.restore();
  assertDescriptorsEqual(snapshotDescriptors(), before, "single harness");
});

test("two harnesses in one test restore the true pre-test descriptors", (t) => {
  const before = snapshotDescriptors();
  const first = withEnvironment(t);
  const second = withEnvironment(t);
  // Both harnesses observe the same installed stand-ins while active.
  assert.equal(globalThis.IS_REACT_ACT_ENVIRONMENT, true, "stand-ins visible to both harnesses");
  // Release in creation order: the first restore must be a no-op, the second
  // must put back the descriptors captured before either harness installed.
  first.restore();
  assert.equal(globalThis.IS_REACT_ACT_ENVIRONMENT, true, "first release keeps the environment installed");
  second.restore();
  assertDescriptorsEqual(snapshotDescriptors(), before, "two harnesses");
});

test("releasing the last lease twice is harmless and leaves the environment clean", (t) => {
  const before = snapshotDescriptors();
  const env = withEnvironment(t);
  env.restore();
  env.restore();
  assertDescriptorsEqual(snapshotDescriptors(), before, "double release");
});

test("a fresh install after a full release starts from the true pre-test state", (t) => {
  const before = snapshotDescriptors();
  const first = withEnvironment(t);
  first.restore();
  const second = withEnvironment(t);
  second.restore();
  assertDescriptorsEqual(snapshotDescriptors(), before, "install after release");
});

test("a double release cannot consume another active handle's lease", (t) => {
  const before = snapshotDescriptors();
  const first = withEnvironment(t);
  const second = withEnvironment(t);
  const activeWindow = globalThis.window;
  first.restore();
  first.restore();
  assert.equal(globalThis.window, activeWindow, "the second handle's environment stays installed");
  assert.equal(globalThis.IS_REACT_ACT_ENVIRONMENT, true, "stand-ins still active");
  second.restore();
  assertDescriptorsEqual(snapshotDescriptors(), before, "double release with an active lease");
});

test("a stale handle cannot release a later installation", (t) => {
  const before = snapshotDescriptors();
  const first = withEnvironment(t);
  first.restore();
  const second = withEnvironment(t);
  const activeWindow = globalThis.window;
  first.restore();
  assert.equal(globalThis.window, activeWindow, "the stale handle leaves the new installation alone");
  second.restore();
  assertDescriptorsEqual(snapshotDescriptors(), before, "stale handle across install rounds");
});

test("releasing in reverse order still restores the true pre-test state", (t) => {
  const before = snapshotDescriptors();
  const first = withEnvironment(t);
  const second = withEnvironment(t);
  second.restore();
  assert.equal(globalThis.IS_REACT_ACT_ENVIRONMENT, true, "the first handle's lease keeps the environment installed");
  first.restore();
  assertDescriptorsEqual(snapshotDescriptors(), before, "reverse release");
});

test("a second install preserves the active window and frame scheduler identity", (t) => {
  withEnvironment(t);
  const firstWindow = globalThis.window;
  const firstRaf = globalThis.requestAnimationFrame;
  const second = withEnvironment(t);
  assert.equal(globalThis.window, firstWindow, "window identity preserved across installs");
  assert.equal(globalThis.requestAnimationFrame, firstRaf, "frame scheduler identity preserved across installs");
  second.restore();
});

test("later leases share listeners and storage with the first", (t) => {
  const first = withEnvironment(t);
  const received = [];
  globalThis.window.addEventListener("ping", (event) => received.push(event.detail));
  globalThis.window.sessionStorage.setItem("shared", "kept");
  const second = withEnvironment(t);
  assert.equal(globalThis.window.sessionStorage.getItem("shared"), "kept", "storage survives the second install");
  second.windowEvent("ping", { detail: "hi" });
  assert.deepEqual(received, ["hi"], "a listener from the first lease fires through the second lease");
  first.restore();
});

test("a second install shares the task queue: retained frames still run", async (t) => {
  const first = withEnvironment(t);
  const calls = [];
  globalThis.requestAnimationFrame(() => calls.push("retained"));
  const cancelledId = globalThis.requestAnimationFrame(() => calls.push("cancelled"));
  const second = withEnvironment(t);
  globalThis.cancelAnimationFrame(cancelledId);
  await second.flushRaf();
  assert.deepEqual(calls, ["retained"], "the retained frame ran through the shared queue");
  assert.equal(first.rafSize(), 0, "both handles see the same empty queue afterwards");
  first.restore();
});
