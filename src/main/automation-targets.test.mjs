import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
import { createRpcClient, createRpcServer } from "../contract/rpc.ts";
import { RpcError } from "../contract/types.ts";
import { startDaemonServer } from "../agent-host/daemon-server.ts";
import { buildEnvironmentDescriptor } from "../agent-host/environment-identity.ts";

async function platform(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "dexon-automation-targets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return importTestBundle("automation-targets", {
    stdin: {
      contents:
        'export { HostManager } from "./src/main/host-manager"; export { EnvironmentManager } from "./src/main/environments/environment-manager"; export { createAutomationAuthority } from "./src/main/automation-authority"; export { children } from "electron"; export { flushMainLog } from "./src/main/logger";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    plugins: [
      {
        name: "electron-platform-boundary",
        setup(build) {
          build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "platform" }));
          build.onLoad({ filter: /./, namespace: "platform" }, () => ({
            contents: `
            import { EventEmitter } from "node:events";
            import { MessageChannel } from "node:worker_threads";
            export const children = [];
            export const app = { getPath: () => ${JSON.stringify(directory)}, getVersion: () => "test" };
            class ElectronPort extends EventEmitter {
              constructor(port) {
                super(); this.port = port;
                port.on("message", data => this.emit("message", { data }));
                port.on("close", () => this.emit("close"));
              }
              postMessage(message) { this.port.postMessage(message); }
              start() { this.port.start(); }
              close() { this.port.close(); }
            }
            export class MessageChannelMain {
              constructor() {
                const channel = new MessageChannel();
                this.port1 = new ElectronPort(channel.port1);
                this.port2 = new ElectronPort(channel.port2);
              }
            }
            export const utilityProcess = { fork() {
              const child = new EventEmitter();
              child.postMessage = (message, ports) => {
                child.emit("posted", message, ports);
                if (message.type === "shutdown") queueMicrotask(() => child.emit("exit", 0));
              };
              child.kill = () => child.emit("exit", 0);
              children.push(child);
              return child;
            } };
          `,
            loader: "js",
          }));
        },
      },
    ],
  });
}

function pause() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function revision() {
  const planHash = "a".repeat(64);
  return {
    taskId: "report",
    revision: 1,
    planHash,
    source: { name: "Report" },
    requiredGrant: {
      planHash,
      cwd: "/srv/work",
      httpOrigins: [],
      scripts: [],
      secrets: [],
      unattendedWrites: [],
    },
  };
}
const command = (environmentId) => ({
  type: "enable-task",
  environmentId,
  taskId: "report",
  revision: 1,
  planHash: "a".repeat(64),
});

