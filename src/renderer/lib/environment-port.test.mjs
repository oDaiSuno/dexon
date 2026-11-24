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

function windowFixture(bridge = {}) {
  const listeners = new Set();
  const target = {
    piBridge: { requestHostPort() {}, requestEnvironmentPort() {}, ...bridge },
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

test("a failed primary acknowledgement clears its timer without consuming the next independent probe", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = windowFixture({
    requestHostPort: () => Promise.reject(new Error("Agent Host is not ready")),
  });
  await assert.rejects(requestEnvironmentPort("primary", undefined, 1), /Agent Host is not ready/u);
  t.mock.timers.tick(15_000);
  assert.equal(fixture.deliver("primary").closed(), false);
});

test("an old failed acknowledgement cannot reject a newer request for the same environment", async () => {
  const acknowledgements = [];
  const fixture = windowFixture({
    requestEnvironmentPort: () => new Promise((resolve, reject) => acknowledgements.push({ resolve, reject })),
  });
  const controller = new globalThis.AbortController();
  const cancelled = requestEnvironmentPort("remote-one", controller.signal, 1);
  controller.abort();
  await assert.rejects(cancelled, /cancelled/u);

  const reconnect = requestEnvironmentPort("remote-one", undefined, 2);
  acknowledgements[0].reject(new Error("Old connection failed"));
  await Promise.resolve();
  const delivered = fixture.deliver("remote-one", 2);
  assert.equal((await reconnect).port, delivered.port);
  assert.equal(delivered.closed(), false);
  acknowledgements[1].resolve();
});

test("a late failed acknowledgement cannot replace a delivered port or reject a subsequent primary request", async () => {
  const acknowledgements = [];
  const fixture = windowFixture({
    requestHostPort: () => new Promise((resolve, reject) => acknowledgements.push({ resolve, reject })),
  });
  const connected = requestEnvironmentPort("primary", undefined, 1);
  const original = fixture.deliver("primary", 1);
  assert.equal((await connected).port, original.port);

  const reconnect = requestEnvironmentPort("primary", undefined, 2);
  acknowledgements[0].reject(new Error("Old transfer failed"));
  await Promise.resolve();
  assert.equal(original.closed(), false);
  const current = fixture.deliver("primary", 2);
  assert.equal((await reconnect).port, current.port);
  assert.equal(current.closed(), false);
  acknowledgements[1].resolve();
});

test("a rejected bridge request fails only its own environment while another environment still connects", async () => {
  const fixture = windowFixture({
    requestEnvironmentPort: (environmentId) =>
      environmentId === "remote-one" ? Promise.reject(new Error("Remote one is offline")) : undefined,
  });
  const offline = requestEnvironmentPort("remote-one", undefined, 1);
  const online = requestEnvironmentPort("remote-two", undefined, 3);
  await assert.rejects(offline, /Remote one is offline/u);
  const delivered = fixture.deliver("remote-two", 3);
  assert.equal((await online).port, delivered.port);
  assert.equal(delivered.closed(), false);
});
