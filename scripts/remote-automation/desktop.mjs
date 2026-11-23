import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { MessageChannel } from "node:worker_threads";
import path from "node:path";
import { importTestBundle } from "../test-bundle.mjs";
import { bridgeRendererPort } from "../../src/main/environments/renderer-port-bridge.ts";
import { createRpcClient } from "../../src/contract/rpc.ts";
import { electronPort } from "./ports.mjs";
import { root, until } from "./fixture.mjs";

const main = await importTestBundle("remote-automation-main", {
  packages: "external",
  stdin: {
    contents:
      'export { createAutomationAuthority } from "./src/main/automation-authority"; export { EnvironmentManager } from "./src/main/environments/environment-manager";',
    resolveDir: root,
    loader: "ts",
  },
  plugins: [
    {
      name: "node-message-channel",
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: path.join(import.meta.dirname, "ports.mjs") }));
      },
    },
  ],
});
const absentPrimary = {
  isServing: () => false,
  getStatus: () => "stopped",
  getPiVersion: () => "1.4.0",
  getGeneration: () => 0,
};
const noSecrets = {
  setAutomationSecret() {
    throw new Error("Primary is not configured");
  },
  deleteAutomationSecret() {
    throw new Error("Primary is not configured");
  },
  listAutomationSecretNames() {
    throw new Error("Primary is not configured");
  },
};
export async function desktop(fixture, options = {}) {
  const dialogs = [];
  const audit = [];
  const manager = new main.EnvironmentManager({
    userDataDir: mkdtempSync(path.join(fixture.directory, "desktop-main-")),
    hostManager: options.primary?.host ?? absentPrimary,
  });
  await manager.setPolicy({ detachedDaemon: true, autoReconnect: false });
  const remote = await manager.addEnvironment({
    label: "Remote A",
    target: { kind: "websocket", url: fixture.endpoint.wsUrl },
    authToken: fixture.launch.authToken,
    enabled: false,
  });
  const authority = main.createAutomationAuthority({
    targets: {
      bindAutomationTarget(environmentId) {
        const target = manager.bindAutomationTarget(environmentId);
        return {
          ...target,
          call: (method, ...args) => {
            audit.push({ environmentId, method, atMs: Date.now() });
            return target.call(method, ...args).then((result) => {
              fixture.responses.push({ kind: "authority-result", method, result });
              return result;
            });
          },
        };
      },
    },
    primarySecrets: options.primary?.vault ?? noSecrets,
    show: async (dialog) => {
      dialogs.push(dialog);
      return options.show ? options.show(dialog) : { response: 1 };
    },
  });
  const connect = async () => {
    const view = await manager.connectEnvironment(remote.id);
    assert.equal(view.status.phase, "connected");
    assert.equal(view.runtime.updatePending, false);
    return view;
  };
  try {
    await connect();
    return {
      manager,
      authority,
      dialogs,
      audit,
      environmentId: remote.id,
      connect,
      disconnect: () => manager.disconnectEnvironment(remote.id),
      dispose: () => manager.shutdown(),
      async enable(rpc, spec, environmentId = remote.id) {
        const saved = await rpc.call("automation.saveTask", { spec });
        const result = await authority({
          type: "enable-task",
          environmentId,
          taskId: saved.task.id,
          revision: saved.revision,
          planHash: saved.planHash,
        });
        assert.equal(result.outcome, "enabled");
        return saved;
      },
    };
  } catch (error) {
    await manager.shutdown();
    throw error;
  }
}
export function rendererBridge(connection, responses) {
  const { port1, port2 } = new MessageChannel();
  const closeBridge = bridgeRendererPort(electronPort(port2), connection.channel);
  const received = [];
  port1.on("message", (message) => {
    received.push(message);
    responses.push(message);
  });
  const rpc = createRpcClient(port1, { callTimeoutMs: 10000 });
  return {
    port: port1,
    rpc,
    received,
    close() {
      rpc.close();
      closeBridge();
    },
  };
}
export async function rejectRenderer(renderer, methods, params = {}) {
  const events = [];
  const unsubscribe = renderer.rpc.subscribe("automation.changed", "*", (event) => events.push(event));
  const refusals = [];
  try {
    for (const method of methods) {
      const id = `compromised-${method}`;
      renderer.port.postMessage({ kind: "request", id, method, params: params[method] ?? {} });
      const reply = await until(() => renderer.received.find((message) => message.id === id), `${id} refusal`);
      assert.equal(reply.kind, "response");
      assert.equal(reply.ok, false);
      assert.equal(reply.error.code, "FORBIDDEN");
      assert.equal(reply.id, id);
      refusals.push({ id, code: reply.error.code });
    }
    assert.ok(Array.isArray((await renderer.rpc.call("automation.listTasks")).tasks));
    const marker = {
      schema: "dexon.automation/v1",
      id: `renderer-alive-${Date.now()}`,
      name: "Channel still alive",
      cwd: process.cwd(),
      triggers: [{ id: "manual", kind: "manual" }],
      steps: [{ id: "wait", kind: "wait", wait: { kind: "duration", duration: "1s" } }],
    };
    await renderer.rpc.call("automation.saveTask", { spec: marker });
    await until(
      () => events.some((event) => event.taskIds.includes(marker.id)),
      "same renderer subscription after refusal",
    );
    await renderer.rpc.call("automation.deleteTask", { taskId: marker.id });
    return { refusals, listTasksAfterRefusal: true, samePortChangedEvent: true, channelAlive: true };
  } finally {
    unsubscribe();
  }
}
export async function managerRenderer(manager, environmentId, responses) {
  const sender = new EventEmitter();
  let port;
  sender.isDestroyed = () => false;
  sender.postMessage = (_name, _data, ports) => {
    [port] = ports;
  };
  manager.attachRendererEnvironmentPort(environmentId, sender);
  const { port1, port2 } = new MessageChannel();
  port.on("message", ({ data }) => port2.postMessage(data));
  port2.on("message", (data) => port.postMessage(data));
  port.start();
  const received = [];
  port1.on("message", (message) => {
    received.push(message);
    responses.push(message);
  });
  const rpc = createRpcClient(port1, { callTimeoutMs: 10000 });
  return {
    rpc,
    port: port1,
    received,
    close() {
      sender.emit("destroyed");
      rpc.close();
      port2.close();
      port.close();
    },
  };
}
