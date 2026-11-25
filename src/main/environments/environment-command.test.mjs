import assert from "node:assert/strict";
import test from "node:test";
import { dispatchEnvironmentCommand, parseEnvironmentCommand } from "./environment-command.ts";
const draft = { label: "GPU", target: { kind: "ssh", sshAlias: "gpu" } };
test("the single command boundary accepts every supported operation and preserves explicit removal choices", () => {
  const commands = [
    { type: "add", draft, connect: false },
    { type: "update", environmentId: "server", draft },
    { type: "test", subject: { draft } },
    { type: "test", subject: { environmentId: "server" } },
    { type: "connect", environmentId: "server" },
    { type: "disconnect", environmentId: "server" },
    { type: "trust", environmentId: "server", trust: "host-key" },
    { type: "restart-daemon", environmentId: "server" },
    { type: "remove", environmentId: "server", remoteDaemon: "stop" },
    { type: "remove", environmentId: "server", remoteDaemon: "keep" },
    { type: "set-policy", policy: { autoReconnect: false } },
    { type: "discover-ssh-hosts" },
  ];
  for (const command of commands) {
    const parsed = parseEnvironmentCommand(command);
    assert.equal(parsed.type, command.type);
    if (command.type === "remove") assert.equal(parsed.remoteDaemon, command.remoteDaemon);
  }
});
test("SSH disconnect preferences remain explicit through add, update and probe draft commands", () => {
  for (const stopOnDisconnect of [false, true]) {
    const input = { ...draft, target: { ...draft.target, stopOnDisconnect } };
    const commands = [
      { type: "add", draft: input, connect: false },
      { type: "update", environmentId: "server", draft: input },
      { type: "test", subject: { draft: input } },
    ];
    for (const command of commands) {
      const parsed = parseEnvironmentCommand(command);
      assert.equal((parsed.draft ?? parsed.subject.draft).target.stopOnDisconnect, stopOnDisconnect);
    }
  }
  assert.throws(() =>
    parseEnvironmentCommand({
      type: "add",
      connect: false,
      draft: {
        label: "WebSocket",
        target: { kind: "websocket", url: "ws://127.0.0.1:4100/rpc", stopOnDisconnect: true },
      },
    }),
  );
});

test("listing port forwards supports all environments or one environment and returns the manager result", async () => {
  const forwards = [
    {
      id: "forward-a",
      environmentId: "server-a",
      remotePort: 3000,
      localPort: 43000,
      localUrl: "http://127.0.0.1:43000",
      status: "active",
    },
    {
      id: "forward-b",
      environmentId: "server-b",
      remotePort: 4000,
      localPort: 44000,
      localUrl: "http://127.0.0.1:44000",
      status: "active",
    },
  ];
  const manager = {
    listPortForwards: (environmentId) =>
      environmentId === undefined ? forwards : forwards.filter((entry) => entry.environmentId === environmentId),
  };
  for (const [command, expected] of [
    [{ type: "list-port-forwards" }, forwards],
    [{ type: "list-port-forwards", environmentId: "server-a" }, [forwards[0]]],
    [{ type: "list-port-forwards", environmentId: "missing" }, []],
  ]) {
    assert.deepEqual(parseEnvironmentCommand(command), command);
    assert.deepEqual(await dispatchEnvironmentCommand(manager, parseEnvironmentCommand(command)), expected);
  }
});

test("listing port forwards rejects invalid environment identifiers and unrelated fields", () => {
  for (const environmentId of [null, 1, {}, [], "", " ", "bad\tserver", "bad\u007fserver", "x".repeat(1025)])
    assert.throws(() => parseEnvironmentCommand({ type: "list-port-forwards", environmentId }));
  for (const field of ["remotePort", "processId", "label", "unexpected"])
    assert.throws(() => parseEnvironmentCommand({ type: "list-port-forwards", [field]: "value" }));
});

