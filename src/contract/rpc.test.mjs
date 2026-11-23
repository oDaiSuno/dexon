import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";

import { createRpcClient, createRpcServer } from "./rpc.ts";
import { RpcError } from "./types.ts";
import { ToolchainError } from "../shared/toolchains/errors.ts";
import { gatekeeperRefusal, isGatekeeperMethod } from "./gatekeeper-methods.ts";

function createPair(t, audience, clientOptions) {
  const { port1, port2 } = new MessageChannel();
  const server = createRpcServer();
  if (audience === undefined) server.attachPort(port1);
  else server.attachPort(port1, audience);
  const client = createRpcClient(port2, clientOptions);
  t.after(() => {
    client.close();
    server.detachPort(port1);
  });
  return { client, server };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("performs request/response calls and reports missing methods", async (t) => {
  const { client, server } = createPair(t);
  server.handle({ "host.ping": () => ({ ok: true, ts: 42 }) });

  assert.deepEqual(await client.call("host.ping"), { ok: true, ts: 42 });
  await assert.rejects(client.call("not.registered"), (error) => {
    assert.equal(error instanceof RpcError, true);
    assert.equal(error.code, "METHOD_NOT_FOUND");
    assert.match(error.message, /not\.registered/);
    return true;
  });
  for (const inheritedName of ["constructor", "toString", "__proto__"]) {
    await assert.rejects(client.call(inheritedName), (error) => {
      assert.equal(error instanceof RpcError, true);
      assert.equal(error.code, "METHOD_NOT_FOUND");
      assert.match(error.message, new RegExp(inheritedName));
      return true;
    });
  }
});

const restrictedCalls = [
  [
    "automation.enableTask",
    { taskId: "task-1", revision: 1, planHash: "a".repeat(64) },
    { task: { id: "task-1", enabledRevision: 1 } },
  ],
  [
    "automation.resolveAttention",
    {
      runId: "run-1",
      stepIndex: 0,
      expectedVersion: 1,
      requestId: "request-1",
      resolution: { kind: "attention", action: "retry" },
    },
    { ok: false, reason: "not_found" },
  ],
  ["automation.setSecret", { name: "api-key", value: "secret" }, { ok: true }],
  ["automation.deleteSecret", { name: "api-key" }, { ok: true }],
  ["automation.listSecretNames", undefined, { names: ["api-key"] }],
];

test("gatekeeper refusals preserve request identity and leave unrestricted methods alone", () => {
  for (const [method] of restrictedCalls) {
    assert.equal(isGatekeeperMethod(method), true);
    assert.deepEqual(gatekeeperRefusal({ id: "request-1", method }), {
      kind: "response",
      id: "request-1",
      ok: false,
      error: { code: "FORBIDDEN", message: "Automation operation requires desktop authorization" },
    });
  }
  for (const method of [
    "host.ping",
    "automation.activity",
    "automation.resolveInbox",
    "constructor",
    "__proto__",
    "unknown",
  ]) {
    assert.equal(isGatekeeperMethod(method), false);
    assert.equal(gatekeeperRefusal({ id: "request-1", method }), null);
  }
});

for (const audience of [undefined, "renderer"]) {
  test(
    `${audience ?? "default"} ports refuse all desktop-authorized operations without disrupting calls or subscriptions`,
    { timeout: 5_000 },
    async (t) => {
      const { client, server } = createPair(t, audience, { callTimeoutMs: 1_000 });
      server.handle({
        "host.ping": () => ({ ok: true, ts: 42 }),
        ...Object.fromEntries(
          restrictedCalls.map(([method]) => [
            method,
            () => {
              throw new Error("A renderer must not dispatch a desktop-authorized operation");
            },
          ]),
        ),
      });
      const events = [];
      const firstEvent = new Promise((resolve) => {
        client.subscribe("files.changed", "/project", (event) => {
          events.push(event);
          resolve();
        });
      });
      await client.call("host.ping");
      server.emit("files.changed", "/project", { event: "change", path: "/project/before" });
      await firstEvent;

      for (const [method, params] of restrictedCalls) {
        const ping = client.call("host.ping");
        await assert.rejects(client.call(method, params), (error) => {
          assert.equal(error instanceof RpcError, true);
          assert.equal(error.code, "FORBIDDEN");
          assert.equal(error.message, "Automation operation requires desktop authorization");
          return true;
        });
        assert.deepEqual(await ping, { ok: true, ts: 42 });
      }

      const afterEvent = new Promise((resolve) => {
        const unsubscribe = client.subscribe("files.changed", "/project", () => {
          unsubscribe();
          resolve();
        });
      });
      await client.call("host.ping");
      server.emit("files.changed", "/project", { event: "change", path: "/project/after" });
      await afterEvent;
      assert.deepEqual(events, [
        { event: "change", path: "/project/before" },
        { event: "change", path: "/project/after" },
      ]);
      assert.deepEqual(await client.call("host.ping"), { ok: true, ts: 42 });
    },
  );
}

test("gatekeeper ports dispatch all five desktop-authorized operations", async (t) => {
  const { client, server } = createPair(t, "gatekeeper");
  server.handle(Object.fromEntries(restrictedCalls.map(([method, , result]) => [method, () => result])));

  for (const [method, params, result] of restrictedCalls) {
    assert.deepEqual(await client.call(method, params), result);
  }
});

test("serializes RpcError detail and maps ordinary errors to INTERNAL", async (t) => {
  const { client, server } = createPair(t);
  server.handle({
    "host.ping": () => {
      throw new RpcError({ code: "FORBIDDEN", message: "No access", detail: { path: "/secret" } });
    },
    "sessions.list": () => {
      throw new Error("database unavailable");
    },
  });

  await assert.rejects(client.call("host.ping"), (error) => {
    assert.equal(error.code, "FORBIDDEN");
    assert.equal(error.message, "No access");
    assert.deepEqual(error.detail, { path: "/secret" });
    return true;
  });
  await assert.rejects(client.call("sessions.list"), (error) => {
    assert.equal(error.code, "INTERNAL");
    assert.equal(error.message, "database unavailable");
    return true;
  });
});

test("preserves structured toolchain errors across the RPC boundary", async (t) => {
  const { client, server } = createPair(t);
  server.handle({
    "host.ping": () => {
      throw new ToolchainError({
        code: "TOOLCHAIN_NODE_REQUIRED",
        capability: "js.npm",
        causeCode: "ENOENT",
        message: "Node.js with npm is required",
      });
    },
  });

  await assert.rejects(client.call("host.ping"), (error) => {
    assert.equal(error.code, "TOOLCHAIN_NODE_REQUIRED");
    assert.equal(error.message, "Node.js with npm is required");
    assert.deepEqual(error.detail, { capability: "js.npm", causeCode: "ENOENT" });
    return true;
  });
});

test("returns a minimal error when a handler result cannot be structured-cloned", async (t) => {
  const { client, server } = createPair(t);
  server.handle({
    "host.ping": () => ({ ok: true, uncloneable: () => undefined }),
  });

  await assert.rejects(client.call("host.ping"), (error) => {
    assert.equal(error instanceof RpcError, true);
    assert.equal(error.code, "SERIALIZATION_FAILED");
    assert.equal(error.message, "RPC response could not be serialized");
    return true;
  });
});

test("matches exact and wildcard subscriptions and isolates subscriber errors", async (t) => {
  const { client, server } = createPair(t);
  server.handle({ "host.ping": () => ({ ok: true, ts: 1 }) });
  const received = [];
  client.subscribe("files.changed", "/project", () => {
    throw new Error("subscriber failure");
  });
  client.subscribe("files.changed", "/project", (event) => received.push(["exact", event.event]));
  client.subscribe("files.changed", "*", (event) => received.push(["client-wildcard", event.event]));
  await client.call("host.ping");

  server.emit("files.changed", "/project", { event: "change", path: "/project/a" });
  server.emit("files.changed", "*", { event: "rename", path: "/project/b" });
  await nextTurn();

  assert.deepEqual(received, [
    ["exact", "change"],
    ["client-wildcard", "change"],
    ["exact", "rename"],
    ["client-wildcard", "rename"],
  ]);
});

test("unsubscribe prevents later events", async (t) => {
  const { client, server } = createPair(t);
  server.handle({ "host.ping": () => ({ ok: true, ts: 1 }) });
  let calls = 0;
  const unsubscribe = client.subscribe("files.changed", "/project", () => {
    calls += 1;
  });
  await client.call("host.ping");
  unsubscribe();
  await client.call("host.ping");

  server.emit("files.changed", "/project", { event: "change", path: "/project/a" });
  await nextTurn();
  assert.equal(calls, 0);
});

test("client close rejects pending calls", async () => {
  const { port1, port2 } = new MessageChannel();
  const server = createRpcServer();
  server.handle({ "host.ping": () => new Promise(() => {}) });
  server.attachPort(port1);
  const client = createRpcClient(port2);
  const pending = client.call("host.ping");
  await nextTurn();

  client.close();
  await assert.rejects(pending, (error) => error instanceof RpcError && error.code === "CLOSED");
  server.detachPort(port1);
});

test("client calls time out and remote close settles pending calls", async () => {
  {
    const { port1, port2 } = new MessageChannel();
    const server = createRpcServer();
    server.handle({ "host.ping": () => new Promise(() => {}) });
    server.attachPort(port1);
    const client = createRpcClient(port2, { callTimeoutMs: 20 });

    await assert.rejects(client.call("host.ping"), (error) => error instanceof RpcError && error.code === "TIMEOUT");
    client.close();
    server.detachPort(port1);
  }

  {
    const { port1, port2 } = new MessageChannel();
    const server = createRpcServer();
    server.handle({ "host.ping": () => new Promise(() => {}) });
    server.attachPort(port1);
    const client = createRpcClient(port2, { callTimeoutMs: 1_000 });
    const pending = client.call("host.ping");
    await nextTurn();
    port1.close();

    await assert.rejects(pending, (error) => error instanceof RpcError && error.code === "CLOSED");
    client.close();
  }
});

test("per-method timeouts leave other methods and the client connection available", async (t) => {
  const { client, server } = createPair(t, undefined, {
    callTimeoutMs: 2_000,
    methodTimeoutMs: { "host.ping": 20 },
  });
  server.handle({
    "host.ping": () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, ts: 1 }), 80)),
    "sessions.list": () => new Promise((resolve) => setTimeout(() => resolve({ sessions: [] }), 80)),
  });

  const sessions = client.call("sessions.list");
  await assert.rejects(client.call("host.ping"), (error) => error instanceof RpcError && error.code === "TIMEOUT");
  assert.deepEqual(await sessions, { sessions: [] });
  assert.deepEqual(await client.call("sessions.list"), { sessions: [] });
  server.handle({ "host.ping": () => ({ ok: true, ts: 42 }) });
  assert.deepEqual(await client.call("host.ping"), { ok: true, ts: 42 });
});

