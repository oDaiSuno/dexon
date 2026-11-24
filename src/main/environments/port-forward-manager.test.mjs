import assert from "node:assert/strict";
import test from "node:test";
import { PortForwardManager } from "./port-forward-manager.ts";

test("invalid ports, environment identifiers and metadata fail before resolving a transport", async () => {
  let resolutions = 0;
  const manager = new PortForwardManager({
    resolveTransport: () => {
      resolutions++;
      return null;
    },
  });
  for (const remotePort of [0, 65536, -1, 1.5, NaN, Infinity, "3000", null]) {
    await assert.rejects(manager.open({ environmentId: "gpu", remotePort }), /Invalid remote port/);
  }
  for (const environmentId of ["", " ", "a".repeat(1025), "gpu\0", "gpu\r", "gpu\n", null, 42]) {
    await assert.rejects(manager.open({ environmentId, remotePort: 3000 }), /Invalid environment/);
  }
  for (const field of ["processId", "label"]) {
    for (const value of ["", " ", "a".repeat(1025), "a\t", "a\u007f", "a\u0085", "a\u202e", null, 42]) {
      await assert.rejects(manager.open({ environmentId: "gpu", remotePort: 3000, [field]: value }), /Invalid/);
    }
  }
  assert.equal(resolutions, 0);
  assert.deepEqual(manager.list(), []);
});

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return server.address().port;
}

async function websocketEndpoint(t, connected) {
  const { WebSocketServer, createWebSocketStream } = await import("ws");
  const { createServer } = await import("node:http");
  const server = createServer();
  const wss = new WebSocketServer({
    server,
    verifyClient: ({ req }) =>
      req.headers.authorization === "Bearer test-secret" &&
      req.headers["x-dexon-environment-id"] === "remote-gpu" &&
      req.headers["x-dexon-protocol-version"] === "1",
  });
  const requests = [];
  wss.on("connection", (socket, request) => {
    requests.push(request);
    if (connected) return connected(socket, request);
    const stream = createWebSocketStream(socket);
    stream.on("error", () => {});
    stream.pipe(stream);
  });
  const port = await listen(server);
  t.after(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    requests,
    transport: {
      target: { kind: "websocket", url: `ws://127.0.0.1:${port}/rpc` },
      endpoint: { wsUrl: `ws://127.0.0.1:${port}/rpc`, authToken: "test-secret" },
      remoteEnvironmentId: "remote-gpu",
    },
  };
}

async function exchange(t, port, body) {
  const { connect } = await import("node:net");
  const socket = connect({ host: "127.0.0.1", port });
  t.after(() => socket.destroy());
  const chunks = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TCP exchange timed out")), 5000);
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length >= body.length) {
        clearTimeout(timer);
        socket.end();
        resolve(Buffer.concat(chunks));
      }
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (Buffer.concat(chunks).length < body.length) reject(new Error("TCP closed before reply"));
    });
    socket.end(body);
  });
}

test("a loopback listener bridges binary TCP bytes through an authenticated WebSocket tunnel", async (t) => {
  const endpoint = await websocketEndpoint(t);
  const { createServer } = await import("node:net");
  const temporary = createServer();
  const remotePort = await listen(temporary);
  await new Promise((resolve) => temporary.close(resolve));
  let changes = 0;
  const manager = new PortForwardManager({ resolveTransport: () => endpoint.transport, onChanged: () => changes++ });
  t.after(() => manager.dispose());
  const entry = await manager.open({
    environmentId: "saved-gpu",
    remotePort,
    processId: "dev-server",
    label: "Preview",
  });
  assert.equal(entry.status, "active");
  assert.equal(entry.localPort, remotePort);
  assert.equal(entry.localUrl, `http://127.0.0.1:${remotePort}`);
  assert.equal(entry.environmentId, "saved-gpu");
  assert.equal(entry.id, `saved-gpu:${remotePort}`);
  const body = Buffer.from([0, 255, 1, 128, 13, 10, 42]);
  assert.deepEqual(await exchange(t, entry.localPort, body), body);
  assert.equal(endpoint.requests[0].url, `/tunnel?port=${remotePort}`);
  assert.equal(endpoint.requests[0].headers.authorization, "Bearer test-secret");
  assert.equal(endpoint.requests[0].headers["x-dexon-protocol-version"], "1");
  assert.equal(endpoint.requests[0].headers["x-dexon-environment-id"], "remote-gpu");
  entry.label = "mutated";
  manager.list()[0].localPort = 1;
  assert.equal(manager.list("saved-gpu")[0].label, "Preview");
  assert.equal(manager.list()[0].localPort, remotePort);
  assert.deepEqual(manager.list("other"), []);
  assert.equal(changes > 0, true);
});