test("opening a port forward passes validated ports and optional metadata as one manager request", async () => {
  for (const remotePort of [1, 3000, 65535]) {
    for (const metadata of [
      {},
      { processId: "process-123" },
      { label: "开发服务" },
      { processId: "p".repeat(1024), label: "L".repeat(256) },
    ]) {
      const request = { environmentId: "server", remotePort, ...metadata };
      const command = { type: "open-port-forward", ...request };
      const forward = {
        ...request,
        id: "forward",
        localPort: 43000,
        localUrl: "http://127.0.0.1:43000",
        status: "active",
      };
      const manager = {
        openPortForward: async (input) => {
          assert.deepEqual(input, request);
          return forward;
        },
      };
      const parsed = parseEnvironmentCommand(command);
      assert.deepEqual(parsed, command);
      assert.equal(await dispatchEnvironmentCommand(manager, parsed), forward);
    }
  }
});

test("opening a port forward requires a strict environment, integer port and safe bounded optional strings", () => {
  const command = { type: "open-port-forward", environmentId: "server", remotePort: 3000 };
  for (const remotePort of [undefined, null, true, "3000", 0, -1, 65536, 1.5, NaN, Infinity, -Infinity, [], {}])
    assert.throws(() => parseEnvironmentCommand({ ...command, remotePort }));
  for (const environmentId of [undefined, null, 1, "", " ", "bad\nserver", "x".repeat(1025)])
    assert.throws(() => parseEnvironmentCommand({ ...command, environmentId }));
  for (const [field, maxLength] of [
    ["processId", 1024],
    ["label", 256],
  ]) {
    for (const value of [null, false, 1, {}, [], "", " \t", "x".repeat(maxLength + 1)])
      assert.throws(() => parseEnvironmentCommand({ ...command, [field]: value }));
    for (const code of [
      ...Array.from({ length: 32 }, (_, index) => index),
      ...Array.from({ length: 33 }, (_, index) => index + 127),
    ])
      assert.throws(() => parseEnvironmentCommand({ ...command, [field]: `bad${String.fromCharCode(code)}value` }));
  }
  for (const field of ["localPort", "localUrl", "unexpected"])
    assert.throws(() => parseEnvironmentCommand({ ...command, [field]: "value" }));
});

test("closing a port forward passes its environment and port separately and preserves the close outcome", async () => {
  for (const [remotePort, closed] of [
    [1, true],
    [3000, false],
    [65535, true],
  ]) {
    const command = { type: "close-port-forward", environmentId: "server", remotePort };
    const outcome = { closed };
    const manager = {
      closePortForward: async (environmentId, port) => {
        assert.equal(environmentId, "server");
        assert.equal(port, remotePort);
        return outcome;
      },
    };
    const parsed = parseEnvironmentCommand(command);
    assert.deepEqual(parsed, command);
    assert.equal(await dispatchEnvironmentCommand(manager, parsed), outcome);
  }
});

test("closing a port forward requires an environment and valid port and refuses opening-only fields", () => {
  const command = { type: "close-port-forward", environmentId: "server", remotePort: 3000 };
  for (const remotePort of [undefined, null, true, "3000", 0, -1, 65536, 1.5, NaN, Infinity, [], {}])
    assert.throws(() => parseEnvironmentCommand({ ...command, remotePort }));
  for (const environmentId of [undefined, null, 1, "", " ", "bad\nserver", "x".repeat(1025)])
    assert.throws(() => parseEnvironmentCommand({ ...command, environmentId }));
  for (const field of ["processId", "label", "unexpected"])
    assert.throws(() => parseEnvironmentCommand({ ...command, [field]: "value" }));
});

