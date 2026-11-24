import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { request } from "node:http";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { startDaemonServer } from "./daemon-server.ts";

const token = "a".repeat(64);
const { RemoteAttachmentStore } = await importTestBundle("daemon-http-store", {
  packages: "external",
  entryPoints: ["src/agent-host/remote-attachment-store.ts"],
});

async function attachments(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-daemon-stage-"));
  const store = new RemoteAttachmentStore(root);
  await store.initialize();
  t.after(async () => {
    await store.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const daemon = await start(t, { attachmentStore: store });
  return { root, store, daemon, url: `http://127.0.0.1:${daemon.port}/attachments/stage` };
}

function post(url, data, headers = {}) {
  return globalThis.fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, ...headers },
    body: data,
  });
}

function streamPost(url, chunks, headers = {}, end = true) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { authorization: `Bearer ${token}`, ...headers } });
    req.on("error", reject);
    req.on("response", (response) => {
      const parts = [];
      response.on("data", (part) => parts.push(part));
      response.on("error", reject);
      response.on("end", () =>
        resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(parts).toString()) }),
      );
    });
    req.flushHeaders();
    for (const chunk of chunks) req.write(chunk);
    if (end) req.end();
  });
}

async function start(t, options = {}) {
  const daemon = await startDaemonServer({
    rpcServer: { attachPort() {} },
    getDescriptor: () => ({ environmentId: "verified-environment" }),
    authToken: token,
    listenPort: 0,
    ...options,
  });
  t.after(() => daemon.close());
  return daemon;
}

function handshake(daemon, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${daemon.port}${path}`, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "AAAAAAAAAAAAAAAAAAAAAA==",
        ...headers,
      },
    });
    req.on("error", reject);
    req.on("response", (response) => {
      response.resume();
      resolve({ status: response.statusCode });
    });
    req.on("upgrade", (response, socket, head) => resolve({ status: response.statusCode, socket, head }));
    req.end();
  });
}

async function upgradeStatus(daemon, path, headers) {
  const result = await handshake(daemon, path, headers);
  result.socket?.destroy();
  return result.status;
}

async function tcpServer(t, listener = (socket) => socket.pipe(socket)) {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    listener(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return { port: server.address().port, sockets, server };
}

async function openWebSocket(t, daemon, path) {
  const ws = new globalThis.WebSocket(`ws://127.0.0.1:${daemon.port}${path}`);
  ws.binaryType = "arraybuffer";
  t.after(() => ws.close());
  await once(ws, "open", { signal: globalThis.AbortSignal.timeout(3000) });
  return ws;
}

function exchange(ws, payload) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const closed = () => {
      cleanup();
      reject(new Error("Tunnel closed before echo"));
    };
    const message = (event) => {
      assert.ok(event.data instanceof ArrayBuffer);
      chunks.push(Buffer.from(event.data));
      size += event.data.byteLength;
      if (size >= payload.length) {
        cleanup();
        resolve(Buffer.concat(chunks));
      }
    };
    const cleanup = () => {
      ws.removeEventListener("message", message);
      ws.removeEventListener("close", closed);
    };
    ws.addEventListener("message", message);
    ws.addEventListener("close", closed);
    ws.send(payload);
  });
}

function clientFrame(opcode, payload = Buffer.alloc(0), final = true) {
  const prefix = payload.length < 126 ? 2 : payload.length <= 65535 ? 4 : 10;
  const frame = Buffer.alloc(prefix + 4 + payload.length);
  frame[0] = (final ? 0x80 : 0) | opcode;
  frame[1] = 0x80 | (prefix === 2 ? payload.length : prefix === 4 ? 126 : 127);
  if (prefix === 4) frame.writeUInt16BE(payload.length, 2);
  if (prefix === 10) frame.writeBigUInt64BE(BigInt(payload.length), 2);
  frame.fill(0x57, prefix, prefix + 4);
  for (let i = 0; i < payload.length; i++) frame[prefix + 4 + i] = payload[i] ^ 0x57;
  return frame;
}