test("a remote port close tells the client owner once while a local close stays silent", async () => {
  const closures = [];
  {
    const { port1, port2 } = new MessageChannel();
    const server = createRpcServer();
    server.handle({ "host.ping": () => new Promise(() => {}) });
    server.attachPort(port1);
    const client = createRpcClient(port2, { onClosed: () => closures.push("remote") });
    const pending = client.call("host.ping");
    await nextTurn();
    port1.close();

    await assert.rejects(pending, (error) => error instanceof RpcError && error.code === "CLOSED");
    assert.deepEqual(closures, ["remote"], "the owner learns the transport died as soon as the port closes");
    client.close();
  }
  {
    const { port1, port2 } = new MessageChannel();
    const client = createRpcClient(port2, { onClosed: () => closures.push("local") });
    client.close();
    port1.close();
    await nextTurn();
    assert.deepEqual(closures, ["remote"], "closing the client on purpose is not reported as a lost connection");
  }
});

test("the server counts each request as in flight until its response is sent", async (t) => {
  const { client, server } = createPair(t);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  server.handle({
    "host.ping": () => held,
    "sessions.list": () => {
      throw new Error("listing failed");
    },
  });
  assert.equal(server.inFlightRequests(), 0);

  const pending = [client.call("host.ping"), client.call("host.ping")];
  while (server.inFlightRequests() < 2) await nextTurn();
  assert.equal(server.inFlightRequests(), 2);

  release({ ok: true, ts: 1 });
  await Promise.all(pending);
  await assert.rejects(client.call("sessions.list"), /listing failed/);
  assert.equal(server.inFlightRequests(), 0, "answered and failed requests both stop counting");
});