test("port-forward manager failures reach command callers unchanged", async () => {
  const failure = new Error("The environment is offline");
  const fail = async () => {
    throw failure;
  };
  const manager = {
    listPortForwards: () => {
      throw failure;
    },
    openPortForward: fail,
    closePortForward: fail,
  };
  for (const command of [
    { type: "list-port-forwards" },
    { type: "open-port-forward", environmentId: "server", remotePort: 3000 },
    { type: "close-port-forward", environmentId: "server", remotePort: 3000 },
  ])
    await assert.rejects(
      dispatchEnvironmentCommand(manager, parseEnvironmentCommand(command)),
      (error) => error === failure,
    );
});

test("untrusted commands cannot inject shell options, pre-bind identities or bypass lifecycle choices", () => {
  for (const command of [
    null,
    { type: "unknown" },
    { type: "add", draft },
    { type: "add", connect: true, draft: { ...draft, target: { ...draft.target, sshAlias: "-oProxyCommand=evil" } } },
    {
      type: "add",
      connect: true,
      draft: { ...draft, target: { ...draft.target, expectedEnvironmentId: "untrusted" } },
    },
    { type: "test", subject: { draft, environmentId: "server" } },
    { type: "remove", environmentId: "server" },
    { type: "connect", environmentId: "bad\nserver" },
    { type: "set-policy", policy: { autoReconnect: "yes" } },
    { type: "set-policy", policy: { unknown: true } },
  ])
    assert.throws(() => parseEnvironmentCommand(command));
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer as createTcpServer, createConnection } from "node:net";
import { once } from "node:events";
import { importTestBundle } from "#test-bundle";
import { createRpcServer } from "../../contract/rpc.ts";
import { startDaemonServer } from "../../agent-host/daemon-server.ts";

async function desktopBoundary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "dexon-remote-services-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const api = await importTestBundle("remote-service-boundary", {
    stdin: {
      contents:
        'export { EnvironmentManager } from "./src/main/environments/environment-manager"; export { installDesktopIpc } from "./src/main/ipc"; export { handlers } from "electron";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    plugins: [
      {
        name: "electron-boundary",
        setup(build) {
          build.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "platform" }));
          build.onLoad({ filter: /./, namespace: "platform" }, () => ({
            contents: `export class MessageChannelMain {}
            export const handlers = new Map();
            export const ipcMain = { handle(name, handler) { handlers.set(name, handler); }, on() {} };
            export const app = { getPath: () => ${JSON.stringify(directory)}, getAppPath: () => ${JSON.stringify(directory)}, getVersion: () => "test" };
            export const BrowserWindow = { getAllWindows: () => [] };
            export const dialog = {}; export const Menu = {}; export const Notification = {};
            export const protocol = {}; export const shell = {}; export const clipboard = {};
            export const nativeImage = {}; export const nativeTheme = {}; export const safeStorage = {};`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const manager = new api.EnvironmentManager({
    userDataDir: directory,
    hostManager: { isServing: () => false, getStatus: () => "stopped", getPiVersion: () => "test" },
  });
  t.after(() => manager.dispose());
  return { ...api, manager };
}

function forwardsBecome(manager, predicate) {
  if (predicate(manager.snapshot().portForwards)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Port forwards did not reach the expected state"));
    }, 5000);
    const unsubscribe = manager.subscribe((snapshot) => {
      if (!predicate(snapshot.portForwards)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

test("remote service snapshots start empty and attachment routing never falls back to Primary", async (t) => {
  const { manager } = await desktopBoundary(t);
  assert.deepEqual(manager.snapshot().portForwards, []);
  assert.deepEqual(manager.listPortForwards(), []);
  assert.equal((await manager.stageRemoteAttachment(null)).code, "unsupported-type");
  const request = { name: "file.txt", base64: "aGk=" };
  assert.equal((await manager.stageRemoteAttachment({ ...request, environmentId: "primary" })).code, "unsupported");
  assert.equal((await manager.stageRemoteAttachment({ ...request, environmentId: "unknown" })).code, "disconnected");
  const added = await manager.addEnvironment({
    label: "Offline",
    enabled: false,
    target: { kind: "ssh", sshAlias: "offline" },
  });
  assert.equal((await manager.stageRemoteAttachment({ ...request, environmentId: added.id })).code, "disconnected");
  await assert.rejects(manager.openPortForward({ environmentId: added.id, remotePort: 43210 }));
});

test("a remote connection uploads attachments and restores loopback forwards after reconnect without exposing credentials", async (t) => {
  const { manager } = await desktopBoundary(t);
  await manager.setPolicy({ autoReconnect: false });
  const rpc = createRpcServer();
  rpc.handle({ "host.ping": async () => ({ ok: true, ts: Date.now() }) });
  const token = "d".repeat(64);
  const descriptor = {
    environmentId: "remote-identity",
    label: "Remote",
    protocolVersion: 1,
    serverVersion: "test",
    platform: { os: "linux", arch: "x64", pathStyle: "posix", home: "/home/dev" },
    capabilities: {
      browser: false,
      nativeDialogs: false,
      revealInFileManager: false,
      managedProcesses: true,
      toolchainInstall: true,
      remoteAttachmentUpload: true,
      portForwarding: true,
    },
  };
  let daemon = await startDaemonServer({
    rpcServer: rpc,
    getDescriptor: () => descriptor,
    authToken: token,
    listenPort: 0,
  });
  t.after(() => daemon.close());
  const daemonPort = daemon.port;
  let observed;
  const requestHandler = daemon.server.listeners("request")[0];
  daemon.server.removeAllListeners("request");
  daemon.server.on("request", async (request, response) => {
    if (request.url !== "/attachments/stage") return requestHandler(request, response);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    observed = { headers: request.headers, body: Buffer.concat(chunks) };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        ok: true,
        staged: { path: "/remote/file.txt", name: "file.txt", mime: "text/plain", size: 2, deduplicated: false },
      }),
    );
  });
  const added = await manager.addEnvironment({
    label: "Remote",
    enabled: false,
    authToken: token,
    target: { kind: "websocket", url: `ws://127.0.0.1:${daemonPort}/rpc` },
  });
  await manager.connectEnvironment(added.id);
  const uploaded = await manager.stageRemoteAttachment({
    environmentId: added.id,
    name: "file.txt",
    mime: "text/plain",
    base64: "aGk=",
  });
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.staged.path, "/remote/file.txt");
  assert.equal(observed.headers.authorization, `Bearer ${token}`);
  assert.equal(observed.headers["x-dexon-filename"], "file.txt");
  assert.equal(observed.body.toString(), "hi");
  const echo = createTcpServer((socket) => socket.pipe(socket));
  await new Promise((resolve) => echo.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => echo.close(resolve)));
  const remotePort = echo.address().port;
  const forward = await manager.openPortForward({
    environmentId: added.id,
    remotePort,
    processId: "dev-server",
    label: "Preview",
  });
  assert.equal(forward.id, `${added.id}:${remotePort}`);
  assert.equal(forward.status, "active");
  assert.notEqual(forward.localPort, remotePort);
  assert.deepEqual(manager.listPortForwards(added.id), [forward]);
  const socket = createConnection({ host: "127.0.0.1", port: forward.localPort });
  t.after(() => socket.destroy());
  await once(socket, "connect");
  socket.write("round trip");
  assert.equal((await once(socket, "data"))[0].toString(), "round trip");
  socket.destroy();
  const reconnecting = forwardsBecome(manager, (entries) => entries[0]?.status === "reconnecting");
  await daemon.close();
  await reconnecting;
  daemon = await startDaemonServer({
    rpcServer: rpc,
    getDescriptor: () => descriptor,
    authToken: token,
    listenPort: daemonPort,
  });
  const restored = forwardsBecome(manager, (entries) => entries[0]?.status === "active");
  await manager.connectEnvironment(added.id);
  await restored;
  assert.equal(manager.listPortForwards(added.id)[0].localPort, forward.localPort);
  assert.doesNotMatch(JSON.stringify(manager.snapshot()), new RegExp(token));
  assert.deepEqual(await manager.closePortForward(added.id, remotePort), { closed: true });
  await manager.openPortForward({ environmentId: added.id, remotePort });
  await manager.disconnectEnvironment(added.id);
  assert.deepEqual(manager.listPortForwards(added.id), []);
  assert.equal(
    (await manager.stageRemoteAttachment({ environmentId: added.id, name: "file.txt", base64: "aGk=" })).code,
    "disconnected",
  );
});

test("remote attachment IPC delegates only requests from the trusted main frame", async (t) => {
  const { installDesktopIpc, handlers } = await desktopBoundary(t);
  const mainFrame = {};
  const window = { isDestroyed: () => false, webContents: { mainFrame } };
  const request = { environmentId: "remote", name: "file.txt", base64: "aGk=" };
  const outcome = { ok: false, code: "disconnected", message: "Offline" };
  installDesktopIpc({
    getMainWindow: () => window,
    environmentManager: {
      stageRemoteAttachment: async (value) => {
        assert.deepEqual(value, request);
        return outcome;
      },
    },
  });
  const invoke = handlers.get("desktop:stage-remote-attachment");
  assert.equal(typeof invoke, "function");
  assert.throws(() => invoke({ sender: window.webContents, senderFrame: {} }, request), /Untrusted/);
  assert.throws(() => invoke({ sender: {}, senderFrame: mainFrame }, request), /Untrusted/);
  assert.deepEqual(await invoke({ sender: window.webContents, senderFrame: mainFrame }, request), outcome);
});

test("non-boolean SSH lifecycle values fall back to the global policy", async () => {
  const { closeModeFor } = await import("./environment-lifecycle.ts");
  for (const stopOnDisconnect of [null, "false", 0, {}])
    assert.equal(
      closeModeFor(
        "disconnect",
        { detachedDaemon: true, autoReconnect: true },
        { kind: "ssh", sshAlias: "server", stopOnDisconnect },
      ),
      "disconnect",
    );
});

test("removing a managed daemon prevents reconnect from relaunching it after the stop", async () => {
  const { removeWithChoice } = await import("./environment-lifecycle.ts");
  let reconnect = true,
    running = true;
  const outcome = await removeWithChoice("stop", {
    disconnect: async () => {
      reconnect = false;
    },
    stopManaged: async () => {
      running = reconnect;
      return "stopped";
    },
    remove: () => {},
  });
  assert.equal(outcome.remoteDaemon, "stopped");
  assert.equal(running, false);
});

test("shutdown cancels an in-flight reconfiguration instead of registering another supervisor", async (t) => {
  const { manager } = await desktopBoundary(t);
  const added = await manager.addEnvironment({
    label: "Remote",
    enabled: false,
    target: { kind: "ssh", sshAlias: "gpu" },
  });
  const updating = manager.updateEnvironment(added.id, {
    label: "Changed",
    target: { kind: "ssh", sshAlias: "gpu-new" },
  });
  await Promise.resolve();
  await manager.shutdown();
  await assert.rejects(updating, /disposed/);
});

test("a failed remote stop still releases the local SSH tunnel", async () => {
  const { EnvironmentSupervisor } = await import("./environment-supervisor.ts");
  const modes = [];
  const supervisor = new EnvironmentSupervisor({
    configuration: { target: { kind: "ssh", sshAlias: "gpu" } },
    onBound() {},
    onChange() {},
    sshTunnelManager: {
      closeTunnel: async (_target, mode) => {
        modes.push(mode);
        if (mode === "stop-managed") throw new Error("Remote is unreachable");
      },
    },
  });
  await assert.rejects(supervisor.disconnect("stop-managed"), /unreachable/);
  assert.deepEqual(modes, ["stop-managed", "disconnect"]);
});