test("occupied preferred ports fall back and concurrent duplicate opens share one of eight slots", async (t) => {
  const endpoint = await websocketEndpoint(t);
  const { createServer } = await import("node:net");
  const occupied = createServer();
  const remotePort = await listen(occupied);
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const manager = new PortForwardManager({ resolveTransport: () => endpoint.transport });
  t.after(() => manager.dispose());
  const first = manager.open({ environmentId: "gpu", remotePort });
  const duplicate = manager.open({ environmentId: "gpu", remotePort, label: "ignored" });
  const pending = Array.from({ length: 7 }, (_, index) =>
    manager.open({ environmentId: "gpu", remotePort: 32200 + index }),
  );
  const other = manager.open({ environmentId: "other", remotePort });
  await assert.rejects(manager.open({ environmentId: "gpu", remotePort: 32207 }), /limit|eight|8/i);
  const [entry, same] = await Promise.all([first, duplicate]);
  await Promise.all([...pending, other]);
  assert.equal(entry.id, same.id);
  assert.notEqual(entry.localPort, remotePort);
  assert.equal(manager.list("gpu").length, 8);
  assert.equal(manager.list("other").length, 1);
  assert.equal((await manager.open({ environmentId: "gpu", remotePort })).id, entry.id);
  assert.deepEqual(await exchange(t, entry.localPort, Buffer.from("fallback")), Buffer.from("fallback"));
});

test("suspension closes local listeners, reconnect restores the same preferred port, explicit close is permanent", async (t) => {
  const endpoint = await websocketEndpoint(t);
  const manager = new PortForwardManager({ resolveTransport: () => endpoint.transport });
  t.after(() => manager.dispose());
  const entry = await manager.open({ environmentId: "gpu", remotePort: 32145 });
  await manager.closeEnvironment("gpu", true);
  assert.equal(manager.list()[0].status, "reconnecting");
  assert.equal(manager.list()[0].localPort, entry.localPort);
  const { createServer } = await import("node:net");
  const probe = createServer();
  await listen(probe, entry.localPort);
  await new Promise((resolve) => probe.close(resolve));
  await Promise.all([manager.reconnectEnvironment("gpu"), manager.reconnectEnvironment("gpu")]);
  assert.equal(manager.list()[0].localPort, entry.localPort);
  assert.equal(manager.list()[0].id, entry.id);
  assert.equal(manager.list()[0].status, "active");
  assert.deepEqual(await exchange(t, entry.localPort, Buffer.from("restored")), Buffer.from("restored"));
  assert.deepEqual(await manager.close("gpu", entry.remotePort), { closed: true });
  assert.deepEqual(await manager.close("gpu", entry.remotePort), { closed: false });
  await manager.reconnectEnvironment("gpu");
  assert.deepEqual(manager.list(), []);
});

async function sshBoundary(t, automatic = false) {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const children = [];
  const spawn = (executable, args, options) => {
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      signals: [],
    });
    child.kill = (signal = "SIGTERM") => {
      child.signals.push(signal);
      child.signalCode = signal;
      child.emit("exit", null, signal);
      child.emit("close", null, signal);
      return true;
    };
    const localPort = Number(args[args.indexOf("-L") + 1].split(":")[1]);
    child.ready = () => child.stderr.write(`debug1: Local forwarding listening on 127.0.0.1 port ${localPort}.\r\n`);
    children.push({ child, executable, args, options, localPort });
    if (automatic) setImmediate(child.ready);
    return child;
  };
  const manager = new PortForwardManager({
    resolveTransport: () => ({
      target: { kind: "ssh", sshAlias: "gpu", identityFile: "/tmp/key with spaces", proxyJump: "jump" },
    }),
    spawn,
    openingTimeoutMs: 200,
    killTimeoutMs: 20,
  });
  t.after(() => manager.dispose());
  return { manager, children };
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Expected public boundary condition was not reached");
}