test("postMessage failure rejects and removes a pending call", async () => {
  const listeners = new Set();
  const port = {
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    start() {},
    postMessage() {
      throw new Error("closed transport");
    },
    close() {},
  };
  const client = createRpcClient(port);

  await assert.rejects(client.call("host.ping"), /closed transport/);
  client.close();
  assert.equal(listeners.size, 0);
});

test("subscribe throws without retaining a local subscription when postMessage fails", () => {
  const listeners = new Set();
  const port = {
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    start() {},
    postMessage() {
      throw new Error("closed subscription transport");
    },
    close() {},
  };
  const client = createRpcClient(port);
  let calls = 0;

  assert.throws(() => client.subscribe("files.changed", "/project", () => calls++), /closed subscription transport/);
  for (const listener of listeners) {
    listener({
      data: { kind: "event", topic: "files.changed", key: "/project", data: { event: "change", path: "a" } },
    });
  }
  assert.equal(calls, 0);
  client.close();
});

test("duplicate attachment responds once and repeated detach releases the transport", async () => {
  const listeners = new Map();
  let closeCalls = 0;
  const responses = [];
  const port = {
    on(type, listener) {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    postMessage(message) {
      responses.push(message);
    },
    start() {},
    close() {
      closeCalls += 1;
    },
  };
  const server = createRpcServer();

  server.attachPort(port);
  server.attachPort(port);
  server.handle({ "host.ping": () => ({ ok: true, ts: 42 }) });
  for (const listener of [...(listeners.get("message") ?? [])]) {
    listener({ data: { kind: "request", id: "duplicate-attach", method: "host.ping" } });
  }
  await nextTurn();
  assert.deepEqual(responses, [{ kind: "response", id: "duplicate-attach", ok: true, result: { ok: true, ts: 42 } }]);

  server.detachPort(port);
  server.detachPort(port);
  assert.equal(listeners.get("message").size, 0);
  assert.equal(listeners.get("close").size, 0);
  assert.equal(closeCalls, 1);
});

test("port leases replace, release explicitly, and finalize on detach", async () => {
  const { port1, port2 } = new MessageChannel();
  const server = createRpcServer();
  const client = createRpcClient(port2);
  const released = [];
  let calls = 0;
  server.handle({
    "host.ping": (_params, context) => {
      calls += 1;
      if (calls === 3) context.releaseLease("watch:/project");
      else context.setLease("watch:/project", () => released.push(calls));
      return { ok: true, ts: calls };
    },
  });
  server.attachPort(port1);

  await client.call("host.ping");
  await client.call("host.ping");
  assert.deepEqual(released, [2], "replacing a lease releases its prior resource");
  await client.call("host.ping");
  assert.deepEqual(released, [2, 3], "explicit release finalizes the current resource");
  await client.call("host.ping");
  server.detachPort(port1);
  assert.deepEqual(released, [2, 3, 4], "detach finalizes all remaining port resources");
  client.close();
});

test("remote port close finalizes owned resources", async () => {
  const { port1, port2 } = new MessageChannel();
  const server = createRpcServer();
  const client = createRpcClient(port2);
  let releases = 0;
  server.handle({
    "host.ping": (_params, context) => {
      context.setLease("watch:/project", () => releases++);
      return { ok: true, ts: 1 };
    },
  });
  server.attachPort(port1);
  await client.call("host.ping");

  client.close();
  for (let attempt = 0; attempt < 10 && releases === 0; attempt += 1) await nextTurn();
  assert.equal(releases, 1);
});

test("server detaches a port when response fallback or event delivery also fails", async () => {
  const listeners = new Map();
  let closeCalls = 0;
  const port = {
    on(type, listener) {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    postMessage() {
      throw new Error("closed transport");
    },
    start() {},
    close() {
      closeCalls += 1;
    },
  };
  const responseServer = createRpcServer();
  responseServer.handle({ "host.ping": () => ({ ok: true }) });
  responseServer.attachPort(port);
  listeners.get("message").values().next().value({ kind: "request", id: "r1", method: "host.ping" });
  await nextTurn();

  assert.equal(closeCalls, 1);
  assert.equal(listeners.get("message").size, 0);
  assert.equal(listeners.get("close").size, 0);

  const eventListeners = new Map();
  let eventCloseCalls = 0;
  const eventPort = {
    on(type, listener) {
      const entries = eventListeners.get(type) ?? new Set();
      entries.add(listener);
      eventListeners.set(type, entries);
    },
    off(type, listener) {
      eventListeners.get(type)?.delete(listener);
    },
    postMessage() {
      throw new Error("uncloneable event");
    },
    start() {},
    close() {
      eventCloseCalls += 1;
    },
  };
  const eventServer = createRpcServer();
  eventServer.attachPort(eventPort);
  eventListeners
    .get("message")
    .values()
    .next()
    .value({ kind: "subscribe", id: "s1", topic: "files.changed", key: "/project" });
  eventServer.emit("files.changed", "/project", { event: "change", path: "/project/a" });

  assert.equal(eventCloseCalls, 1);
  assert.equal(eventListeners.get("message").size, 0);
  assert.equal(eventListeners.get("close").size, 0);
});

test("malformed renderer request method objects are ignored without crashing or disrupting later calls", async () => {
  const { port1, port2 } = new MessageChannel();
  const server = createRpcServer();
  server.handle({ "automation.listTasks": () => ({ tasks: [] }) });
  server.attachPort(port2, "renderer");
  const client = createRpcClient(port1);
  try {
    assert.deepEqual(await client.call("automation.listTasks"), { tasks: [] });
    port1.postMessage({ kind: "request", id: "malformed", method: { toString: null } });
    port1.postMessage({ kind: "request", id: { toString: null }, method: "automation.enableTask" });
    assert.deepEqual(await client.call("automation.listTasks"), { tasks: [] });
  } finally {
    client.close();
    port2.close();
  }
});
