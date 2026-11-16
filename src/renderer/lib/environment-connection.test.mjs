import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
import { installPrimaryHost } from "../hooks/agent-session/primary-host-test-fixture.mjs";

const { EnvironmentConnection } = await importTestBundle("environment-connection", {
  entryPoints: ["src/renderer/lib/environment-connection.ts"],
  tsconfig: "tsconfig.renderer.json",
});

function connectionFixture(t) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = {};
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: target });
  const channels = [];
  const host = installPrimaryHost(
    target,
    {},
    {
      createChannel() {
        const channel = new MessageChannel();
        channels.push(channel);
        return channel;
      },
    },
  );
  const connection = new EnvironmentConnection("primary");
  t.after(() => {
    connection.close();
    host.close();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  });
  return { connection, host, channels };
}

test("a physical primary port close immediately discards the client and the next call reconnects", async (t) => {
  const { connection, channels } = connectionFixture(t);
  assert.deepEqual(await connection.call("host.ping"), { ok: true, ts: 0 });
  const closed = once(channels[0].port1, "close");
  channels[0].port2.close();
  await closed;
  assert.equal(connection.getRpc(), null);
  assert.deepEqual(await connection.call("host.ping"), { ok: true, ts: 0 });
  assert.equal(channels.length, 2);
});

test("a primary call waits for host readiness without requesting a port early", async (t) => {
  const { connection, host, channels } = connectionFixture(t);
  host.publish(1, false);
  const pending = connection.call("host.ping");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(channels.length, 0);
  host.publish(2);
  assert.deepEqual(await pending, { ok: true, ts: 0 });
  assert.equal(channels.length, 1);
});

for (const initialStatus of ["unresponsive", "starting"]) {
  test(`a primary connection accepts a serving unresponsive host from ${initialStatus}`, async (t) => {
    const { connection, channels } = connectionFixture(t);
    let status = initialStatus;
    const listeners = new Set();
    globalThis.window.piBridge.getHostStatus = async () => status;
    globalThis.window.piBridge.onHostStatus = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    connection.updateStatus({ phase: "connected", generation: 1, since: 0 });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = connection.call("host.ping");
    void pending.catch(() => {});
    if (status === "starting") {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(channels.length, 0);
      status = "unresponsive";
      for (const listener of listeners) listener({ status });
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(channels.length, 1, "an attachable host is requested without waiting for a ready heartbeat");
    assert.deepEqual(await pending, { ok: true, ts: 0 });
  });
}