async function rawWebSocket(t, daemon, path) {
  const { socket, head, status } = await handshake(daemon, path);
  assert.equal(status, 101);
  t.after(() => socket.destroy());
  const frames = [],
    readers = [];
  let buffered = Buffer.alloc(0);
  const receive = (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      const short = buffered[1] & 127;
      const prefix = short < 126 ? 2 : short === 126 ? 4 : 10;
      if (buffered.length < prefix) return;
      const size = prefix === 2 ? short : prefix === 4 ? buffered.readUInt16BE(2) : Number(buffered.readBigUInt64BE(2));
      if (buffered.length < prefix + size) return;
      const frame = { opcode: buffered[0] & 15, payload: buffered.subarray(prefix, prefix + size) };
      buffered = buffered.subarray(prefix + size);
      if (readers.length) readers.shift()(frame);
      else frames.push(frame);
    }
  };
  socket.on("data", receive);
  receive(head);
  return {
    socket,
    next: () => (frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve) => readers.push(resolve))),
  };
}

const echoRpc = (port, role) => {
  assert.equal(role, "gatekeeper");
  port.addEventListener("message", ({ data }) => port.postMessage({ echo: data }));
};

const expectError = async (pending, status, code) => {
  const response = await pending;
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.code, code);
  assert.equal(typeof body.message, "string");
};

