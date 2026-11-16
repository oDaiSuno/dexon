import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import path from "node:path";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";
import { RpcError } from "../../../contract/types.ts";
import { createRpcServer } from "../../../contract/rpc.ts";
import { realRendererGraphOptions } from "../../components/renderer-real-graph.mjs";
import { setupSessionHookEnvironment, createSessionDetail } from "./session-hook-harness.mjs";

async function fixture(t) {
  const env = setupSessionHookEnvironment();
  const root = path.resolve(import.meta.dirname, "../../../..");
  const api = await importTestBundle(`models-explicit-environment-${t.name}`, {
    ...realRendererGraphOptions(root),
    stdin: {
      contents:
        'export { useAgentSession } from "./src/renderer/hooks/useAgentSession.ts"; export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts"; export { workspaceStore } from "./src/renderer/lib/workspace-store.ts"; export { resetRpc } from "./src/renderer/lib/api-client.ts";',
      resolveDir: root,
      sourcefile: "models-environment-entry.ts",
      loader: "ts",
    },
  });
  let renderer;
  const ports = [];
  const commands = [];
  const missingOwners = new Set();
  const requests = [];
  const pending = new Set();
  const detail = createSessionDetail("same-id", { cwd: "/same-path" });
  const target = globalThis.window;
  target.piBridge = {
    getUiState: async () => ({}),
    setUiState: async () => {},
    listEnvironments: async () => ({
      revision: 1,
      policy: { detachedDaemon: true, autoReconnect: true },
      environments: ["remote-a", "remote-b"].map((id) => ({
        id,
        label: id,
        enabled: true,
        target: { kind: "websocket", url: `ws://${id}` },
        status: { phase: "connected", generation: 1, since: 0 },
        descriptor: null,
      })),
    }),
    onEnvironmentsChanged: () => () => {},
  };
  api.environmentRegistry.initialize();
  await api.workspaceStore.initialize(target.piBridge);
  for (const id of ["remote-a", "remote-b"]) {
    const server = createRpcServer();
    server.handle({
      "models.list": ({ cwd }) => {
        requests.push({ id, cwd });
        if (pending.has(id)) return new Promise(() => {});
        return { models: [{ provider: "p", id, name: id }], catalog: {}, nameMap: {}, defaultModel: null };
      },
      "sessions.get": () => detail,
      "agent.state": () => ({ running: false, state: {} }),
      "agent.command": ({ sessionId, command }) => {
        if (missingOwners.has(id) && command.type === "prompt")
          throw new RpcError({ code: "MISSING_SESSION_CWD", message: "folder deleted" });
        commands.push({ id, sessionId, command });
        return {};
      },
    });
    const { port1, port2 } = new MessageChannel();
    server.attachPort(port1);
    api.environmentRegistry.getConnection(id).replacePort(port2, 1);
    api.environmentRegistry.registerSession(id, "same-id");
    ports.push({ id, server, port1 });
  }
  let options;
  let state;
  let key = 0;
  function Probe() {
    state = api.useAgentSession(options);
    return null;
  }
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    api.resetRpc();
    for (const { id, server, port1 } of ports) {
      api.environmentRegistry.getConnection(id).close();
      server.detachPort(port1);
      port1.close();
    }
    env.restore();
  });
  return {
    api,
    pending,
    missingOwners,
    commands,
    requests,
    act,
    get state() {
      return state;
    },
    async show(id, cwd = "/same-path", remount = false) {
      options = { session: { ...detail.info, environmentId: id, cwd }, newSessionCwd: null };
      if (remount) key += 1;
      await act(async () => {
        const element = createElement(Probe, { key });
        if (renderer) renderer.update(element);
        else renderer = TestRenderer.create(element);
      });
      await act(async () => new Promise((resolve) => setImmediate(resolve)));
    },
  };
}

test("model changes target the conversation owner even when another owner of the same session id has focus", async (t) => {
  const h = await fixture(t);
  await h.act(async () => h.api.workspaceStore.openSpace({ environmentId: "remote-b", path: "/same-path" }));
  await h.show("remote-a");
  await h.act(() => h.state.handleModelChange("p", "chosen"));
  assert.deepEqual(h.commands, [
    { id: "remote-a", sessionId: "same-id", command: { type: "set_model", provider: "p", modelId: "chosen" } },
  ]);
});

test("catalogs are never borrowed across environment or cwd and returning to a location seeds its own cache", async (t) => {
  const h = await fixture(t);
  await h.show("remote-a");
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
  h.pending.add("remote-a");
  h.pending.add("remote-b");
  await h.show("remote-b");
  assert.deepEqual(h.state.modelList, []);
  await h.show("remote-a");
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
  assert.equal(h.state.modelLoading, true);
  await h.show("remote-a", "/different-path");
  assert.deepEqual(h.state.modelList, []);
  await h.show("remote-a", "/same-path", true);
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["remote-a"],
  );
  assert.deepEqual(
    h.requests.map(({ id, cwd }) => `${id}:${cwd}`),
    [
      "remote-a:/same-path",
      "remote-b:/same-path",
      "remote-a:/same-path",
      "remote-a:/different-path",
      "remote-a:/same-path",
    ],
  );
  h.api.resetRpc();
  await h.show("remote-a", "/same-path", true);
  assert.deepEqual(h.state.modelList, []);
});

test("a missing-folder rejection is scoped to its environment even when session ids and cwd match", async (t) => {
  const h = await fixture(t);
  await h.show("remote-a");
  h.missingOwners.add("remote-a");
  await h.act(async () => {
    await assert.rejects(h.state.handleSend("first"));
  });
  assert.equal(h.state.sessionFolderMissing, true);
  await h.show("remote-b");
  assert.equal(h.state.sessionFolderMissing, false);
});
