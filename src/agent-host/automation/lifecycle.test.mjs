import assert from "node:assert/strict";
import test from "node:test";
import { fixture, task, http, duration, localHttp, until } from "./runtime-test-support.mjs";

const idle = { executingRuns: 0, cancellingRuns: 0, activeProbes: 0 };

function heldSecrets() {
  const reads = [];
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  return {
    reads,
    release: () => release(),
    reader: {
      async read(name) {
        reads.push(name);
        await released;
        return "held-secret-value";
      },
    },
  };
}

test("a run counts as executing while its step is in flight and stops counting once it waits", async (t) => {
  const f = await fixture(t);
  const held = [];
  const endpoint = await localHttp(t, (_request, response) => held.push(response));
  await f.enable(task(f.cwd, [http("call", endpoint.origin), duration()]));
  assert.deepEqual(f.runtime.activity(), idle);
  const { runId } = f.start();
  try {
    await until(() => held.length === 1, "step request held by the endpoint");
    assert.deepEqual(f.runtime.activity(), { ...idle, executingRuns: 1 });
  } finally {
    for (const response of held) response.end();
  }
  await f.phase(runId, "waiting");
  assert.deepEqual(f.runtime.activity(), idle);
});

test("a cancelled run counts as cancelling until its step that ignores cancellation returns", async (t) => {
  const secrets = heldSecrets();
  const f = await fixture(t, { secretReader: secrets.reader });
  let cancelled;
  try {
    const endpoint = await localHttp(t, (_request, response) => response.end());
    await f.enable(task(f.cwd, [http("call", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
    const { runId } = f.start();
    await until(() => secrets.reads.length === 1, "step waiting on its secret");
    cancelled = f.runtime.cancelRun(runId);
    assert.deepEqual(f.runtime.activity(), { ...idle, executingRuns: 1, cancellingRuns: 1 });
  } finally {
    secrets.release();
    await cancelled;
  }
  assert.equal((await cancelled).phase, "cancelled");
  assert.deepEqual(f.runtime.activity(), idle);
});

function watchTask(cwd, origin, options = {}) {
  return task(cwd, [duration()], {
    triggers: [
      {
        id: "health",
        kind: "watch",
        every: "30s",
        probe: { action: "http.request", with: { url: { origin }, ...options } },
        mode: {
          type: "threshold",
          healthy: { ref: "probe.output.healthy", op: "eq", value: true },
          consecutive: 1,
          cooldown: "30m",
        },
      },
    ],
  });
}

test("a watch counts only its in-flight probe and leaves idle scheduled work at zero", async (t) => {
  const f = await fixture(t);
  const held = [];
  const endpoint = await localHttp(t, (_request, response) => held.push(response));
  await f.enable(watchTask(f.cwd, endpoint.origin));
  assert.deepEqual(f.runtime.activity(), idle);
  const tick = f.advance(30000);
  try {
    await until(() => held.length === 1, "watch request held by the endpoint");
    assert.deepEqual(f.runtime.activity(), { ...idle, activeProbes: 1 });
  } finally {
    for (const response of held) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"healthy":true}');
    }
    await tick;
  }
  assert.deepEqual(f.runtime.activity(), idle);
  assert.deepEqual(f.runtime.listRuns(), []);
});

async function within(promise, timeoutMs = 500) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Operation did not finish within its shutdown deadline")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("stop detaches a noncooperative watch probe before its secret reader is released", async (t) => {
  const secrets = heldSecrets();
  const f = await fixture(t, { secretReader: secrets.reader, limits: { probeStopGraceMs: 40 } });
  const endpoint = await localHttp(t, (_request, response) => response.end('{"healthy":true}'));
  await f.enable(watchTask(f.cwd, endpoint.origin, { secretHeaders: { Authorization: "api" } }));
  const tick = f.advance(30000).then(
    () => ({ ok: true }),
    (error) => ({ error }),
  );
  let stopping;
  try {
    await until(() => secrets.reads.length === 1, "probe waiting on its secret");
    stopping = f.runtime.stop();
    assert.deepEqual(f.runtime.activity(), { ...idle, activeProbes: 1 });
    await within(stopping);
    assert.deepEqual(f.runtime.status(), { kind: "stopped" });
    assert.deepEqual(f.runtime.activity(), idle);
  } finally {
    secrets.release();
    await stopping;
    await tick;
  }
  assert.deepEqual(await tick, { ok: true });
  assert.equal(endpoint.requests.length, 0);
});

