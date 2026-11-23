import assert from "node:assert/strict";
import test from "node:test";
import { fixture, task, http, localHttp, until } from "./runtime-test-support.mjs";

test("activity counts 10001 simultaneous cancellations sharing one timestamp", { timeout: 120000 }, async (t) => {
  const count = 10001;
  let release;
  let reads = 0;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, {
    limits: { maxConcurrentDrivers: count },
    secretReader: {
      async read() {
        reads++;
        await held;
        return "held-value";
      },
    },
  });
  const endpoint = await localHttp(t, (_request, response) => response.end());
  let cancelled;
  try {
    await f.enable(
      task(f.cwd, [http("call", endpoint.origin, { secretHeaders: { Authorization: "api" } })], {
        concurrency: { maxExecuting: count },
      }),
    );
    const runs = Array.from({ length: count }, () => f.start());
    await until(() => reads === count, "all drivers waiting on external secret reader", 90000);
    cancelled = Promise.all(runs.map(({ runId }) => f.runtime.cancelRun(runId)));
    assert.deepEqual(f.runtime.activity(), { executingRuns: count, cancellingRuns: count, activeProbes: 0 });
  } finally {
    release();
    await cancelled;
  }
});
