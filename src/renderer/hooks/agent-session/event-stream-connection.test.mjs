import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "../../components/renderer-real-graph.mjs";
import {
  createSessionDetail,
  createSessionHookHarness,
  createSessionTestHost,
  setupSessionHookEnvironment,
} from "./session-hook-harness.mjs";
import { installPrimaryHost } from "./primary-host-test-fixture.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
const loadClient = (name) =>
  importTestBundle(name, {
    ...realRendererGraphOptions(root),
    stdin: {
      contents: [
        'export * from "./src/renderer/lib/api-client.ts";',
        'export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";',
      ].join("\n"),
      resolveDir: root,
      sourcefile: "primary-stream-reconnection.ts",
      loader: "ts",
    },
  });
const api = await loadClient("primary-stream-reconnection");

async function drain() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("a primary generation replacement restores every logical stream and signals one gap before new events", async (t) => {
  const env = setupSessionHookEnvironment();
  const host = installPrimaryHost(globalThis.window);
  const received = [];
  const gaps = [];
  const off = [];
  t.after(() => {
    for (const unsubscribe of off) unsubscribe();
    api.resetRpc();
    host.close();
    env.restore();
  });
  const primary = api.getEnvironmentApiClient("primary");
  off.push(
    await primary.subscribeAgentEvents(
      "s-1",
      (event) => received.push(event.type),
      () => gaps.push("agent"),
    ),
  );
  off.push(
    await primary.subscribeSessionsChanged(
      (event) => received.push(event.sessionId),
      () => gaps.push("sessions"),
    ),
  );
  off.push(
    await primary.subscribeRunning(
      (event) => received.push(event.sessionIds),
      () => gaps.push("running"),
    ),
  );
  await primary.call("host.ping");
  assert.deepEqual(gaps, []);
  host.emit("agent.events", "s-1", { type: "agent_start" });
  await primary.call("host.ping");
  assert.deepEqual(received, ["agent_start"]);

  host.publish(1, false);
  host.publish(2);
  await drain();
  await primary.call("host.ping");
  assert.deepEqual(gaps, ["agent", "sessions", "running"]);
  assert.deepEqual(
    host.subscriptions
      .filter((entry) => entry.generation === 2)
      .map((entry) => entry.topic)
      .sort(),
    ["agent.events", "agent.running", "sessions.changed"],
  );
  host.emit("agent.events", "s-1", { type: "agent_end" });
  host.emit("sessions.changed", "s-1", { cwd: "/work/app", sessionId: "s-1" });
  host.emit("agent.running", "*", { sessionIds: ["s-1"] });
  await primary.call("host.ping");
  assert.deepEqual(received, ["agent_start", "agent_end", "s-1", ["s-1"]]);
  host.publish(2);
  await drain();
  assert.deepEqual(gaps, ["agent", "sessions", "running"], "repeated ready snapshots must not create another gap");
});

test("live appends do not reload a streaming primary session but mutations and gaps do", async (t) => {
  const detail = createSessionDetail("s-1");
  const h = await createSessionHookHarness(t, {
    bundleName: "primary-live-append",
    host: createSessionTestHost(),
  });
  const host = installPrimaryHost(globalThis.window, {
    "sessions.get": () => detail,
    "agent.state": () => ({ running: true, state: { isStreaming: true } }),
    "models.list": () => ({ models: [], nameMap: {}, thinkingLevels: {}, thinkingLevelMaps: {}, defaultModel: null }),
    "agent.command": () => ({}),
  });
  t.after(() => host.close());
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  const loads = () => host.requests.filter((entry) => entry.method === "sessions.get").length;
  await h.act(() => host.emit("agent.events", "s-1", { type: "agent_start" }));
  await h.flush();
  assert.equal(h.state.agentRunning, true);
  const beforeEcho = loads();
  await h.act(() => host.emit("sessions.changed", "s-1", { cwd: "/work/app", sessionId: "s-1", cause: "live-append" }));
  await h.flush();
  assert.equal(loads(), beforeEcho, "an append already delivered over the live event stream must not reload history");
  await h.act(() => host.emit("sessions.changed", "s-1", { cwd: "/work/app", sessionId: "s-1", cause: "mutation" }));
  await h.flush();
  assert.equal(loads(), beforeEcho + 1, "an explicit session mutation still refreshes history");
  await h.act(() => {
    host.publish(1, false);
    host.publish(2);
  });
  await h.flush();
  await h.flush();
  assert.ok(host.requests.some((entry) => entry.generation === 2 && entry.method === "sessions.get"));
  assert.equal(h.state.agentRunning, true, "reconciliation keeps a genuinely running reply alive");
});

test("an idle primary session reloads live appends while its event stream remains attached", async (t) => {
  let detail = createSessionDetail("s-1");
  const h = await createSessionHookHarness(t, {
    bundleName: "primary-idle-live-append",
    host: createSessionTestHost(),
  });
  const host = installPrimaryHost(globalThis.window, {
    "sessions.get": () => detail,
    "agent.state": () => ({ running: false }),
    "models.list": () => ({ models: [], nameMap: {}, thinkingLevels: {}, thinkingLevelMaps: {}, defaultModel: null }),
    "agent.command": () => ({}),
  });
  t.after(() => host.close());
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.agentRunning, false);
  assert.ok(host.subscriptions.some((entry) => entry.topic === "agent.events" && entry.key === "s-1"));
  const beforeAppend = host.requests.filter((entry) => entry.method === "sessions.get").length;
  detail = createSessionDetail("s-1", {
    historyRevision: "idle-append-revision",
    messages: [
      { role: "user", content: "fixture", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "updated outside the live turn" }],
        timestamp: 2,
      },
    ],
  });
  await h.act(() => host.emit("sessions.changed", "s-1", { cwd: "/work/app", sessionId: "s-1", cause: "live-append" }));
  await h.flush();
  assert.equal(
    host.requests.filter((entry) => entry.method === "sessions.get").length,
    beforeAppend + 1,
    "an idle session must reload an append that was not delivered by an active turn",
  );
  assert.equal(h.state.messages.at(-1).content[0].text, "updated outside the live turn");
});

test("primary boot waits through an initial connecting snapshot without replacing the pending connection", async (t) => {
  const env = setupSessionHookEnvironment();
  const host = installPrimaryHost(globalThis.window);
  host.publish(0, false);
  const boot = await loadClient("primary-boot-wait");
  t.after(() => {
    boot.resetRpc();
    host.close();
    env.restore();
  });
  let settled = false;
  const connection = boot.ensureRpc().then(
    (client) => {
      settled = true;
      return client;
    },
    (error) => {
      settled = true;
      return error;
    },
  );
  await drain();
  assert.equal(settled, false, "starting is not a terminal boot failure");
  host.publish(1);
  const client = await connection;
  assert.equal(typeof client.call, "function");
  assert.equal((await client.call("host.ping")).ok, true);
});
