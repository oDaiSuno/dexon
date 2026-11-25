import { createDeferred } from "#test-timing";
import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { loadRenderer, restoreGlobals } from "../../../tests/support/renderer.mjs";

const api = await loadRenderer(
  "codemode-settings-client",
  'export * from "./src/renderer/lib/codemode-settings.ts"; export {getEnvironmentConnection} from "./src/renderer/lib/environment-registry.ts"; export {createRpcServer} from "./src/contract/rpc.ts"; export {RpcError} from "./src/contract/types.ts";',
);
after(restoreGlobals);
beforeEach(() => api.resetCodemodeSettingsCache());

const defaults = {
  enabled: true,
  mode: "on",
  configPath: "/home/dev/.pi/agent/settings.json",
  availability: { available: true },
  projectOverride: null,
};

function host(t, environmentId, get, set = () => defaults) {
  const server = api.createRpcServer();
  server.handle({ "codemode.get": get, "codemode.set": set });
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const connection = api.getEnvironmentConnection(environmentId);
  connection.replacePort(port2);
  t.after(() => {
    connection.close();
    server.detachPort(port1);
    port1.close();
    port2.close();
  });
}

test("loading settings returns the selected environment and project result through the RPC contract", async (t) => {
  const project = { ...defaults, projectOverride: { filePath: "/code/a/.pi/settings.json", mode: "only" } };
  host(t, "alpha", (params) => {
    assert.deepEqual(params, { cwd: "/code/a" });
    return project;
  });
  const result = await api.loadCodemodeSettings("alpha", "/code/a");
  assert.deepEqual(result, { status: "ready", settings: project });
});

test("cached settings stay separate for each environment and project until reset", async (t) => {
  let enabled = true;
  host(t, "alpha", (params) => ({ ...defaults, enabled, mode: params?.cwd === "/b" ? "only" : "on" }));
  host(t, "beta", () => ({ ...defaults, enabled: false }));
  assert.deepEqual(await api.loadCodemodeSettings("alpha", "/a"), { status: "ready", settings: defaults });
  enabled = false;
  assert.deepEqual(await api.loadCodemodeSettings("alpha", "/a"), { status: "ready", settings: defaults });
  assert.equal((await api.loadCodemodeSettings("alpha", "/b")).settings.mode, "only");
  assert.equal((await api.loadCodemodeSettings("beta", "/a")).settings.enabled, false);
  api.resetCodemodeSettingsCache();
  assert.equal((await api.loadCodemodeSettings("alpha", "/a")).settings.enabled, false);
});

test("concurrent readers share one result while a reset prevents late results from repopulating the cache", async (t) => {
  const response = createDeferred();
  const arrived = createDeferred();
  let current = response.promise;
  host(t, "alpha", (params) => {
    assert.equal(params, undefined);
    arrived.resolve();
    return current;
  });
  const first = api.loadCodemodeSettings("alpha");
  const second = api.loadCodemodeSettings("alpha");
  await arrived.promise;
  api.resetCodemodeSettingsCache();
  current = { ...defaults, enabled: false };
  response.resolve(defaults);
  assert.equal((await first).settings.enabled, true);
  assert.deepEqual(await second, { status: "ready", settings: defaults });
  assert.equal((await api.loadCodemodeSettings("alpha")).settings.enabled, false);
});

test("global saves invalidate all project caches without borrowing another project's override", async (t) => {
  let enabled = true;
  host(
    t,
    "alpha",
    (params) => ({
      ...defaults,
      enabled,
      projectOverride: params?.cwd === "/b" ? { filePath: "/b/.pi/settings.json", mode: "only" } : null,
    }),
    (patch) => {
      assert.deepEqual(patch, { enabled: false, cwd: "/a" });
      enabled = patch.enabled;
      return { ...defaults, enabled };
    },
  );
  await api.loadCodemodeSettings("alpha", "/a");
  await api.loadCodemodeSettings("alpha", "/b");
  const saved = await api.saveCodemodeSettings("alpha", { enabled: false, cwd: "/a" });
  assert.equal(saved.enabled, false);
  assert.equal((await api.loadCodemodeSettings("alpha", "/a")).settings.enabled, false);
  assert.deepEqual((await api.loadCodemodeSettings("alpha", "/b")).settings, {
    ...defaults,
    enabled: false,
    projectOverride: { filePath: "/b/.pi/settings.json", mode: "only" },
  });
});

test("late reads from another cwd cannot restore pre-save cache data and unrelated environments remain cached", async (t) => {
  const stale = createDeferred();
  const arrived = createDeferred();
  let saved = false;
  host(
    t,
    "alpha",
    () => {
      if (saved) return { ...defaults, enabled: false };
      arrived.resolve();
      return stale.promise;
    },
    () => {
      saved = true;
      return { ...defaults, enabled: false };
    },
  );
  let beta = defaults;
  host(t, "beta", () => beta);
  await api.loadCodemodeSettings("beta", "/b");
  beta = { ...defaults, mode: "only" };
  const old = api.loadCodemodeSettings("alpha", "/b");
  await arrived.promise;
  await api.saveCodemodeSettings("alpha", { enabled: false, cwd: "/a" });
  stale.resolve(defaults);
  await old;
  assert.equal((await api.loadCodemodeSettings("alpha", "/b")).settings.enabled, false);
  assert.equal((await api.loadCodemodeSettings("beta", "/b")).settings.mode, "on");
});

test("reads made during a global save do not remain cached after that save finishes", async (t) => {
  const write = createDeferred();
  const arrived = createDeferred();
  let enabled = true;
  host(
    t,
    "alpha",
    () => ({ ...defaults, enabled }),
    () => {
      arrived.resolve();
      return write.promise.then(() => {
        enabled = false;
        return { ...defaults, enabled };
      });
    },
  );
  const saving = api.saveCodemodeSettings("alpha", { enabled: false, cwd: "/a" });
  await arrived.promise;
  assert.equal((await api.loadCodemodeSettings("alpha", "/b")).settings.enabled, true);
  write.resolve();
  await saving;
  assert.equal((await api.loadCodemodeSettings("alpha", "/b")).settings.enabled, false);
});

test("unsupported hosts are distinguished from retryable load failures", async (t) => {
  host(t, "legacy", () => {
    throw new api.RpcError({ code: "METHOD_NOT_FOUND", message: "Unknown method" });
  });
  let fail = true;
  host(t, "alpha", () => {
    if (fail) throw new Error("Permission denied");
    return defaults;
  });
  assert.deepEqual(await api.loadCodemodeSettings("legacy"), { status: "unsupported" });
  assert.deepEqual(await api.loadCodemodeSettings("alpha"), { status: "error", message: "Permission denied" });
  fail = false;
  assert.deepEqual(await api.loadCodemodeSettings("alpha"), { status: "ready", settings: defaults });
});
