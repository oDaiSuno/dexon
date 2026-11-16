import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { getPrimaryHostSnapshot } = await importTestBundle("primary-host-status", {
  entryPoints: ["src/renderer/lib/primary-host-status.ts"],
  tsconfig: "tsconfig.renderer.json",
});

function hostFixture(t, bridge) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = { piBridge: bridge };
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: target });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete globalThis.window;
    getPrimaryHostSnapshot();
  });
  return target;
}

test("a host event takes precedence over an older initial health query", async (t) => {
  let finishQuery;
  let statusChanged;
  hostFixture(t, {
    getHostStatus: () => new Promise((resolve) => (finishQuery = resolve)),
    onHostStatus(listener) {
      statusChanged = listener;
      return () => {};
    },
  });
  assert.equal(getPrimaryHostSnapshot().status, "ready");
  statusChanged({ status: "unresponsive", detail: "waiting for mount" });
  finishQuery("ready");
  await Promise.resolve();
  assert.deepEqual(getPrimaryHostSnapshot(), { status: "unresponsive", detail: "waiting for mount" });
  statusChanged({ status: "ready" });
  assert.deepEqual(getPrimaryHostSnapshot(), { status: "ready" });
});

test("replacing the bridge resets health and ignores old events and unresolved queries", async (t) => {
  let finishOldQuery;
  let oldStatusChanged;
  let detached = false;
  const target = hostFixture(t, {
    getHostStatus: () => new Promise((resolve) => (finishOldQuery = resolve)),
    onHostStatus(listener) {
      oldStatusChanged = listener;
      return () => (detached = true);
    },
  });
  getPrimaryHostSnapshot();
  oldStatusChanged({ status: "crashed", detail: "old host" });
  assert.equal(getPrimaryHostSnapshot().status, "crashed");
  target.piBridge = {};
  assert.deepEqual(getPrimaryHostSnapshot(), { status: "ready" });
  assert.equal(detached, true);
  oldStatusChanged({ status: "unresponsive" });
  finishOldQuery("stopped");
  await Promise.resolve();
  assert.deepEqual(getPrimaryHostSnapshot(), { status: "ready" });
  target.piBridge = { getHostStatus: async () => "starting" };
  assert.deepEqual(getPrimaryHostSnapshot(), { status: "ready" });
  await Promise.resolve();
  assert.deepEqual(getPrimaryHostSnapshot(), { status: "starting" });
});
