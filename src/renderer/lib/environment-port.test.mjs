import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { importTestBundle } from "#test-bundle";

const { requestEnvironmentPort } = await importTestBundle("environment-port", {
  entryPoints: ["src/renderer/lib/environment-port.ts"],
  tsconfig: "tsconfig.renderer.json",
});
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
});

function windowFixture() {
  const listeners = new Set();
  const target = {
    piBridge: { requestHostPort() {}, requestEnvironmentPort() {} },
    addEventListener: (_, receive) => listeners.add(receive),
    removeEventListener: (_, receive) => listeners.delete(receive),
  };
  globalThis.window = target;
  return {
    deliver(environmentId, generation) {
      let closed = false;
      const port = { close: () => (closed = true) };
      const event = {
        source: target,
        data: { channel: "dexon-host-port", environmentId, generation },
        ports: [port],
      };
      for (const receive of listeners) receive(event);
      return { port, closed: () => closed };
    },
  };
}

test("an independent primary host probe keeps its port after the environment connection completes", async () => {
  const fixture = windowFixture();
  const pending = requestEnvironmentPort("primary");
  fixture.deliver("primary");
  await pending;
  assert.equal(fixture.deliver("primary").closed(), false);
});

test("remote ports arriving after cancellation or completion are closed with no pending requests", async () => {
  const fixture = windowFixture();
  const controller = new globalThis.AbortController();
  const cancelled = requestEnvironmentPort("remote-one", controller.signal, 1);
  controller.abort();
  await assert.rejects(cancelled, /cancelled/u);
  assert.equal(fixture.deliver("remote-one", 1).closed(), true);
  const pending = requestEnvironmentPort("remote-one", undefined, 2);
  fixture.deliver("remote-one", 2);
  await pending;
  assert.equal(fixture.deliver("remote-one", 1).closed(), true);
  assert.equal(fixture.deliver("remote-two", 1).closed(), true);
});

test("a cancelled primary request closes its late port without taking the next independent probe", async () => {
  const fixture = windowFixture();
  const controller = new globalThis.AbortController();
  const pending = requestEnvironmentPort("primary", controller.signal, 1);
  controller.abort();
  await assert.rejects(pending, /cancelled/u);
  assert.equal(fixture.deliver("primary", 1).closed(), true);
  assert.equal(fixture.deliver("primary").closed(), false);
});

test("a timed-out primary request closes its late port without taking the next independent probe", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = windowFixture();
  const pending = requestEnvironmentPort("primary", undefined, 1);
  const rejected = assert.rejects(pending, /Timed out/u);
  t.mock.timers.tick(15_000);
  await rejected;
  assert.equal(fixture.deliver("primary", 1).closed(), true);
  assert.equal(fixture.deliver("primary").closed(), false);
});

test("a stale primary generation is closed while the requested generation still connects", async () => {
  const fixture = windowFixture();
  const pending = requestEnvironmentPort("primary", undefined, 2);
  assert.equal(fixture.deliver("primary", 1).closed(), true);
  const current = fixture.deliver("primary", 2);
  assert.equal((await pending).port, current.port);
  assert.equal(current.closed(), false);
});

test("a cancelled primary delivery during reconnect clears its orphan debt before an independent probe", async () => {
  const fixture = windowFixture();
  const controller = new globalThis.AbortController();
  const cancelled = requestEnvironmentPort("primary", controller.signal, 1);
  controller.abort();
  await assert.rejects(cancelled, /cancelled/u);
  const reconnect = requestEnvironmentPort("primary", undefined, 2);
  assert.equal(fixture.deliver("primary", 1).closed(), true);
  const current = fixture.deliver("primary", 2);
  assert.equal((await reconnect).port, current.port);
  assert.equal(current.closed(), false);
  assert.equal(fixture.deliver("primary", 2).closed(), false);
});
