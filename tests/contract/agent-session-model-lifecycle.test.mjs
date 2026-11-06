import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";
import { createRpcServer } from "../../src/contract/rpc.ts";
import { realRendererGraphOptions } from "../../src/renderer/components/renderer-real-graph.mjs";
import {
  createSessionDetail,
  setupSessionHookEnvironment,
} from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const api = await importTestBundle("session-model-lifecycle", {
  ...realRendererGraphOptions(ROOT),
  stdin: {
    contents:
      'export { useAgentSession } from "./src/renderer/hooks/useAgentSession.ts";' +
      'export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";' +
      'export { workspaceStore } from "./src/renderer/lib/workspace-store.ts";' +
      'export { resetRpc } from "./src/renderer/lib/api-client.ts";',
    resolveDir: ROOT,
    sourcefile: "session-model-lifecycle-entry.ts",
    loader: "ts",
  },
});
const connected = (generation = 1) => ({ phase: "connected", generation, since: 0 });
const offline = { phase: "offline", lastFailure: null };
const catalog = (id) => ({
  models: [{ provider: "fixture", id, name: id }],
  nameMap: {},
  catalog: { source: "host", refreshed: true, aborted: false, warnings: [] },
  defaultModel: { provider: "fixture", modelId: id },
});
const deferred = () => Promise.withResolvers();

async function fixture(t) {
  const env = setupSessionHookEnvironment();
  const target = globalThis.window;
  const messages = new Set();
  const add = target.addEventListener;
  const remove = target.removeEventListener;
  target.addEventListener = (type, listener) => (type === "message" ? messages.add(listener) : add(type, listener));
  target.removeEventListener = (type, listener) =>
    type === "message" ? messages.delete(listener) : remove(type, listener);
  const errors = t.mock.method(console, "error");
  let renderer;
  let onSnapshot;
  let state;
  let options = { session: null, newSessionCwd: "/srv/shared" };
  const ports = [];
  const requests = [];
  const handlers = new Map();
  let snapshot = {
    revision: 1,
    policy: { detachedDaemon: true, autoReconnect: true },
    environments: ["remote-a", "remote-b"].map((id) => ({
      id,
      label: id,
      enabled: true,
      target: { kind: "websocket", url: `ws://${id}/rpc` },
      status: connected(),
      descriptor: null,
    })),
  };
  const servers = new Map(["primary", "remote-a", "remote-b"].map((id) => [id, createRpcServer()]));
  const detail = createSessionDetail("existing", { cwd: "/srv/shared" });
  for (const [id, server] of servers) {
    const defaults = {
      "host.ping": () => ({ ok: true }),
      "models.list": () => catalog(id),
      "models.refresh": () => catalog(`${id}-refreshed`),
      "models.refreshCancel": () => ({ ok: true }),
      "sessions.get": () => detail,
    };
    server.handle(
      Object.fromEntries(
        Object.entries(defaults).map(([method, handler]) => [
          method,
          (params) => {
            requests.push({ environmentId: id, method, params });
            return (handlers.get(`${id}:${method}`) ?? handler)(params);
          },
        ]),
      ),
    );
  }
  function deliver(id) {
    const { port1, port2 } = new MessageChannel();
    servers.get(id).attachPort(port1);
    ports.push({ id, port1, port2 });
    const status = snapshot.environments.find((view) => view.id === id)?.status;
    globalThis.queueMicrotask(() => {
      for (const receive of messages)
        receive({
          source: target,
          data: { channel: "dexon-host-port", environmentId: id, generation: status?.generation },
          ports: [port2],
        });
    });
  }
  target.piBridge = {
    getHostStatus: async () => "ready",
    requestHostPort: () => deliver("primary"),
    requestEnvironmentPort: deliver,
    getUiState: async () => ({}),
    setUiState: async () => {},
    listEnvironments: async () => snapshot,
    onEnvironmentsChanged(listener) {
      onSnapshot = listener;
      return () => {
        onSnapshot = null;
      };
    },
  };
  t.after(async () => {
    try {
      if (renderer) await act(async () => renderer.unmount());
      api?.resetRpc();
      for (const id of ["remote-a", "remote-b"]) api?.environmentRegistry.getConnection(id).close();
      for (const { id, port1, port2 } of ports) {
        servers.get(id).detachPort(port1);
        port1.close();
        port2.close();
      }
    } finally {
      errors.mock.restore();
      env.restore();
    }
  });
  api.environmentRegistry.initialize();
  await api.workspaceStore.initialize(target.piBridge);
  function Probe() {
    state = api.useAgentSession(options);
    return null;
  }
  const flush = async () => {
    await act(async () => new Promise((resolve) => setImmediate(resolve)));
  };
  return {
    requests,
    detail,
    get state() {
      return state;
    },
    handle(id, method, handler) {
      handlers.set(`${id}:${method}`, handler);
    },
    async mount(next = options) {
      options = next;
      await act(async () => {
        renderer = TestRenderer.create(createElement(Probe));
      });
      await flush();
    },
    async update(next) {
      options = next;
      await act(async () => renderer.update(createElement(Probe)));
      await flush();
    },
    async focus(id) {
      await act(async () => api.workspaceStore.openSpace({ environmentId: id, path: "/srv/shared" }));
    },
    async status(status, id = "remote-a") {
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        environments: snapshot.environments.map((view) => (view.id === id ? { ...view, status } : view)),
      };
      await act(async () => onSnapshot(snapshot));
      await flush();
    },
    async closePort(id = "remote-a") {
      await act(async () => {
        const { port1, port2 } = ports.findLast((entry) => entry.id === id);
        const closed = new Promise((resolve) => port2.once("close", resolve));
        port1.close();
        await closed;
      });
      await flush();
    },
    errors() {
      return errors.mock.calls.filter(({ arguments: args }) => args[0] === "Failed to load model directory:");
    },
    flush,
    act,
  };
}

