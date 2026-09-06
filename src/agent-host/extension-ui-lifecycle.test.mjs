import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { AgentSessionWrapper } = await importTestBundle("extension-ui-lifecycle", {
  packages: "external",
  stdin: {
    contents: 'export { AgentSessionWrapper } from "./rpc-manager.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "extension-ui-test.ts",
    loader: "ts",
  },
});

function fixture(t) {
  const inner = {
    sessionId: "interactive-fixture",
    agent: { state: { messages: [] } },
    sessionManager: { getHeader: () => ({ cwd: "/isolated" }) },
    extensionRunner: { setUIContext() {} },
  };
  const wrapper = new AgentSessionWrapper(inner, undefined, () => {});
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return { wrapper, events, ui: wrapper.createExtensionUiContext() };
}

test("aborting an SDK dialog releases its waiter and notifies the renderer", async (t) => {
  const { ui, events } = fixture(t);
  const controller = new globalThis.AbortController();
  const waiting = ui.input("A question", undefined, { signal: controller.signal });
  const id = events.find((event) => event.method === "input").id;
  controller.abort();
  assert.equal(await waiting, undefined);
  assert.ok(events.some((event) => event.type === "extension_ui_closed" && event.id === id));
});

test("explicit abandonment ends a custom UI even when it ignores control-C", { timeout: 2000 }, async (t) => {
  const { ui, wrapper } = fixture(t);
  const ready = Promise.withResolvers();
  wrapper.onEvent((event) => {
    if (event.method === "custom") ready.resolve(event);
  });
  let disposed = 0;
  const waiting = ui.custom(() => ({
    render: () => ["Still waiting"],
    handleInput() {},
    dispose() {
      disposed++;
    },
  }));
  const request = await ready.promise;
  const receipt = await wrapper.send({ type: "extension_ui_response", id: request.id, cancelled: true });
  assert.equal(receipt?.status, "cancelled");
  assert.equal(await waiting, undefined);
  assert.equal(disposed, 1);
});

test("timeout closes and removes the request, and replay cannot extend its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const { ui, wrapper } = fixture(t);
  const waiting = ui.input("Timed question", undefined, { timeout: 500 });
  const first = wrapper.getInteractiveSnapshot();
  assert.equal(first.requests[0].expiresAt, 1500);
  t.mock.timers.tick(250);
  let replay;
  wrapper.onEvent((event) => {
    if (event.type === "extension_ui_snapshot") replay = event.snapshot;
  });
  assert.equal(replay.requests[0].expiresAt, 1500);
  t.mock.timers.tick(250);
  assert.equal(await waiting, undefined);
  assert.equal(wrapper.getInteractiveSnapshot().requests.length, 0);
  assert.equal(wrapper.getInteractiveSnapshot().completed[0].reason, "timeout");
});

test("retry after a lost acknowledgement settles the backend waiter only once", async (t) => {
  const { ui, wrapper, events } = fixture(t);
  const waiting = ui.input("Question");
  const id = wrapper.getInteractiveSnapshot().requests[0].id;
  const command = { type: "extension_ui_response", id, value: "literal answer" };
  const first = await wrapper.send(command);
  const second = await wrapper.send(command);
  assert.deepEqual(first, second);
  assert.equal(first.status, "submitted");
  assert.equal(await waiting, "literal answer");
  assert.equal(events.filter((e) => e.type === "extension_ui_closed" && e.id === id).length, 1);
});

test("malformed confirmation cannot authorize or settle the request", async (t) => {
  const { ui, wrapper } = fixture(t);
  const waiting = ui.confirm("Explicit", "A decision");
  const id = wrapper.getInteractiveSnapshot().requests[0].id;
  await assert.rejects(wrapper.send({ type: "extension_ui_response", id, value: "yes" }), /explicit confirmation/);
  assert.equal(wrapper.getInteractiveSnapshot().requests.length, 1);
  await wrapper.send({ type: "extension_ui_response", id, confirmed: false });
  assert.equal(await waiting, false);
});

test("shutdown releases a factory still constructing its custom panel", async (t) => {
  const { ui, wrapper } = fixture(t);
  const factory = Promise.withResolvers();
  const ready = Promise.withResolvers();
  let disposed = 0;
  const waiting = ui.custom(() => {
    ready.resolve();
    return factory.promise;
  });
  await ready.promise;
  wrapper.destroy();
  assert.equal(await waiting, undefined);
  factory.resolve({
    render: () => ["late"],
    dispose() {
      disposed++;
    },
  });
  await factory.promise;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(disposed, 1);
  assert.equal(wrapper.getInteractiveSnapshot().requests.length, 0);
});

test("a custom factory finishing synchronously does not orphan its promise", async (t) => {
  const { ui, wrapper } = fixture(t);
  const result = await ui.custom((_tui, _theme, _keys, done) => {
    done("finished");
    return { render: () => ["late"] };
  });
  assert.equal(result, "finished");
  assert.equal(wrapper.getInteractiveSnapshot().requests.length, 0);
});

test("stopping a task releases ordinary and custom requests before awaiting agent shutdown", async (t) => {
  const { ui, wrapper } = fixture(t);
  let aborted = 0;
  wrapper.inner.abort = async () => {
    aborted++;
  };
  const ordinary = ui.input("Waiting");
  const custom = ui.custom(() => ({ render: () => ["ignores control-C"] }));
  await wrapper.send({ type: "abort" });
  assert.equal(await ordinary, undefined);
  assert.equal(await custom, undefined);
  assert.equal(aborted, 1);
  assert.equal(wrapper.getInteractiveSnapshot().requests.length, 0);
  assert.ok(wrapper.getInteractiveSnapshot().completed.every((r) => r.status === "expired"));
});
