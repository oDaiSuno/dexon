import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import test from "node:test";
import { clearInterval, setInterval } from "node:timers";
import { fileURLToPath } from "node:url";
import { importTestBundle } from "#test-bundle";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = mkdtempSync(path.join(tmpdir(), "dexon-model-catalog-"));
const agentDir = path.join(directory, "agent");
const project = path.join(directory, "project");
mkdirSync(agentDir, { recursive: true });
mkdirSync(path.join(project, ".pi", "extensions"), { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(agentDir, "sessions");
process.env.PI_OFFLINE = "1";
const { registerModelHandlers } = await importTestBundle(
  "model-catalog-handlers",
  {
    absWorkingDir: root,
    entryPoints: ["src/agent-host/handlers/models.ts"],
    packages: "external",
  },
  { companions: { "model-catalog-worker.mjs": "src/agent-host/model-catalog/catalog-worker.ts" } },
);
const handlers = {};
const dispose = registerModelHandlers({
  handle(next) {
    Object.assign(handlers, next);
  },
});
test.after(async () => {
  await dispose();
  rmSync(directory, { recursive: true, force: true });
});

const slowKey = "!node -e \"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3000); console.log('sk-test')\"";
writeFileSync(
  path.join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      "slow-catalog": {
        api: "openai-completions",
        baseUrl: "https://catalog.invalid/v1",
        apiKey: slowKey,
        headers: { Authorization: "Bearer secret-catalog-header" },
        models: [{ id: "slow-chat", name: "Slow chat", reasoning: true, input: ["text", "image"] }],
      },
    },
  }),
);
writeFileSync(
  path.join(project, ".pi", "extensions", "resolve-key.ts"),
  `import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
export default async function () {
  const runtime = await ModelRuntime.create();
  const auth = await runtime.getAuth("slow-catalog");
  if (auth?.auth.apiKey !== "sk-test") throw new Error("Command-backed key was not resolved");
  writeFileSync(${JSON.stringify(path.join(directory, "key-resolved"))}, "resolved");
}
`,
);

test("models.list resolves a slow command-backed key while caller timers remain responsive", async (t) => {
  const lag = monitorEventLoopDelay({ resolution: 1 });
  let ticks = 0;
  let lastTick = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - lastTick);
    lastTick = now;
    ticks += 1;
  }, 5);
  lag.enable();
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    lag.reset();
    ticks = 0;
    maxGap = 0;
    lastTick = performance.now();
    const started = performance.now();
    const result = await handlers["models.list"]({ cwd: project });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const durationMs = performance.now() - started;
    const lagMs = lag.max / 1e6;
    t.diagnostic(JSON.stringify({ durationMs, lagMs, maxGap, ticks }));
    assert.equal(readFileSync(path.join(directory, "key-resolved"), "utf8"), "resolved");
    assert.ok(durationMs >= 3000, "the slow command must actually run inside the measured request");
    assert.deepEqual(
      result.models.find((model) => model.provider === "slow-catalog"),
      {
        id: "slow-chat",
        name: "Slow chat",
        provider: "slow-catalog",
        input: ["text", "image"],
      },
    );
    assert.doesNotMatch(JSON.stringify(result), /sk-test|secret-catalog-header|Authorization/);
    assert.ok(ticks >= 50, `concurrent timers fired only ${ticks} times`);
    assert.ok(lagMs < 100, `caller event-loop lag reached ${lagMs}ms`);
    assert.ok(maxGap < 100, `caller timer gap reached ${maxGap}ms`);
  } finally {
    lag.disable();
    clearInterval(timer);
  }
});

test("a second models.list for the same cwd and epoch returns from memory in under 25ms", async (t) => {
  const started = performance.now();
  const result = await handlers["models.list"]({ cwd: project });
  const cachedMs = performance.now() - started;
  t.diagnostic(JSON.stringify({ cachedMs }));
  assert.ok(result.models.some((model) => model.provider === "slow-catalog" && model.id === "slow-chat"));
  assert.ok(cachedMs < 25, `cached model list took ${cachedMs}ms`);
});