test("a new conversation keeps its captured model owner when focus moves before a reload", async (t) => {
  const h = await fixture(t);
  await h.focus("remote-a");
  await h.mount();
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
  await h.focus("remote-b");
  await h.update({ session: null, newSessionCwd: "/srv/shared", modelsRefreshKey: 1 });
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
  await h.act(() => h.state.refreshModels());
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a-refreshed"],
  );
  assert.equal(
    h.requests.some((request) => request.environmentId === "remote-b"),
    false,
  );
});

test("a closed model-list transport cancels work without a renderer error or backend warning", async (t) => {
  const h = await fixture(t);
  const pending = deferred();
  h.handle("remote-a", "models.list", () => pending.promise);
  await h.focus("remote-a");
  await h.mount();
  assert.equal(
    h.requests.some((request) => request.method === "models.list"),
    true,
  );
  await h.closePort();
  assert.equal(h.errors().length, 0);
  assert.deepEqual(h.state.notices, []);
  assert.deepEqual(h.state.modelList, []);
});

test("a closed refresh transport keeps cached models and releases the picker without a failure notice", async (t) => {
  const h = await fixture(t);
  const pending = deferred();
  h.handle("remote-a", "models.refresh", () => pending.promise);
  await h.focus("remote-a");
  await h.mount();
  let refresh;
  await h.act(async () => {
    refresh = h.state.refreshModels();
  });
  await h.flush();
  assert.equal(h.state.modelRefreshing, true);
  await h.closePort();
  await refresh;
  assert.deepEqual(h.state.notices, []);
  assert.equal(h.state.modelRefreshing, false);
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
  assert.equal(h.errors().length, 0);
});

test("an unavailable owner waits quietly and reloads its catalog on each connected generation", async (t) => {
  const h = await fixture(t);
  await h.status(offline);
  await h.focus("remote-a");
  await h.mount();
  assert.equal(h.errors().length, 0);
  assert.deepEqual(h.state.notices, []);
  await h.act(() => h.state.refreshModels());
  assert.deepEqual(h.state.notices, []);
  assert.deepEqual(h.requests, []);
  await h.status(connected());
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
  await h.status(offline);
  await h.act(() => h.state.refreshModels());
  assert.equal(h.state.modelRefreshing, false);
  h.handle("remote-a", "models.list", () => catalog("generation-two"));
  await h.status(connected(2));
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["generation-two"],
  );
  assert.equal(h.requests.filter((request) => request.method === "models.list").length, 2);
  assert.deepEqual(h.state.notices, []);
  assert.equal(h.errors().length, 0);
});

