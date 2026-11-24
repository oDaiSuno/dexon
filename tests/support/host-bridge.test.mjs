import assert from "node:assert/strict";
import test from "node:test";
import { installHostBridge } from "./host-bridge.mjs";

test("the desktop Host fixture delivers the connected primary generation so bootstrap does not reconnect to its closed port", async (t) => {
  const target = {
    piBridge: {
      listEnvironments: async () => ({
        revision: 1,
        environments: [{ id: "primary", status: { phase: "connected", generation: 7, since: 0 } }],
      }),
    },
  };
  const boundary = installHostBridge(target);
  t.after(() => boundary.close());
  const delivered = new Promise((resolve) => target.addEventListener("message", resolve));
  target.piBridge.requestHostPort();
  const event = await delivered;
  assert.deepEqual(event.data, { channel: "dexon-host-port", environmentId: "primary", generation: 7 });
  assert.equal(event.source, target);
  assert.equal(event.ports.length, 1);
});