const { ModelCatalogService } = await importTestBundle(
  "model-catalog-service",
  {
    absWorkingDir: root,
    entryPoints: ["src/agent-host/model-catalog/index.ts"],
    packages: "external",
  },
  { companions: { "model-catalog-worker.mjs": "src/agent-host/model-catalog/catalog-worker.ts" } },
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function snapshot(cwd, id = "first") {
  return {
    cwd,
    models: [{ id, name: id, provider: "fixture", reasoning: false }],
    providerIds: ["fixture"],
    warnings: [],
    status: { source: "cache", refreshed: false, aborted: false, warnings: [] },
    builtAt: 1,
  };
}

function serviceFixture(t, run, options = {}) {
  let epoch = { key: "first", credentials: "same-auth" };
  const service = new ModelCatalogService({
    run,
    epochOf: () => epoch,
    agentDir: () => agentDir,
    offline: () => false,
    ...options,
  });
  t.after(() => service.dispose());
  return { service, changeEpoch: (next) => (epoch = next) };
}

test("concurrent cold reads for one cwd and epoch share one isolated job", async (t) => {
  const started = deferred();
  const completed = deferred();
  let jobs = 0;
  const { service } = serviceFixture(t, async (job) => {
    jobs += 1;
    started.resolve();
    await completed.promise;
    return snapshot(job.cwd);
  });
  const reads = Array.from({ length: 12 }, () => service.get(project));
  await started.promise;
  completed.resolve();
  const results = await Promise.all(reads);
  assert.equal(jobs, 1);
  assert.ok(results.every((result) => result.models[0].id === "first"));
});

test("a changed extension epoch serves previous models while forced reads wait for fresh models", async (t) => {
  const started = deferred();
  const completed = deferred();
  let jobs = 0;
  const { service, changeEpoch } = serviceFixture(t, async (job) => {
    if (++jobs === 1) return snapshot(job.cwd);
    started.resolve();
    await completed.promise;
    return snapshot(job.cwd, "updated");
  });
  await service.get(project);
  changeEpoch({ key: "second", credentials: "same-auth" });
  assert.equal((await service.get(project)).models[0].id, "first");
  await started.promise;
  assert.equal((await service.get(project)).models[0].id, "first");
  let freshResolved = false;
  const fresh = service.get(project, { fresh: true }).then((value) => {
    freshResolved = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(freshResolved, false);
  completed.resolve();
  assert.equal((await fresh).models[0].id, "updated");
  assert.equal((await service.get(project)).models[0].id, "updated");
  assert.equal(jobs, 2);
});

test("credential or model configuration mutations never return a stale availability snapshot", async (t) => {
  const started = deferred();
  const completed = deferred();
  let jobs = 0;
  const { service, changeEpoch } = serviceFixture(t, async (job) => {
    if (++jobs === 1) return snapshot(job.cwd);
    started.resolve();
    await completed.promise;
    return snapshot(job.cwd, "new-credentials");
  });
  await service.get(project);
  changeEpoch({ key: "second", credentials: "changed-auth" });
  let resolved = false;
  const fresh = service.get(project).then((value) => {
    resolved = true;
    return value;
  });
  await started.promise;
  assert.equal(resolved, false);
  completed.resolve();
  assert.equal((await fresh).models[0].id, "new-credentials");
});

test("failed background revalidation preserves previous models and retries after its backoff", async (t) => {
  let now = 1;
  let jobs = 0;
  const { service, changeEpoch } = serviceFixture(
    t,
    async (job) => {
      jobs += 1;
      if (jobs === 2) throw new Error("catalog build failed");
      return snapshot(job.cwd, jobs === 1 ? "first" : "retried");
    },
    { now: () => now, failureBackoffMs: 10 },
  );
  await service.get(project);
  changeEpoch({ key: "second", credentials: "same-auth" });
  assert.equal((await service.get(project)).models[0].id, "first");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await service.get(project)).models[0].id, "first");
  await assert.rejects(service.get(project, { fresh: true }), /catalog build failed/);
  assert.equal(jobs, 2);
  now = 12;
  assert.equal((await service.get(project, { fresh: true })).models[0].id, "retried");
});

test("least-recently-used ready catalogs are evicted when the cache reaches its bound", async (t) => {
  let jobs = 0;
  const { service } = serviceFixture(t, async (job) => snapshot(job.cwd, `build-${++jobs}`), { maxEntries: 2 });
  const second = path.join(directory, "second");
  const third = path.join(directory, "third");
  await service.get(project);
  await service.get(second);
  assert.equal((await service.get(project)).models[0].id, "build-1");
  await service.get(third);
  assert.equal((await service.get(project)).models[0].id, "build-1");
  assert.equal((await service.get(second)).models[0].id, "build-4");
});

function abortableJob(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("explicit refresh waits for new models instead of returning a cached catalog", async (t) => {
  const started = deferred();
  const completed = deferred();
  const { service } = serviceFixture(t, async (job) => {
    if (job.kind === "available") return snapshot(job.cwd);
    started.resolve();
    await completed.promise;
    return {
      ...snapshot(job.cwd, "refreshed"),
      status: { source: "network", refreshed: true, aborted: false, warnings: [] },
    };
  });
  await service.get(project);
  let resolved = false;
  const pending = service.refresh(project, "fresh").then((value) => {
    resolved = true;
    return value;
  });
  await started.promise;
  assert.equal(resolved, false);
  completed.resolve();
  const result = await pending;
  assert.equal(result.models[0].id, "refreshed");
  assert.deepEqual(result.status, { source: "network", refreshed: true, aborted: false, warnings: [] });
});

test("cancelling a refresh aborts its worker and returns the last ready models", async (t) => {
  const started = deferred();
  const { service } = serviceFixture(t, async (job, signal) => {
    if (job.kind === "available") return snapshot(job.cwd);
    started.resolve();
    return abortableJob(signal);
  });
  await service.get(project);
  const pending = service.refresh(project, "cancel");
  await started.promise;
  assert.equal(service.cancelRefresh("cancel"), true);
  const result = await pending;
  assert.equal(result.models[0].id, "first");
  assert.deepEqual(result.status, { source: "network", refreshed: false, aborted: true, warnings: [] });
  assert.equal(service.cancelRefresh("cancel"), false);
  assert.equal((await service.get(project)).models[0].id, "first");
});

test("a replacement refresh aborts the older request without overwriting the new catalog", async (t) => {
  const started = deferred();
  let refreshes = 0;
  const { service } = serviceFixture(t, async (job, signal) => {
    if (job.kind === "available") return snapshot(job.cwd);
    if (++refreshes > 1) return snapshot(job.cwd, "replacement");
    started.resolve();
    return abortableJob(signal);
  });
  await service.get(project);
  const first = service.refresh(project, "first");
  await started.promise;
  const second = service.refresh(project, "second");
  assert.equal((await first).status.aborted, true);
  assert.equal((await second).models[0].id, "replacement");
  assert.equal((await service.get(project)).models[0].id, "replacement");
});

test("refresh timeouts preserve cached models and return the existing timeout warning", async (t) => {
  const { service } = serviceFixture(
    t,
    async (job, signal) => (job.kind === "available" ? snapshot(job.cwd) : abortableJob(signal)),
    { refreshTimeoutMs: 10 },
  );
  await service.get(project);
  const result = await service.refresh(project, "timeout");
  assert.equal(result.models[0].id, "first");
  assert.deepEqual(result.status, {
    source: "network",
    refreshed: false,
    aborted: true,
    warnings: [
      {
        provider: "*",
        code: "MODEL_REFRESH_TIMEOUT",
        message: "Model catalog refresh timed out after 10ms; cached models remain available.",
      },
    ],
  });
});

test("disposing the catalog aborts active isolated jobs and prevents further reads", async (t) => {
  const started = deferred();
  const { service } = serviceFixture(t, async (_, signal) => {
    started.resolve();
    return abortableJob(signal);
  });
  const rejected = assert.rejects(
    service.get(project),
    (error) => error.code === "CLOSED" && /disposed/.test(error.message),
  );
  await started.promise;
  await service.dispose();
  await rejected;
  await assert.rejects(service.get(project), (error) => error.code === "CLOSED" && /disposed/.test(error.message));
});

test("returning to a previously cached cwd and epoch reuses that exact snapshot", async (t) => {
  let jobs = 0;
  const { service, changeEpoch } = serviceFixture(t, async (job) => snapshot(job.cwd, `build-${++jobs}`));
  await service.get(project);
  changeEpoch({ key: "second", credentials: "same-auth" });
  assert.equal((await service.get(project, { fresh: true })).models[0].id, "build-2");
  changeEpoch({ key: "first", credentials: "same-auth" });
  assert.equal((await service.get(project)).models[0].id, "build-1");
  assert.equal(jobs, 2);
});

test("source workers isolate project providers, strip secrets, and detect edits to nested extension files", async (t) => {
  const first = path.join(directory, "isolated-first");
  const second = path.join(directory, "isolated-second");
  const extension = path.join(first, ".pi", "extensions", "provider", "index.ts");
  mkdirSync(path.dirname(extension), { recursive: true });
  mkdirSync(second, { recursive: true });
  const writeExtension = (id) =>
    writeFileSync(
      extension,
      `export default function (pi) {
  process.env.DEXON_CATALOG_LEAK = "project-secret";
  pi.registerProvider("project-only", {
    api: "openai-completions", baseUrl: "https://private.invalid/v1", apiKey: "project-secret",
    headers: { Authorization: "Bearer extension-secret" },
    models: [{ id: ${JSON.stringify(id)}, name: "Project model", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 1000 }]
  });
}
`,
    );
  writeExtension("original");
  const service = new ModelCatalogService();
  t.after(() => service.dispose());
  const a = await service.get(first);
  const b = await service.get(second);
  assert.equal(a.models.find((model) => model.provider === "project-only")?.id, "original");
  assert.equal(
    b.models.some((model) => model.provider === "project-only"),
    false,
  );
  assert.equal(process.env.DEXON_CATALOG_LEAK, undefined);
  assert.doesNotMatch(
    JSON.stringify(a),
    /project-secret|extension-secret|Authorization|private\.invalid|apiKey|headers/,
  );
  writeExtension("updated-longer");
  assert.equal((await service.get(first)).models.find((model) => model.provider === "project-only")?.id, "original");
  const updated = await service.get(first, { fresh: true });
  assert.equal(updated.models.find((model) => model.provider === "project-only")?.id, "updated-longer");
  assert.equal(
    (await service.get(second)).models.some((model) => model.provider === "project-only"),
    false,
  );
});

test("an older build completing late cannot replace the newest cwd catalog", async (t) => {
  const completed = deferred();
  let jobs = 0;
  const { service, changeEpoch } = serviceFixture(t, async (job) => {
    if (++jobs === 1) {
      await completed.promise;
      return snapshot(job.cwd, "old");
    }
    return snapshot(job.cwd, "new");
  });
  const first = service.get(project);
  await new Promise((resolve) => setImmediate(resolve));
  changeEpoch({ key: "new", credentials: "same-auth" });
  assert.equal((await service.get(project)).models[0].id, "new");
  completed.resolve();
  assert.equal((await first).models[0].id, "old");
  changeEpoch({ key: "third", credentials: "same-auth" });
  assert.equal((await service.get(project)).models[0].id, "new");
});

test("cancelling a cold refresh reports cancellation when no complete catalog is available", async (t) => {
  const started = deferred();
  const { service } = serviceFixture(t, async (_, signal) => {
    started.resolve();
    return abortableJob(signal);
  });
  const pending = assert.rejects(
    service.refresh(project, "cold"),
    (error) => error.name === "ModelCatalogRefreshAbortedError" && error.kind === "cancelled",
  );
  await started.promise;
  assert.equal(service.cancelRefresh("cold"), true);
  await pending;
  assert.equal(service.cancelRefresh("cold"), false);
});

test("a catalog bundle never executes a worker found through the caller's current directory", async (t) => {
  const { ModelCatalogService: UnaccompaniedCatalog } = await importTestBundle("catalog-without-worker", {
    absWorkingDir: root,
    entryPoints: ["src/agent-host/model-catalog/index.ts"],
    packages: "external",
  });
  const catalog = new UnaccompaniedCatalog({ agentDir: () => agentDir, offline: () => true });
  t.after(() => catalog.dispose());
  await assert.rejects(catalog.get(project), /Model catalog worker is unavailable in /);
});

test("catalog worker crashes preserve the real diagnostic rather than a fixed failure", async () => {
  const { runIsolatedNodeJob } = await import("../isolated-node-job.ts");
  const { url } = await importTestBundle(
    "catalog-crash",
    {
      stdin: { contents: "export const url = import.meta.url;", loader: "js" },
    },
    { companions: { "model-catalog-worker.mjs": "src/agent-host/model-catalog/catalog-worker.ts" } },
  );
  await assert.rejects(
    runIsolatedNodeJob({
      entryPath: fileURLToPath(new URL("model-catalog-worker.mjs", url)),
      input: {},
      marker: "PI_DESKTOP_MODEL_CATALOG_RESULT:",
      timeoutMs: 10000,
      maxInputBytes: 1024,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    }),
    /Invalid model catalog job/,
  );
});