test("a retired catalog read cannot report a failure after a newer refresh succeeds", async (t) => {
  const h = await fixture(t);
  const pending = deferred();
  h.handle("remote-a", "models.list", () => pending.promise);
  await h.focus("remote-a");
  await h.mount();
  await h.act(() => h.state.refreshModels());
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a-refreshed"],
  );
  await h.act(async () => pending.reject(new Error("retired catalog failed")));
  await h.flush();
  assert.equal(h.errors().length, 0);
  assert.deepEqual(h.state.notices, []);
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a-refreshed"],
  );
});

test("an existing conversation reads its own catalog even when another environment has focus", async (t) => {
  const h = await fixture(t);
  await h.focus("remote-b");
  await h.mount({ session: { ...h.detail.info, environmentId: "remote-a" }, newSessionCwd: null });
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
  assert.equal(
    h.requests.some((request) => request.environmentId === "remote-b" && request.method === "models.list"),
    false,
  );
});

test("canceling a refresh targets the captured owner and its late result cannot change the picker", async (t) => {
  const h = await fixture(t);
  const pending = deferred();
  h.handle("remote-a", "models.refresh", () => pending.promise);
  await h.focus("remote-a");
  await h.mount();
  let refresh;
  await h.act(async () => {
    refresh = h.state.refreshModels();
  });
  await h.flush();
  const request = h.requests.find((entry) => entry.method === "models.refresh");
  assert.ok(request);
  await h.focus("remote-b");
  await h.act(async () => h.state.cancelModelRefresh());
  await h.flush();
  assert.deepEqual(
    h.requests.filter((entry) => entry.method === "models.refreshCancel"),
    [
      {
        environmentId: "remote-a",
        method: "models.refreshCancel",
        params: { requestId: request.params.requestId },
      },
    ],
  );
  assert.equal(h.state.modelRefreshing, false);
  await h.act(async () => {
    pending.resolve(catalog("retired-refresh"));
    await refresh;
  });
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
  assert.deepEqual(h.state.notices, []);
  assert.equal(h.errors().length, 0);
});

test("disconnecting a refresh releases the picker and an old generation cannot replace a reconnected catalog", async (t) => {
  const h = await fixture(t);
  const pending = deferred();
  h.handle("remote-a", "models.refresh", () => pending.promise);
  await h.focus("remote-a");
  await h.mount();
  let refresh;
  await h.act(async () => {
    refresh = h.state.refreshModels();
  });
  await h.flush();
  assert.equal(h.state.modelRefreshing, true);
  await h.status(offline);
  assert.equal(h.state.modelRefreshing, false);
  await refresh;
  h.handle("remote-a", "models.list", () => catalog("reconnected"));
  await h.status(connected(2));
  await h.act(async () => pending.resolve(catalog("old-generation")));
  await h.flush();
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["reconnected"],
  );
  assert.deepEqual(
    h.requests.filter((request) => request.method === "models.refreshCancel"),
    [],
  );
  assert.deepEqual(h.state.notices, []);
  assert.equal(h.errors().length, 0);
});

test("online backend failures remain visible even when their message resembles a closed transport", async (t) => {
  const h = await fixture(t);
  await h.focus("remote-a");
  await h.mount();
  h.handle("remote-a", "models.list", () => {
    throw new Error("RPC port closed");
  });
  await h.update({ session: null, newSessionCwd: "/srv/shared", modelsRefreshKey: 1 });
  assert.equal(h.errors().length, 1);
  assert.equal(h.errors()[0].arguments[1].code, "INTERNAL");
  assert.equal(
    h.state.notices.some(
      (notice) => notice.type === "warning" && notice.message.includes("Cached models remain available"),
    ),
    true,
  );
  h.handle("remote-a", "models.refresh", () => {
    throw new Error("online backend failed");
  });
  await h.act(() => h.state.refreshModels());
  assert.equal(
    h.state.notices.some((notice) => notice.type === "error" && notice.message.includes("refresh")),
    true,
  );
  assert.equal(h.state.modelRefreshing, false);
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
});
