import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { useEffect } from "react";
import { installHostBridge } from "../support/host-bridge.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
const api = await loadRenderer(
  "renderer-host-boundary",
  'export {call, subscribe} from "./src/renderer/lib/api-client.ts";',
);
after(restoreGlobals);

test("the real renderer can obtain a host result and receive a subscribed update", async (t) => {
  const host = installHostBridge(dom.window, { call: () => ({ sessions: [{ id: "session-one" }] }) });
  t.after(() => {
    api.resetRpc();
    host.close();
  });
  assert.deepEqual(await api.call("sessions.list"), { sessions: [{ id: "session-one" }] });
  const received = [];
  const off = await api.subscribe("sessions.changed", "*", (event) => received.push(event));
  host.emit("sessions.changed", "*", { reason: "created", sessionId: "session-one" });
  await Promise.resolve();
  assert.deepEqual(received, [{ reason: "created", sessionId: "session-one" }]);
  off();
  host.emit("sessions.changed", "*", { reason: "deleted", sessionId: "session-one" });
  await Promise.resolve();
  assert.equal(received.length, 1, "unsubscribed updates no longer reach the caller");
});

test("closing a released Host fixture again leaves the next renderer connection usable", async (t) => {
  const first = installApiHostBridge(dom.window, () => ({ listSessions: async () => [] }), api.resetRpc);
  let following;
  t.after(() => {
    following?.close();
    first.close();
  });
  assert.deepEqual(await api.call("sessions.list"), []);
  first.close();

  following = installApiHostBridge(dom.window, () => ({ listSessions: async () => [] }), api.resetRpc);
  assert.deepEqual(await api.call("sessions.list"), []);
  first.close();
  assert.deepEqual(await api.call("sessions.list"), [], "the following Host remains reachable after repeated cleanup");
});

test("closing a released protocol fixture again preserves the following Host handshake", async (t) => {
  const first = installHostBridge(dom.window, { call: async () => [] });
  first.close();
  const following = installHostBridge(dom.window, { call: async () => [] });
  t.after(() => {
    api.resetRpc();
    following.close();
    first.close();
  });
  first.close();
  assert.equal(await dom.window.piBridge.getHostStatus(), "ready");
  assert.deepEqual(await api.call("sessions.list"), []);
});

test("a failed external unsubscribe still restores the borrowed window and closes the protocol", async (t) => {
  const original = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  const active = new Set();
  const host = installHostBridge(dom.window, {
    call: async () => [],
    subscribe(topic) {
      active.add(topic);
      return () => {
        active.delete(topic);
        if (topic === "sessions.changed") throw new Error("external unsubscribe failed");
      };
    },
  });
  t.after(() => {
    api.resetRpc();
    host.close();
  });
  await api.subscribe("sessions.changed", "*", () => {});
  await api.subscribe("agent.running", "*", () => {});
  assert.throws(() => host.close(), /external unsubscribe failed/);
  assert.deepEqual([...active], [], "other external subscriptions are released despite the first failure");
  assert.deepEqual(Object.getOwnPropertyDescriptor(dom.window, "piBridge"), original);
  assert.doesNotThrow(() => host.emit("sessions.changed", "*", { reason: "created", sessionId: "late" }));
});

test("a rejected Host acquisition restores every window property it already borrowed", (t) => {
  const properties = ["piBridge", "addEventListener", "removeEventListener"];
  const original = properties.map((name) => [name, Object.getOwnPropertyDescriptor(dom.window, name)]);
  t.after(() => {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(dom.window, name, descriptor);
      else delete dom.window[name];
    }
  });
  Object.defineProperty(dom.window, "piBridge", { configurable: true, writable: false, value: {} });
  const before = properties.map((name) => Object.getOwnPropertyDescriptor(dom.window, name));
  assert.throws(() => installHostBridge(dom.window), TypeError);
  assert.deepEqual(
    properties.map((name) => Object.getOwnPropertyDescriptor(dom.window, name)),
    before,
  );
});

test("disposing a mounted scene restores its borrowed Host and removes its page", async (t) => {
  const original = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  const host = installApiHostBridge(dom.window, () => ({ listSessions: async () => [] }), api.resetRpc);
  t.after(() => host.close());
  const view = await mount(t, "button", { children: "Read sessions" }, { release: () => host.close() });
  assert.deepEqual(await api.call("sessions.list"), []);
  assert.equal(view.container.isConnected, true);

  await view.unmount();
  assert.equal(view.container.isConnected, false);
  assert.deepEqual(Object.getOwnPropertyDescriptor(dom.window, "piBridge"), original);
});

test("a failed scene mount reports its render and release failures without leaving a page", async (t) => {
  const baseline = dom.window.document.body.childElementCount;
  function BrokenPage() {
    throw new Error("Scene render failed");
  }
  await assert.rejects(
    mount(
      t,
      BrokenPage,
      {},
      {
        release() {
          throw new Error("Scene release failed");
        },
      },
    ),
    (error) => {
      assert.deepEqual(
        new Set(error.errors?.map((failure) => failure.message)),
        new Set(["Scene render failed", "Scene release failed"]),
      );
      return true;
    },
  );
  assert.equal(dom.window.document.body.childElementCount, baseline);
});

test("scene cleanup releases its page and Host and preserves both reported failures", async (t) => {
  const original = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  const host = installHostBridge(dom.window, {
    subscribe: () => () => {
      throw new Error("Host release failed");
    },
  });
  t.after(() => {
    api.resetRpc();
    host.close();
  });
  await api.subscribe("sessions.changed", "*", () => {});
  function FaultyPage() {
    useEffect(
      () => () => {
        throw new Error("Page cleanup failed");
      },
      [],
    );
    return createElement("button", null, "Owned page");
  }
  const view = await mount(
    t,
    FaultyPage,
    {},
    {
      release() {
        try {
          host.close();
        } finally {
          api.resetRpc();
        }
      },
    },
  );
  await assert.rejects(view.unmount(), (error) => {
    assert.deepEqual(
      new Set(error.errors?.map((failure) => failure.message)),
      new Set(["Page cleanup failed", "Host release failed"]),
    );
    return true;
  });
  assert.equal(view.container.isConnected, false);
  assert.deepEqual(Object.getOwnPropertyDescriptor(dom.window, "piBridge"), original);
});
