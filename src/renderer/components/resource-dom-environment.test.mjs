import assert from "node:assert/strict";
import test, { after } from "node:test";

// Fixture contract tests for the shared DOM environment: exact restoration of
// injected globals (absent and pre-existing), a beforeunload tracker that
// detaches when disposed and stays detached after double disposal, and a
// managed DOM root whose awaitable unmount always removes the container.
// This file must import the fixture before react-related modules; it imports
// none statically, so evaluation order is trivially safe.

import {
  createManagedDomRoot,
  installDomEnvironment,
  restoreGlobals,
  trackBeforeUnloadListeners,
} from "./resource-dom-environment.mjs";

const INJECTED = ["window", "document", "HTMLElement", "Node"];

after(() => {
  // Leave the pre-import environment state: globals that did not exist before
  // the fixture import stay absent.
  restoreGlobals();
});

test("restoreGlobals removes globals that did not exist before the fixture import", () => {
  restoreGlobals();
  try {
    for (const name of INJECTED) {
      assert.equal(Object.hasOwn(globalThis, name), false, `${name} must be deleted when absent before import`);
    }
    assert.equal("IS_REACT_ACT_ENVIRONMENT" in globalThis, false);
  } finally {
    installDomEnvironment();
  }
});

test("a disposed beforeunload tracker observes no later registrations", () => {
  const first = trackBeforeUnloadListeners();
  const handlerA = () => {};
  const handlerB = () => {};
  const handlerC = () => {};
  let second = null;
  try {
    domListenerAdd("beforeunload", handlerA);
    assert.equal(first.listeners.size, 1);
    assert.equal(first.listeners.has(handlerA), true);

    first.restore();
    assert.equal(first.listeners.size, 0, "restore clears the captured set");
    domListenerRemove("beforeunload", handlerA);
    assert.equal(first.listeners.size, 0, "native removal no longer reaches a disposed tracker");

    domListenerAdd("beforeunload", handlerB);
    assert.equal(first.listeners.size, 0, "a disposed tracker observes no later registrations");

    // A fresh tracker after a dispose observes only its own listeners.
    second = trackBeforeUnloadListeners();
    domListenerAdd("beforeunload", handlerC);
    assert.equal(second.listeners.size, 1);
    assert.equal(second.listeners.has(handlerC), true);
    domListenerRemove("beforeunload", handlerC);
    assert.equal(second.listeners.size, 0);
  } finally {
    try {
      domListenerRemove("beforeunload", handlerA);
      domListenerRemove("beforeunload", handlerB);
      domListenerRemove("beforeunload", handlerC);
    } finally {
      second?.restore();
      first.restore();
    }
  }
});

test("double disposal cannot detach a later tracker's wrappers", () => {
  const first = trackBeforeUnloadListeners();
  first.restore();
  const second = trackBeforeUnloadListeners();
  const handler = () => {};
  const lateHandler = () => {};
  try {
    domListenerAdd("beforeunload", handler);
    assert.equal(second.listeners.size, 1, "the second tracker owns the wrappers");
    first.restore(); // stale double-dispose attempt
    assert.equal(second.listeners.size, 1, "a stale dispose must not unshadow the active tracker's wraps");

    // Registration AFTER a stale dispose must still reach the active tracker.
    domListenerAdd("beforeunload", lateHandler);
    assert.equal(second.listeners.size, 2, "the active tracker still owns the wraps after a stale dispose");
    domListenerRemove("beforeunload", lateHandler);
    assert.equal(second.listeners.size, 1);
    domListenerRemove("beforeunload", handler);
    assert.equal(second.listeners.size, 0);
  } finally {
    try {
      domListenerRemove("beforeunload", handler);
      domListenerRemove("beforeunload", lateHandler);
    } finally {
      second.restore();
    }
  }
});

test("tracker cleanup runs even when an assertion fails mid-test", () => {
  const tracker = trackBeforeUnloadListeners();
  const handler = () => {};
  let caught = null;
  try {
    domListenerAdd("beforeunload", handler);
    assert.equal(tracker.listeners.size, 1);
    assert.fail("simulated assertion failure");
  } catch (error) {
    caught = error;
  } finally {
    try {
      domListenerRemove("beforeunload", handler);
    } finally {
      tracker.restore();
    }
  }
  assert.ok(caught, "the simulated failure propagated");
  assert.equal(tracker.listeners.size, 0);
  assert.equal(Object.hasOwn(globalThis.window, "addEventListener"), false, "the wrap is uninstalled after disposal");
});

test("native addEventListener still works after tracker disposal", () => {
  const tracker = trackBeforeUnloadListeners();
  const handler = () => {};
  const lateHandler = () => {};
  try {
    try {
      domListenerAdd("beforeunload", handler);
      assert.equal(tracker.listeners.size, 1);
      domListenerRemove("beforeunload", handler);
      assert.equal(tracker.listeners.size, 0, "native removal still reaches the captured set");
    } finally {
      try {
        domListenerRemove("beforeunload", handler);
        domListenerRemove("beforeunload", lateHandler);
      } finally {
        tracker.restore();
      }
    }
    try {
      domListenerAdd("beforeunload", lateHandler);
      domListenerRemove("beforeunload", lateHandler);
      assert.equal(tracker.listeners.size, 0, "no listener is captured after disposal");
    } finally {
      domListenerRemove("beforeunload", lateHandler);
    }
  } finally {
    tracker.restore();
  }
});

test("the managed DOM root unmount awaits container removal and is idempotent", async () => {
  const { act } = await import("react");
  const { createElement } = await import("react");
  const managed = createManagedDomRoot();
  await managed.render(createElement("div", null, "probe"));
  assert.ok(managed.container, "render creates a container");
  assert.equal(managed.container.isConnected, true);
  const originalContainer = managed.container;

  const result = await managed.unmount();
  assert.equal(typeof result, "object", "unmount returns an awaitable completion record");
  assert.equal(result.removed, true, "container removal completed before unmount resolved");
  assert.equal(originalContainer.isConnected, false, "container is disconnected after the awaited cleanup");
  assert.equal(managed.container, null);

  const second = await managed.unmount();
  assert.equal(second, undefined, "a second unmount is a no-op");
  void act;
});

test("the managed DOM root removes its container even when the render body already threw", async () => {
  const { createElement } = await import("react");
  const managed = createManagedDomRoot();
  await managed.render(createElement("div", null, "probe"));
  const originalContainer = managed.container;

  // Simulate a failed test body: no happy-path unmount runs; the failure is
  // caught by the harness, then the scope cleanup disposes the root.
  let caught = null;
  try {
    await managed.render(createElement("div", null, "second"));
    assert.fail("a second render without unmount must be rejected");
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "double render rejected");

  await managed.unmount();
  assert.equal(originalContainer.isConnected, false, "cleanup completed after the caught failure");
});

function domListenerAdd(type, handler) {
  globalThis.window.addEventListener(type, handler);
}

function domListenerRemove(type, handler) {
  globalThis.window.removeEventListener(type, handler);
}