test("the public descriptor proves possession of the token without receiving the token", async (t) => {
  const daemon = await start(t);
  const response = await globalThis.fetch(`http://127.0.0.1:${daemon.port}/.well-known/dexon/environment`, {
    headers: { "x-dexon-nonce": "0123456789abcdef" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("x-dexon-proof"),
    "ded7333ff41740d0721c9a50a5e93e6c7c8820432c2723e92ba747fe499d1e0a",
  );
  assert.deepEqual(await response.json(), { environmentId: "verified-environment" });
  for (const nonce of [null, "invalid-nonce", "a".repeat(15), "a".repeat(129)]) {
    const publicResponse = await globalThis.fetch(`http://127.0.0.1:${daemon.port}/.well-known/dexon/environment`, {
      headers: nonce === null ? {} : { "x-dexon-nonce": nonce },
    });
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get("x-dexon-proof"), null);
    assert.deepEqual(await publicResponse.json(), { environmentId: "verified-environment" });
  }
});

test("binary messages echo intact", { timeout: 15000 }, async (t) => {
  const target = await tcpServer(t);
  const daemon = await start(t);
  const ws = await openWebSocket(t, daemon, `/tunnel?port=${target.port}&token=${token}`);
  for (const payload of [
    Buffer.from([0xff, 0xfe, 0, 0x80, 1]),
    Buffer.alloc(128 * 1024, 0xa5),
    Buffer.alloc(8 * 1024 * 1024, 0xbd),
  ]) {
    assert.deepEqual(await exchange(ws, payload), payload);
  }
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual(await exchange(ws, Buffer.from([7])), Buffer.from([7]));
});

test("fragmented frames and ping survive backpressure", { timeout: 15000 }, async (t) => {
  const target = await tcpServer(t, (socket) => {
    socket.pause();
    socket.pipe(socket);
    socket.pause();
  });
  const daemon = await start(t);
  const connected = once(target.server, "connection");
  const raw = await rawWebSocket(t, daemon, `/tunnel?port=${target.port}&token=${token}`);
  const [peer] = await connected;
  peer.pause();
  const payload = Buffer.alloc(4 * 1024 * 1024, 0xef);
  const pieces = [
    clientFrame(2, Buffer.from([0xff]), false),
    clientFrame(9, Buffer.from("ping")),
    clientFrame(0, Buffer.from([0xfe, 0x80])),
  ];
  for (let offset = 0; offset < payload.length; offset += 65536)
    pieces.push(clientFrame(2, payload.subarray(offset, offset + 65536)));
  raw.socket.write(Buffer.concat(pieces));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(peer);
  peer.resume();
  raw.socket.pause();
  await new Promise((resolve) => setTimeout(resolve, 50));
  raw.socket.resume();
  const chunks = [];
  let size = 0,
    pong = false;
  while (size < payload.length + 3 || !pong) {
    const frame = await raw.next();
    if (frame.opcode === 10) {
      assert.equal(frame.payload.toString(), "ping");
      pong = true;
    } else {
      assert.equal(frame.opcode, 2);
      chunks.push(frame.payload);
      size += frame.payload.length;
    }
  }
  assert.deepEqual(Buffer.concat(chunks), Buffer.concat([Buffer.from([0xff, 0xfe, 0x80]), payload]));
  const targetClosed = once(peer, "close");
  raw.socket.write(clientFrame(8, Buffer.from([3, 232])));
  assert.equal((await raw.next()).opcode, 8);
  await targetClosed;
});

test("tunnels clean up on refusal, invalid text, EOF and shutdown", { timeout: 10000 }, async (t) => {
  const closedTarget = await tcpServer(t);
  await new Promise((resolve) => closedTarget.server.close(resolve));
  const daemon = await start(t);
  const refused = await openWebSocket(t, daemon, `/tunnel?port=${closedTarget.port}&token=${token}`);
  assert.equal((await once(refused, "close"))[0].code, 1011);
  const target = await tcpServer(t);
  const text = await openWebSocket(t, daemon, `/tunnel?port=${target.port}&token=${token}`);
  const textClosed = once(text, "close");
  text.send("not binary");
  assert.equal((await textClosed)[0].code, 1003);
  const ws = await openWebSocket(t, daemon, `/tunnel?port=${target.port}&token=${token}`);
  await exchange(ws, Buffer.from([1]));
  const targetPeer = [...target.sockets].at(-1);
  const peerClosed = once(targetPeer, "close");
  const clientClosed = once(ws, "close");
  await daemon.close();
  await Promise.all([peerClosed, clientClosed]);
  const other = await start(t);
  const ended = await openWebSocket(t, other, `/tunnel?port=${target.port}&token=${token}`);
  await exchange(ended, Buffer.from([2]));
  const endedClosed = once(ended, "close");
  [...target.sockets].at(-1).end();
  assert.equal((await endedClosed)[0].code, 1000);
  const raw = await rawWebSocket(t, other, `/tunnel?port=${target.port}&token=${token}`);
  raw.socket.write(clientFrame(2, Buffer.from([3])));
  await raw.next();
  const abruptClosed = once([...target.sockets].at(-1), "close", { signal: globalThis.AbortSignal.timeout(1000) });
  raw.socket.end();
  await abruptClosed;
});
test("a client FIN behind a stalled tunnel cannot retain daemon sockets indefinitely", { timeout: 5000 }, async (t) => {
  const target = await tcpServer(t, (socket) => socket.pause());
  const daemon = await start(t);
  const raw = await rawWebSocket(t, daemon, `/tunnel?port=${target.port}&token=${token}`);
  const frame = clientFrame(2, Buffer.alloc(65536, 0x71));
  raw.socket.on("error", () => {});
  raw.socket.end(Buffer.concat(Array(512).fill(frame)));
  const closed = new Promise((resolve) => raw.socket.once("close", resolve));
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Stalled tunnel leaked after client FIN")), 3000)),
  ]);
  assert.equal(await new Promise((resolve) => daemon.server.getConnections((_, count) => resolve(count))), 0);
});
test("HTTP staging preserves binary bytes and safe decoded metadata", { timeout: 10000 }, async (t) => {
  const { root, url } = await attachments(t);
  const payload = Buffer.from([0, 255, 128, 1, 254]);
  const response = await streamPost(url, [payload], {
    "x-dexon-filename": encodeURIComponent("../../私密 文档.bin"),
    "content-type": "application/custom; charset=binary",
  });
  assert.equal(response.status, 200);
  const saved = response.body;
  assert.equal(saved.name, "私密 文档.bin");
  assert.equal(saved.mime, "application/custom");
  assert.equal(saved.size, payload.length);
  assert.equal(saved.deduplicated, false);
  assert.equal(path.dirname(saved.path), root);
  assert.deepEqual(await readFile(saved.path), payload);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const image = await post(url, png, { "x-dexon-filename": "unsafe.exe", "content-type": "text/plain" });
  assert.equal(image.status, 200);
  const metadata = await image.json();
  assert.equal(metadata.name, "unsafe.png");
  assert.equal(metadata.mime, "image/png");
});
test("staging rejects bad auth, malformed names, spoofed images and empty data", { timeout: 10000 }, async (t) => {
  const { root, url } = await attachments(t);
  await expectError(globalThis.fetch(url, { method: "POST" }), 401, "UNAUTHORIZED");
  for (const authorization of ["Bearer wrong", "Basic invalid"]) {
    await expectError(post(url, "unauthorized", { authorization }), 401, "UNAUTHORIZED");
  }
  await expectError(post(url, "bad filename", { "x-dexon-filename": "%E0%A4%A" }), 400, "INVALID_FILENAME");
  await expectError(
    post(url, "<svg>not a PNG</svg>", { "content-type": "image/png", "x-dexon-filename": "fake.png" }),
    400,
    "INVALID_IMAGE",
  );
  await expectError(post(url, Buffer.alloc(0)), 400, "EMPTY_ATTACHMENT");
  assert.deepEqual(await readdir(root), []);
  const queryAuth = await globalThis.fetch(`${url}?token=${token}`, { method: "POST", body: "query auth" });
  assert.equal(queryAuth.status, 200);
  await expectError(post(`${url}?token=${token}`, "invalid", { authorization: "Bearer wrong" }), 401, "UNAUTHORIZED");
});
test("oversized declared and chunked uploads receive 413 before disconnect", { timeout: 20000 }, async (t) => {
  const { root, url } = await attachments(t);
  const max = 25 * 1024 * 1024;
  const declared = await streamPost(url, [], { "content-length": String(max + 1) }, false);
  assert.equal(declared.status, 413);
  assert.equal(declared.body.code, "ATTACHMENT_TOO_LARGE");
  assert.equal((await streamPost(url, [Buffer.alloc(max + 1)], { "content-length": String(max + 1) })).status, 413);
  const chunked = await streamPost(url, Array(26).fill(Buffer.alloc(1024 * 1024, 0x51)), {}, false);
  assert.equal(chunked.status, 413);
  assert.equal(chunked.body.code, "ATTACHMENT_TOO_LARGE");
  assert.equal(typeof chunked.body.message, "string");
  assert.deepEqual(await readdir(root), []);
  const atLimit = await post(url, Buffer.alloc(max, 0x6c), { "x-dexon-filename": "limit.bin" });
  assert.equal(atLimit.status, 200);
  assert.equal((await atLimit.json()).size, max);
  const image = Buffer.alloc(20 * 1024 * 1024 + 1);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
  await expectError(post(url, image, { "content-type": "image/png" }), 413, "ATTACHMENT_TOO_LARGE");
});
test("real storage failures return safe structured 500 errors", { timeout: 10000 }, async (t) => {
  const { root, url } = await attachments(t);
  await rm(root, { recursive: true });
  await writeFile(root, "not a directory");
  const response = await post(url, "cannot save");
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(typeof body.code, "string");
  assert.equal(body.message, "Attachment staging failed");
  assert.equal(JSON.stringify(body).includes(root), false);
  const daemon = await start(t);
  await expectError(
    post(`http://127.0.0.1:${daemon.port}/attachments/stage`, "no store"),
    500,
    "ATTACHMENTS_UNAVAILABLE",
  );
});