test("SSH opens only after its loopback forwarding diagnostic and terminates the child on close", async (t) => {
  const { manager, children } = await sshBoundary(t);
  let opened = false;
  const opening = manager.open({ environmentId: "gpu", remotePort: 32146 }).then((entry) => {
    opened = true;
    return entry;
  });
  await until(() => children.length === 1);
  const { child, executable, args, options, localPort } = children[0];
  assert.equal(executable, "ssh");
  assert.deepEqual(args.slice(-6), ["-v", "-n", "-N", "-L", `127.0.0.1:${localPort}:127.0.0.1:32146`, "gpu"]);
  assert.equal(args[args.indexOf("-i") + 1], "/tmp/key with spaces");
  assert.equal(args[args.indexOf("-J") + 1], "jump");
  assert.equal(args.includes("ExitOnForwardFailure=yes"), true);
  assert.equal(options.shell, undefined);
  assert.equal(typeof options.cwd, "string");
  assert.deepEqual(options.stdio, ["ignore", "ignore", "pipe"]);
  child.stderr.write("Local forwarding listening on 0.0.0.0 port 32146\n");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, false);
  child.stderr.write("Local forwarding listening on 127.0.0.1 po");
  child.stderr.write(`rt ${localPort}.\n`);
  assert.equal((await opening).status, "active");
  await manager.close("gpu", 32146);
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("unsafe authenticated endpoints and invalid header credentials are rejected before listening", async (t) => {
  const badUrls = [
    "ws://remote.invalid/rpc",
    "ws://user:pass@127.0.0.1/rpc",
    "ws://127.0.0.1/rpc?token=leak",
    "ws://127.0.0.1/rpc#fragment",
    "ws://127.0.0.1/other",
    "file:///rpc",
  ];
  for (const wsUrl of badUrls) {
    const manager = new PortForwardManager({
      resolveTransport: () => ({ target: { kind: "websocket", url: wsUrl }, endpoint: { wsUrl, authToken: "secret" } }),
    });
    t.after(() => manager.dispose());
    await assert.rejects(manager.open({ environmentId: "gpu", remotePort: 32147 }));
    assert.deepEqual(manager.list(), []);
  }
  for (const authToken of ["bad\r\nheader", "bad\0token", "", "a".repeat(8193), "令牌"]) {
    const manager = new PortForwardManager({
      resolveTransport: () => ({
        target: { kind: "websocket", url: "ws://127.0.0.1:1/rpc" },
        endpoint: { wsUrl: "ws://127.0.0.1:1/rpc", authToken },
      }),
    });
    t.after(() => manager.dispose());
    await assert.rejects(manager.open({ environmentId: "gpu", remotePort: 32147 }), /Invalid|invalid/);
    assert.deepEqual(manager.list(), []);
  }
});

test("reconnect does not start a second SSH child while the original open is pending", async (t) => {
  const { manager, children } = await sshBoundary(t);
  const opening = manager.open({ environmentId: "gpu", remotePort: 32148 });
  await until(() => children.length === 1);
  const reconnecting = manager.reconnectEnvironment("gpu");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(children.length, 1);
  children[0].child.ready();
  await Promise.all([opening, reconnecting]);
  assert.equal(manager.list().length, 1);
});

test("a slow TCP reader receives the entire buffered response before a normal WebSocket close", async (t) => {
  const body = Buffer.alloc(8 * 1024 * 1024, 0xa5);
  const endpoint = await websocketEndpoint(t, (websocket) =>
    websocket.send(body, { binary: true }, () => websocket.close()),
  );
  const manager = new PortForwardManager({ resolveTransport: () => endpoint.transport });
  t.after(() => manager.dispose());
  const entry = await manager.open({ environmentId: "gpu", remotePort: 32149 });
  const { connect } = await import("node:net");
  const socket = connect({ host: "127.0.0.1", port: entry.localPort });
  t.after(() => socket.destroy());
  socket.pause();
  const chunks = [];
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Response did not finish")), 5000);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    socket.on("close", () => {
      clearTimeout(timer);
      reject(new Error(`Response truncated at ${Buffer.concat(chunks).length} bytes`));
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  socket.resume();
  assert.deepEqual(await received, body);
});

test("close, suspension and dispose cancel pending opens without resurrecting old entries", async (t) => {
  const { manager, children } = await sshBoundary(t);
  const pending = manager.open({ environmentId: "gpu", remotePort: 32150 });
  const rejected = assert.rejects(pending);
  await until(() => children.length === 1);
  await manager.closeEnvironment("gpu", true);
  await rejected;
  assert.equal(manager.list()[0].status, "reconnecting");
  const restore = manager.reconnectEnvironment("gpu");
  const restoreRejected = assert.rejects(restore);
  await until(() => children.length === 2);
  const closing = manager.close("gpu", 32150);
  const replacement = manager.open({ environmentId: "gpu", remotePort: 32150 });
  await until(() => children.length === 3);
  children[1].child.ready();
  children[2].child.ready();
  const fresh = await replacement;
  await Promise.all([closing, restoreRejected]);
  assert.equal(manager.list()[0].id, fresh.id);
  assert.deepEqual(
    children.slice(0, 2).map(({ child }) => child.signals),
    [["SIGTERM"], ["SIGTERM"]],
  );
  const newPending = manager.open({ environmentId: "other", remotePort: 32151 });
  const disposeRejected = assert.rejects(newPending);
  await until(() => children.length === 4);
  await Promise.all([manager.dispose(), manager.dispose(), disposeRejected]);
  assert.deepEqual(manager.list(), []);
  assert.equal(
    children.every(({ child }) => child.signalCode !== null),
    true,
  );
  await assert.rejects(manager.open({ environmentId: "gpu", remotePort: 32150 }), /disposed/);
  await manager.reconnectEnvironment("gpu");
  assert.deepEqual(manager.list(), []);
});

test("an SSH child exiting in the readiness tick cannot publish an active entry", async (t) => {
  const { manager, children } = await sshBoundary(t);
  const opening = manager.open({ environmentId: "gpu", remotePort: 32152 });
  const rejected = assert.rejects(opening);
  await until(() => children.length === 1);
  children[0].child.ready();
  children[0].child.exitCode = 1;
  children[0].child.emit("exit", 1);
  children[0].child.emit("close", 1);
  await rejected;
  assert.deepEqual(manager.list(), []);
});

test("SSH opening failures release slots and timed-out children are forcibly terminated when necessary", async (t) => {
  const { manager, children } = await sshBoundary(t);
  const opening = manager.open({ environmentId: "gpu", remotePort: 32153 });
  const rejected = assert.rejects(opening, /timed out/);
  await until(() => children.length === 1);
  const child = children[0].child;
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGKILL") {
      child.signalCode = signal;
      child.emit("exit", null, signal);
      child.emit("close", null, signal);
    }
    return true;
  };
  await rejected;
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(manager.list(), []);
  const retry = manager.open({ environmentId: "gpu", remotePort: 32153 });
  await until(() => children.length === 2);
  children[1].child.ready();
  assert.equal((await retry).status, "active");
  children[1].child.exitCode = 1;
  children[1].child.emit("exit", 1);
  assert.equal(manager.list()[0].status, "error");
  await manager.closeEnvironment("gpu", true);
  const reconnect = manager.reconnectEnvironment("gpu");
  const reconnectRejected = assert.rejects(reconnect);
  await until(() => children.length === 3);
  children[2].child.emit("error", Object.assign(new Error("SSH unavailable"), { code: "ENOENT" }));
  children[2].child.emit("close", -1);
  await reconnectRejected;
  assert.equal(manager.list()[0].status, "reconnecting");
  assert.match(manager.list()[0].error, /failed/);
  await manager.closeEnvironment("gpu");
  await manager.reconnectEnvironment("gpu");
  assert.deepEqual(manager.list(), []);
});

