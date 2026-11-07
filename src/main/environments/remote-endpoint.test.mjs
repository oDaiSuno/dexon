import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import test from "node:test";
import { fetchUnauthenticatedDescriptor, openRemoteConnection } from "./remote-endpoint.ts";
import { startDaemonServer } from "../../agent-host/daemon-server.ts";
import { buildEnvironmentDescriptor } from "../../agent-host/environment-identity.ts";
import { createRpcServer } from "../../contract/rpc.ts";
const descriptor = () =>
  buildEnvironmentDescriptor({
    environmentId: "remote-id",
    label: "GPU",
    piVersion: "1.4.0",
    capabilities: {
      browser: false,
      nativeDialogs: false,
      revealInFileManager: false,
      managedProcesses: true,
      toolchainInstall: true,
    },
  });
async function endpoint(t, respond) {
  const server = createServer(respond);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test("descriptor verification challenges the daemon without transmitting the authentication token", async (t) => {
  const token = "a".repeat(64);
  let observed;
  const url = await endpoint(t, (request, response) => {
    observed = {
      url: request.url,
      authorization: request.headers.authorization,
      nonce: request.headers["x-dexon-nonce"],
    };
    response.setHeader("x-dexon-proof", createHmac("sha256", token).update(observed.nonce).digest("hex"));
    response.end(JSON.stringify(descriptor()));
  });
  const found = await fetchUnauthenticatedDescriptor(url, "remote-id", 1000, undefined, token);
  assert.equal(found.runtime.nodeVersion, process.versions.node);
  assert.equal(observed.url, "/.well-known/dexon/environment");
  assert.equal(observed.authorization, undefined);
  assert.match(observed.nonce, /^[a-f0-9]{32}$/);
});

test("incorrect identity, old protocol, malformed runtime and missing possession proof block before RPC opens", async (t) => {
  let body = descriptor();
  const url = await endpoint(t, (_request, response) => response.end(JSON.stringify(body)));
  await assert.rejects(
    fetchUnauthenticatedDescriptor(url, "different"),
    (error) =>
      error.diagnosis?.reason === "identity-mismatch" &&
      error.diagnosis.actualEnvironmentId === "remote-id" &&
      error.diagnosis.expectedEnvironmentId === "different",
  );
  body = { ...descriptor(), protocolVersion: 0 };
  await assert.rejects(
    fetchUnauthenticatedDescriptor(url),
    (error) => error.diagnosis?.reason === "outdated-daemon" && error.diagnosis.remoteProtocolVersion === 0,
  );
  body = { ...descriptor(), runtime: { nodeVersion: "22.23.3", payloadVersion: "new", startedAt: -1 } };
  await assert.rejects(fetchUnauthenticatedDescriptor(url), (error) => error.reason === "configuration");
  body = descriptor();
  await assert.rejects(
    fetchUnauthenticatedDescriptor(url, undefined, 1000, undefined, "a".repeat(64)),
    (error) => error.reason === "authentication",
  );
});

test("descriptor requests reject oversized responses and expose HTTP authentication failures as blocked", async (t) => {
  const oversized = await endpoint(t, (_request, response) => response.end("x".repeat(70000)));
  await assert.rejects(fetchUnauthenticatedDescriptor(oversized), (error) => error.reason === "configuration");
  const unauthorized = await endpoint(t, (_request, response) => {
    response.statusCode = 401;
    response.end();
  });
  await assert.rejects(fetchUnauthenticatedDescriptor(unauthorized), (error) => error.reason === "authentication");
});

test("a real daemon descriptor and authenticated WebSocket carry a complete ping round trip", async (t) => {
  const server = createRpcServer();
  server.handle({ "host.ping": async () => ({ ok: true, ts: 42 }) });
  const daemon = await startDaemonServer({
    rpcServer: server,
    getDescriptor: descriptor,
    authToken: "b".repeat(64),
    listenPort: 0,
  });
  t.after(() => daemon.close());
  const endpoint = {
    httpBaseUrl: `http://127.0.0.1:${daemon.port}`,
    wsUrl: `ws://127.0.0.1:${daemon.port}/rpc`,
    authToken: "b".repeat(64),
  };
  const found = await fetchUnauthenticatedDescriptor(
    endpoint.httpBaseUrl,
    "remote-id",
    1000,
    undefined,
    endpoint.authToken,
  );
  const connection = await openRemoteConnection(endpoint, found);
  t.after(() => connection.close());
  assert.deepEqual(await connection.rpc.call("host.ping"), { ok: true, ts: 42 });
});
