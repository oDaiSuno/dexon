import assert from "node:assert/strict";
import test from "node:test";
import { startDaemonServer } from "./daemon-server.ts";

test("the public descriptor proves possession of the token without receiving the token", async (t) => {
  const daemon = await startDaemonServer({
    rpcServer: { attachPort() {} },
    getDescriptor: () => ({ environmentId: "verified-environment" }),
    authToken: "a".repeat(64),
    listenPort: 0,
  });
  t.after(() => daemon.close());
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