test("WebSocket handshakes are aborted when TCP clients disappear and disposal closes live connections", async (t) => {
  const { createServer } = await import("node:http");
  const { connect } = await import("node:net");
  const server = createServer();
  const connections = new Set();
  server.on("connection", (socket) => {
    connections.add(socket);
    socket.on("end", () => socket.destroy());
    socket.once("close", () => connections.delete(socket));
  });
  const requests = [];
  server.on("upgrade", (request) => requests.push(request));
  const port = await listen(server);
  t.after(async () => {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const manager = new PortForwardManager({
    resolveTransport: () => ({ target: { kind: "websocket", url: `ws://127.0.0.1:${port}/rpc` } }),
  });
  t.after(() => manager.dispose());
  const entry = await manager.open({ environmentId: "gpu", remotePort: 32154 });
  const client = connect({ host: "127.0.0.1", port: entry.localPort });
  client.on("error", () => {});
  t.after(() => client.destroy());
  await until(() => requests.length === 1);
  client.resetAndDestroy();
  await until(() => connections.size === 0);
  const second = connect({ host: "127.0.0.1", port: entry.localPort });
  second.on("error", () => {});
  t.after(() => second.destroy());
  const closed = new Promise((resolve) => second.once("close", resolve));
  await until(() => requests.length === 2);
  await manager.dispose();
  await closed;
  await until(() => connections.size === 0);
  assert.deepEqual(manager.list(), []);
});

test("dispose waits for child cleanup even after a failed opening disappears from the list", async (t) => {
  const { manager, children } = await sshBoundary(t);
  const rejected = assert.rejects(manager.open({ environmentId: "gpu", remotePort: 32155 }));
  await until(() => children.length === 1);
  const child = children[0].child;
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGKILL") {
      child.signalCode = signal;
      child.emit("exit", null, signal);
      child.emit("close", null, signal);
    }
    return true;
  };
  child.emit("error", new Error("connection lost"));
  await until(() => manager.list().length === 0 && child.signals.length > 0);
  await manager.dispose();
  assert.equal(child.signalCode, "SIGKILL");
  await rejected;
});
