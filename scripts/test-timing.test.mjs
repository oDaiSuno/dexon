import assert from "node:assert/strict";
import test from "node:test";
import { createManualScheduler } from "./test-timing.mjs";

test("controlled time delivers a callback at its deadline, never before", async () => {
  const clock = createManualScheduler();
  const delivered = [];
  clock.setTimeout(() => delivered.push("due"), 4000);
  await clock.advanceBy(3999);
  assert.deepEqual(delivered, []);
  await clock.advanceBy(1);
  assert.deepEqual(delivered, ["due"]);
});