for (const restart of [false, true]) {
  for (const outcome of ["success", "rejection"]) {
    test(`a noncooperative probe ${outcome} after ${restart ? "restart" : "store close"} cannot publish stale work`, async (t) => {
      const held = [];
      const endpoint = await localHttp(t, (_request, response) => held.push(response));
      const f = await fixture(t, {
        limits: { probeStopGraceMs: 40 },
        fetch: (url, init) => globalThis.fetch(url, { ...init, signal: undefined }),
      });
      await f.enable(watchTask(f.cwd, endpoint.origin));
      const tick = f.advance(30000).then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
      let stopping;
      const changes = [];
      let snapshot;
      try {
        await until(() => held.length === 1, "noncooperative watch request");
        stopping = f.runtime.stop();
        assert.deepEqual(f.runtime.activity(), { ...idle, activeProbes: 1 });
        await within(stopping);
        assert.deepEqual(f.runtime.activity(), idle);
        if (restart) {
          await f.runtime.start();
          f.runtime.disableTask("task");
          snapshot = f.runtime.listTasks();
        }
        f.runtime.subscribe((change) => changes.push(change));
      } finally {
        for (const response of held) {
          if (outcome === "rejection") response.destroy();
          else {
            response.writeHead(200, { "content-type": "application/json" });
            response.end('{"healthy":false}');
          }
        }
        await stopping;
        await within(tick);
      }
      assert.deepEqual(await tick, { ok: true });
      assert.deepEqual(changes, []);
      assert.deepEqual(f.errors, []);
      assert.deepEqual(f.runtime.activity(), idle);
      if (restart) {
        assert.deepEqual(f.runtime.listTasks(), snapshot);
        assert.deepEqual(f.runtime.listRuns(), []);
        await f.advance(30000);
        assert.equal(endpoint.requests.length, 1);
      } else assert.deepEqual(f.runtime.status(), { kind: "stopped" });
    });
  }
}

test("stop detaches a noncooperative driver and its late completion cannot change a recovered run", async (t) => {
  const secrets = heldSecrets();
  const f = await fixture(t, { secretReader: secrets.reader, limits: { shutdownGraceMs: 40 } });
  const endpoint = await localHttp(t, (_request, response) => response.end());
  await f.enable(task(f.cwd, [http("call", endpoint.origin, { secretHeaders: { Authorization: "api" } })]));
  const { runId } = f.start();
  let snapshot;
  const changes = [];
  try {
    await until(() => secrets.reads.length === 1, "driver waiting on its secret");
    const stopping = f.runtime.stop();
    assert.deepEqual(f.runtime.activity(), { ...idle, executingRuns: 1 });
    await within(stopping);
    assert.deepEqual(f.runtime.activity(), idle);
    await f.runtime.start();
    snapshot = f.runtime.getRun(runId);
    f.runtime.subscribe((change) => changes.push(change));
  } finally {
    secrets.release();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(f.runtime.getRun(runId), snapshot);
  assert.deepEqual(changes, []);
  assert.deepEqual(f.errors, []);
});

test("I1 an Asia Shanghai morning cron fires at exact UTC midnight under a UTC process timezone", async (t) => {
  const previousTZ = process.env.TZ;
  t.after(() => {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  });
  process.env.TZ = "UTC";
  const f = await fixture(t, { startAtMs: 1767311940000 });
  await f.enable(
    task(f.cwd, [duration()], {
      triggers: [{ id: "morning", kind: "schedule", cron: "0 8 * * *", tz: "Asia/Shanghai" }],
    }),
  );
  assert.deepEqual(f.runtime.activity(), idle);
  await f.advance(59999);
  assert.deepEqual(f.runtime.listRuns(), []);
  await f.advance(1);
  const runs = f.runtime.listRuns();
  assert.equal(runs.length, 1);
  await f.phase(runs[0].id, "waiting");
  assert.deepEqual(f.runtime.getRun(runs[0].id).triggerFact, {
    kind: "schedule",
    triggerId: "morning",
    firedAtMs: 1767312000000,
    scheduledForMs: 1767312000000,
    late: false,
  });
  assert.deepEqual(f.runtime.activity(), idle);
  await f.runtime.tickNow();
  assert.equal(f.runtime.listRuns().length, 1);
});

test("activity counts every durable cancellation beyond the default run page", async (t) => {
  const count = 60;
  const secrets = heldSecrets();
  const f = await fixture(t, { secretReader: secrets.reader, limits: { maxConcurrentDrivers: count } });
  let cancelled;
  try {
    const endpoint = await localHttp(t, (_request, response) => response.end());
    await f.enable(
      task(f.cwd, [http("call", endpoint.origin, { secretHeaders: { Authorization: "api" } })], {
        concurrency: { maxExecuting: count },
      }),
    );
    const runs = Array.from({ length: count }, () => f.start());
    await until(() => secrets.reads.length === count, "all drivers waiting on secrets");
    cancelled = Promise.all(runs.map(({ runId }) => f.runtime.cancelRun(runId)));
    assert.deepEqual(f.runtime.activity(), { ...idle, executingRuns: count, cancellingRuns: count });
  } finally {
    secrets.release();
    await cancelled;
  }
  const completed = await cancelled;
  assert.equal(completed.length, count);
  assert.equal(
    completed.every((run) => run.phase === "cancelled"),
    true,
  );
  assert.deepEqual(f.runtime.activity(), idle);
});