test("HostManager isolates renderer and main audiences, preserves RPC errors and invalidates consent after restart", async (t) => {
  const api = await platform(t);
  const host = new api.HostManager("fixture");
  const server = createRpcServer();
  let enables = 0;
  const audiences = [];
  const attach = () => {
    const child = api.children.at(-1);
    child.on("posted", (message, ports) => {
      if (message.type === "attach-port") {
        audiences.push(message.audience);
        server.attachPort(ports[0], message.audience);
      }
    });
    child.emit("message", {
      type: "ready",
      ts: Date.now(),
      piVersion: "test",
      capabilities: {
        browser: false,
        nativeDialogs: false,
        revealInFileManager: false,
        managedProcesses: true,
        toolchainInstall: true,
      },
    });
  };
  server.handle({
    "automation.getTask": async () => ({ task: revision() }),
    "automation.enableTask": async () => {
      enables++;
      return { task: { id: "report", enabledRevision: 1 } };
    },
    "automation.deleteSecret": async () => {
      throw new RpcError({ code: "FORBIDDEN", message: "Primary secrets belong to Main" });
    },
    "automation.listTasks": async () => ({ tasks: [] }),
  });
  host.start();
  attach();
  t.after(async () => {
    await host.stop();
    await api.flushMainLog();
  });
  assert.equal(host.generation, 1);
  assert.deepEqual(await host.gatekeeperCall("automation.listTasks"), { tasks: [] });
  await assert.rejects(
    host.gatekeeperCall("automation.deleteSecret", { name: "api" }),
    (error) => error.code === "FORBIDDEN" && error.message === "Primary secrets belong to Main",
  );
  const { port1 } = host.createRendererChannel();
  const listeners = new Map();
  const rpc = createRpcClient({
    addEventListener(type, listener) {
      const adapted = type === "message" ? (event) => listener(event) : listener;
      listeners.set(listener, adapted);
      port1.on(type, adapted);
    },
    removeEventListener(type, listener) {
      port1.removeListener(type, listeners.get(listener));
      listeners.delete(listener);
    },
    postMessage: (message) => port1.postMessage(message),
    start: () => port1.start(),
    close: () => port1.close(),
  });
  t.after(() => rpc.close());
  await assert.rejects(
    rpc.call("automation.enableTask", { taskId: "report", revision: 1, planHash: "a".repeat(64) }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.deepEqual(await rpc.call("automation.listTasks"), { tasks: [] });
  assert.ok(audiences.includes("renderer"));
  assert.ok(audiences.includes("gatekeeper"));
  const directory = await mkdtemp(path.join(tmpdir(), "dexon-primary-bind-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manager = new api.EnvironmentManager({ hostManager: host, userDataDir: directory });
  t.after(() => manager.dispose());
  const opened = pause();
  const decision = pause();
  const authority = api.createAutomationAuthority({
    targets: manager,
    primarySecrets: {},
    show: () => {
      opened.resolve();
      return decision.promise;
    },
  });
  const bound = manager.bindAutomationTarget("primary");
  const result = authority(command("primary"));
  await opened.promise;
  assert.equal(enables, 0);
  await host.stop();
  host.start();
  attach();
  assert.equal(host.generation, 2);
  assert.equal(bound.isStillCurrent(), false);
  decision.resolve({ response: 1 });
  await assert.rejects(result, (error) => error.code === "DISCONNECTED");
  assert.equal(enables, 0);
});

test("EnvironmentManager binds real remote identity and refuses stale or offline routes without primary fallback", async (t) => {
  const api = await platform(t);
  const directory = await mkdtemp(path.join(tmpdir(), "dexon-remote-bind-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = new api.HostManager("fixture");
  const descriptor = buildEnvironmentDescriptor({
    environmentId: "server-identity",
    label: "Remote",
    piVersion: "test",
    capabilities: {
      browser: false,
      nativeDialogs: false,
      revealInFileManager: false,
      managedProcesses: true,
      toolchainInstall: true,
    },
  });
  const server = createRpcServer();
  let enables = 0;
  server.handle({
    "host.ping": async () => ({ ok: true, ts: Date.now() }),
    "automation.getTask": async () => ({ task: revision() }),
    "automation.enableTask": async () => {
      enables++;
      return { task: { id: "report" } };
    },
    "automation.listSecretNames": async () => ({ names: ["remote.api"] }),
  });
  const daemon = await startDaemonServer({
    rpcServer: server,
    getDescriptor: () => descriptor,
    authToken: "b".repeat(64),
    listenPort: 0,
  });
  t.after(() => daemon.close());
  const manager = new api.EnvironmentManager({ hostManager: host, userDataDir: directory });
  t.after(async () => {
    await manager.dispose();
    await api.flushMainLog();
  });
  const added = await manager.addEnvironment({
    label: "GPU server",
    enabled: false,
    authToken: "b".repeat(64),
    target: { kind: "websocket", url: `ws://127.0.0.1:${daemon.port}/rpc` },
  });
  for (const route of [added.id, "missing", "primary"])
    assert.throws(
      () => manager.bindAutomationTarget(route),
      (error) => error.code === "DISCONNECTED",
    );
  await manager.connectEnvironment(added.id);
  const bound = manager.bindAutomationTarget(added.id);
  assert.equal(bound.environmentId, added.id);
  assert.equal(bound.serverEnvironmentId, "server-identity");
  assert.equal(bound.displayName, "GPU server");
  assert.deepEqual(await bound.call("automation.listSecretNames"), { names: ["remote.api"] });
  const opened = pause();
  const decision = pause();
  const authority = api.createAutomationAuthority({
    targets: manager,
    primarySecrets: {},
    show: () => {
      opened.resolve();
      return decision.promise;
    },
  });
  const result = authority(command(added.id));
  await opened.promise;
  await manager.disconnectEnvironment(added.id);
  await manager.connectEnvironment(added.id);
  assert.equal(bound.isStillCurrent(), false);
  decision.resolve({ response: 1 });
  await assert.rejects(result, (error) => error.code === "DISCONNECTED");
  assert.equal(enables, 0);
  await manager.disconnectEnvironment(added.id);
  for (const type of ["set-secret", "delete-secret", "list-secret-names"])
    await assert.rejects(
      authority({ type, environmentId: added.id, name: "api", value: "secret" }),
      (error) => error.code === "DISCONNECTED",
    );
});