test("staging verifies SHA256 and deduplicates through the real store", { timeout: 10000 }, async (t) => {
  const { root, url } = await attachments(t);
  const bytes = Buffer.from("hello");
  const hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  const headers = { "x-dexon-sha256": hash, "x-dexon-filename": "first.bin" };
  const first = await post(url, bytes, headers);
  assert.equal(first.status, 200);
  const original = await first.json();
  const repeated = await post(url, bytes, { ...headers, "x-dexon-filename": "second.bin" });
  assert.equal(repeated.status, 200);
  const duplicate = await repeated.json();
  assert.equal(duplicate.path, original.path);
  assert.equal(duplicate.name, "second.bin");
  assert.equal(duplicate.deduplicated, true);
  assert.equal((await readdir(root)).length, 1);
  for (const invalid of ["0".repeat(64), "not-a-hash"]) {
    await expectError(post(url, bytes, { "x-dexon-sha256": invalid }), 400, "INVALID_SHA256");
  }
});

test("aborted uploads leave no temporary files and subsequent uploads work", { timeout: 10000 }, async (t) => {
  const { root, url } = await attachments(t);
  for (const complete of [false, true]) {
    const req = request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-length": String(4 * 1024 * 1024) },
    });
    req.on("error", () => {});
    const closed = new Promise((resolve) => req.once("close", resolve));
    req.write(Buffer.alloc(complete ? 4 * 1024 * 1024 : 65536, 0x42));
    if (complete) {
      req.end();
      await once(req, "finish");
    } else await new Promise((resolve) => setTimeout(resolve, 20));
    req.destroy();
    await closed;
  }
  const response = await post(url, "after aborted upload");
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith(".incoming-")),
    false,
  );
});

test("RPC preserves fragmented text and rejects binary or invalid frames", { timeout: 10000 }, async (t) => {
  const daemon = await start(t, { rpcServer: { attachPort: echoRpc } });
  const ws = await openWebSocket(t, daemon, `/rpc?token=${token}`);
  const message = once(ws, "message");
  ws.send(JSON.stringify({ hello: "world" }));
  assert.deepEqual(JSON.parse((await message)[0].data), { echo: { hello: "world" } });
  const raw = await rawWebSocket(t, daemon, `/rpc?token=${token}`);
  raw.socket.write(Buffer.concat([clientFrame(1, Buffer.from('{"ok":'), false), clientFrame(0, Buffer.from("true}"))]));
  const echoed = await raw.next();
  assert.deepEqual(JSON.parse(echoed.payload.toString()), { echo: { ok: true } });
  const fragments = Array(65537).fill(clientFrame(0, Buffer.alloc(0), false));
  fragments[0] = clientFrame(1, Buffer.alloc(0), false);
  fragments.push(clientFrame(0, Buffer.from("{}")));
  for (const [frames, code] of [
    [[Buffer.concat(fragments)], 1009],
    [[Buffer.from([0x81, 0xff, 0, 0, 0, 0, 4, 0, 0, 1])], 1009],
    [[clientFrame(2, Buffer.from("{}"))], 1003],
    [[clientFrame(1, Buffer.from([0xff]))], 1007],
    [[clientFrame(0, Buffer.from("orphan"))], 1002],
    [[clientFrame(1, Buffer.from("start"), false), clientFrame(2, Buffer.from("mixed"))], 1002],
  ]) {
    const socket = await rawWebSocket(t, daemon, `/rpc?token=${token}`);
    socket.socket.write(Buffer.concat(frames));
    const close = await socket.next();
    assert.equal(close.opcode, 8);
    assert.equal(close.payload.readUInt16BE(0), code);
    socket.socket.write(clientFrame(8, close.payload));
  }
});

test("tunnels require auth, matching identity and an allowed loopback port", { timeout: 10000 }, async (t) => {
  const daemon = await start(t);
  assert.equal(await upgradeStatus(daemon, "/tunnel?port=12345"), 401);
  assert.equal(await upgradeStatus(daemon, "/tunnel?port=12345&token=wrong"), 401);
  const auth = { authorization: `Bearer ${token}` };
  assert.equal(await upgradeStatus(daemon, "/tunnel?port=12345&environmentId=other", auth), 409);
  assert.equal(await upgradeStatus(daemon, "/tunnel?port=12345&protocolVersion=999", auth), 426);
  for (const port of ["", "0", "-1", "65536", "1.5", "abc", "01", "+1", "00080", "1&port=2"]) {
    assert.equal(await upgradeStatus(daemon, `/tunnel?port=${port}`, auth), 400, port);
  }
  assert.equal(await upgradeStatus(daemon, `/tunnel?port=${daemon.port}`, auth), 403);
  for (const host of ["127.0.0.1", "localhost", "example.com", "::1"]) {
    assert.equal(await upgradeStatus(daemon, `/tunnel?port=12345&host=${host}`, auth), 400);
  }
  const disabled = await start(t, { allowLoopbackTunnel: false });
  assert.equal(await upgradeStatus(disabled, "/tunnel?port=12345", auth), 403);
});
