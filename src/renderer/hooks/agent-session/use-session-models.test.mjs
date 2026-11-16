import assert from "node:assert/strict";
import test from "node:test";

import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

const MODEL_LIST = {
  models: [
    { provider: "p", id: "alpha", name: "Alpha" },
    { provider: "p", id: "beta", name: "Beta" },
  ],
  nameMap: {},
  thinkingLevels: { "p:alpha": ["low", "high"] },
  thinkingLevelMaps: { "p:alpha": { low: "Low" } },
  catalog: { source: "host", refreshed: true, aborted: false, warnings: [] },
  defaultModel: { provider: "p", modelId: "beta" },
};

test("the model directory loads into every derived shape", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail, listModels: async () => MODEL_LIST });
  const h = await createSessionHookHarness(t, { bundleName: "models-load", host });

  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  assert.equal(h.state.modelList.length, 2);
  assert.deepEqual(h.state.modelNames, { "p:alpha": "Alpha", "p:beta": "Beta" }, "name map falls back to list names");
  assert.deepEqual(h.state.modelThinkingLevels, { "p:alpha": ["low", "high"] });
  assert.equal(h.state.modelCatalog.source, "host");
});

test("a fresh session picks the host default model for display", async (t) => {
  const host = createSessionTestHost({ listModels: async () => MODEL_LIST });
  const h = await createSessionHookHarness(t, { bundleName: "models-new", host });

  await h.mount({ session: null, newSessionCwd: "/fixture" });
  await h.flush();

  assert.deepEqual(h.state.displayModel, { provider: "p", modelId: "beta" });
  assert.equal(h.state.isAutoModelSelection, true, "without a user pick the display stays on auto");
});

test("an aborted model load applies nothing", async (t) => {
  const detail = createSessionDetail("s-1");
  const slowList = { ...MODEL_LIST, models: [{ provider: "p", id: "slow-alpha", name: "Slow Alpha" }] };
  let resolveList;
  let listCalls = 0;
  const host = createSessionTestHost({
    getSession: async () => detail,
    listModels: () => {
      listCalls += 1;
      if (listCalls === 1) return new Promise((resolve) => (resolveList = resolve));
      return Promise.resolve(MODEL_LIST);
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "models-abort", host });
  await h.mount({ session: detail.info, newSessionCwd: null, modelsRefreshKey: 1 });
  await h.flush();
  assert.equal(h.state.modelList.length, 0, "the first load is still in flight");

  await h.update({ session: detail.info, newSessionCwd: null, modelsRefreshKey: 2 });
  await h.flush();
  assert.equal(h.state.modelList.length, 2, "the second load applied");

  resolveList(slowList);
  await h.flush();
  assert.equal(h.state.modelList.length, 2, "the aborted response never reached the state");
  assert.ok(!h.state.modelList.some((m) => m.id === "slow-alpha"), "the stale list is not visible");
});

test("a new load cancels an in-flight manual refresh", async (t) => {
  const detail = createSessionDetail("s-1");
  const cancelCalls = [];
  let firstRefreshId;
  let listLoads = 0;
  const host = createSessionTestHost({
    getSession: async () => detail,
    listModels: async () => {
      listLoads += 1;
      return MODEL_LIST;
    },
    async refreshModels(cwd, requestId) {
      firstRefreshId = requestId;
      return new Promise(() => {});
    },
    cancelModelsRefresh: async (requestId) => {
      cancelCalls.push(requestId);
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "models-refresh-cancel", host });
  await h.mount({ session: detail.info, newSessionCwd: null, modelsRefreshKey: 1 });
  await h.flush();

  const refreshPromise = h.state.refreshModels();
  await h.flush();
  assert.equal(h.state.modelRefreshing, true);

  await h.update({ session: detail.info, newSessionCwd: null, modelsRefreshKey: 2 });
  await h.flush();
  refreshPromise.catch(() => {});
  assert.deepEqual(cancelCalls, [firstRefreshId], "the superseded refresh was cancelled by request id");
  assert.equal(h.state.modelRefreshing, false, "refresh indicator released");
  assert.equal(h.state.modelList.length, 2, "the reloaded list applied");
  assert.ok(listLoads >= 2, "both loads reached the host");
});

test("a failed refresh keeps the cached list and reports the failure", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({
    getSession: async () => detail,
    listModels: async () => MODEL_LIST,
    refreshModels: async () => {
      throw new Error("refresh failed");
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "models-refresh-fail", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  await h.act(() => h.state.refreshModels());
  await h.flush();
  assert.equal(h.state.modelList.length, 2, "cached models retained");
  assert.ok(
    h.state.notices.some((n) => n.type === "error" && n.message.includes("refresh")),
    "failure notice shown",
  );
  assert.equal(h.state.modelRefreshing, false);
  assert.equal(h.state.modelLoadError, "refresh failed");
});

test("an initial model-directory failure is visible when no cached models exist", async (t) => {
  const detail = createSessionDetail("initial-model-failure");
  const host = createSessionTestHost({
    getSession: async () => detail,
    listModels: async () => {
      throw new Error("directory unavailable");
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "initial-model-failure", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.modelList.length, 0);
  assert.equal(h.state.modelLoadError, "directory unavailable");
  assert.equal(h.state.modelLoading, false);
  assert.ok(
    h.state.notices.some((n) => n.type === "warning" && n.message.includes("Unable to load the model directory.")),
  );
});

test("a failed model-directory reload preserves the usable cached choices and reports it", async (t) => {
  const detail = createSessionDetail("cached-model-failure");
  let unavailable = false;
  const host = createSessionTestHost({
    getSession: async () => detail,
    listModels: async () => {
      if (unavailable) throw new Error("directory unavailable");
      return MODEL_LIST;
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "cached-model-failure", host });
  const options = { session: detail.info, newSessionCwd: null, modelsRefreshKey: 0 };
  await h.mount(options);
  await h.flush();
  unavailable = true;
  await h.update({ ...options, modelsRefreshKey: 1 });
  await h.flush();
  assert.equal(h.state.modelList.length, 2);
  assert.ok(h.state.notices.some((n) => n.type === "warning" && n.message.includes("Cached models remain available")));
});

test("an abandoned initial model load cannot show an error in the following session", async (t) => {
  let rejectOld;
  let loads = 0;
  const detail = createSessionDetail("model-cancel");
  const host = createSessionTestHost({
    getSession: async () => detail,
    listModels: () =>
      ++loads === 1
        ? new Promise((_, reject) => {
            rejectOld = reject;
          })
        : Promise.resolve(MODEL_LIST),
  });
  const h = await createSessionHookHarness(t, { bundleName: "cancel-initial-models", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  await h.remount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  await h.act(async () => rejectOld(new Error("abandoned directory request")));
  await h.flush();
  assert.equal(h.state.modelList.length, 2);
  assert.deepEqual(h.state.notices, []);
});

test("a session switch at the same location immediately shows the last successful catalog while loading live models", async (t) => {
  let pending = false;
  let finish;
  const host = createSessionTestHost({
    listModels: () =>
      pending
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(MODEL_LIST),
  });
  const h = await createSessionHookHarness(t, { bundleName: "models-location-cache", host });
  const options = { session: null, newSessionCwd: "/shared" };
  await h.mount(options);
  await h.flush();
  pending = true;
  await h.remount(options);
  await h.flush();
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["alpha", "beta"],
  );
  assert.equal(h.state.modelLoading, true);
  assert.equal(h.state.displayModel, null);
  await h.act(async () => finish({ ...MODEL_LIST, models: [{ provider: "p", id: "live", name: "Live" }] }));
  await h.flush();
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["live"],
  );
  assert.equal(h.state.modelLoading, false);
  await h.update({ session: null, newSessionCwd: "/different" });
  await h.flush();
  assert.deepEqual(h.state.modelList, []);
});

test("the primary catalog reloads on generations zero, one and two while preserving choices during recovery", async (t) => {
  const { installPrimaryHost } = await import("./primary-host-test-fixture.mjs");
  const host = createSessionTestHost();
  const h = await createSessionHookHarness(t, { bundleName: "primary-model-generations", host });
  let id = "zero";
  const primary = installPrimaryHost(globalThis.window, {
    "models.list": () => ({ ...MODEL_LIST, models: [{ provider: "p", id, name: id }] }),
  });
  t.after(() => primary.close());
  primary.publish(0);
  await h.mount({ session: null, newSessionCwd: "/generation" });
  await h.flush();
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["zero"],
  );
  for (const [generation, name] of [
    [1, "one"],
    [2, "two"],
  ]) {
    await h.act(async () => primary.publish(generation, false));
    assert.equal(h.state.modelReconnecting, true);
    assert.equal(h.state.modelList.length, 1);
    await h.act(() => h.state.refreshModels());
    assert.equal(h.state.modelReconnecting, true);
    id = name;
    await h.act(async () => primary.publish(generation));
    await h.flush();
    assert.deepEqual(
      h.state.modelList.map((model) => model.id),
      [name],
    );
    assert.equal(h.state.modelReconnecting, false);
  }
  assert.deepEqual(
    primary.requests.filter((request) => request.method === "models.list").map((request) => request.generation),
    [0, 1, 2],
  );
});

test("the last-known-good catalog retains only 32 locations and refreshes insertion order on success", async (t) => {
  let pending = false;
  const host = createSessionTestHost({ listModels: async () => (pending ? new Promise(() => {}) : MODEL_LIST) });
  const h = await createSessionHookHarness(t, { bundleName: "models-cache-capacity", host });
  await h.mount({ session: null, newSessionCwd: "/cache-0" });
  for (let i = 1; i < 32; i += 1) {
    await h.remount({ session: null, newSessionCwd: `/cache-${i}` });
    await h.flush();
  }
  await h.remount({ session: null, newSessionCwd: "/cache-0" });
  await h.flush();
  await h.remount({ session: null, newSessionCwd: "/cache-32" });
  await h.flush();
  pending = true;
  await h.remount({ session: null, newSessionCwd: "/cache-1" });
  await h.flush();
  assert.deepEqual(h.state.modelList, []);
  await h.remount({ session: null, newSessionCwd: "/cache-0" });
  await h.flush();
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["alpha", "beta"],
  );
  await h.remount({ session: null, newSessionCwd: "/cache-32" });
  await h.flush();
  assert.deepEqual(
    h.state.modelList.map((model) => model.id),
    ["alpha", "beta"],
  );
});

test("global catalog fallback makes only the historical conversation read-only", async (t) => {
  const detail = createSessionDetail("missing-model-folder");
  const host = createSessionTestHost({
    getSession: async () => detail,
    listModels: async () => ({ ...MODEL_LIST, scope: { kind: "global-fallback", missingFolderPath: "/fixture" } }),
  });
  const h = await createSessionHookHarness(t, { bundleName: "models-global-fallback", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  assert.deepEqual(h.state.modelCatalogScope, { kind: "global-fallback", missingFolderPath: "/fixture" });
  assert.equal(h.state.sessionFolderMissing, true);
  await h.act(() => h.state.handleSend("cannot send in place"));
  assert.equal(host.sendCommands.length, 0);
  assert.equal(h.state.messages.length, 2);
  await h.remount({ session: null, newSessionCwd: "/writable" });
  assert.equal(h.state.sessionFolderMissing, false);
});

for (const code of ["CLOSED", "DISCONNECTED"]) {
  test(`${code} during initial load and refresh produces reconnecting picker state without notices`, async (t) => {
    const { RpcError } = await import("../../../contract/types.ts");
    let connected = false;
    const host = createSessionTestHost({
      listModels: async () => {
        if (!connected) throw new RpcError({ code, message: "RPC port closed" });
        return MODEL_LIST;
      },
      refreshModels: async () => {
        throw new RpcError({ code, message: "RPC port closed" });
      },
    });
    const h = await createSessionHookHarness(t, { bundleName: `models-${code}`, host });
    await h.mount({ session: null, newSessionCwd: "/transport" });
    await h.flush();
    assert.equal(h.state.modelReconnecting, true);
    assert.equal(h.state.modelLoading, false);
    assert.equal(h.state.modelLoadError, null);
    assert.deepEqual(h.state.notices, []);
    connected = true;
    await h.update({ session: null, newSessionCwd: "/transport", modelsRefreshKey: 1 });
    await h.flush();
    assert.equal(h.state.modelReconnecting, false);
    await h.act(() => h.state.refreshModels());
    assert.equal(h.state.modelReconnecting, true);
    assert.equal(h.state.modelRefreshing, false);
    assert.equal(h.state.modelLoadError, null);
    assert.deepEqual(h.state.notices, []);
    assert.deepEqual(
      h.state.modelList.map((model) => model.id),
      ["alpha", "beta"],
    );
    assert.equal(
      h
        .errorCalls()
        .some(
          ({ arguments: args }) =>
            args[0] === "Failed to load model directory:" || args[0] === "Failed to refresh model directory:",
        ),
      false,
    );
  });
}

test("replacing the desktop bridge starts with no cached catalog from its predecessor", async (t) => {
  let pending = false;
  const host = createSessionTestHost({ listModels: async () => (pending ? new Promise(() => {}) : MODEL_LIST) });
  const h = await createSessionHookHarness(t, { bundleName: "models-new-bridge", host });
  const options = { session: null, newSessionCwd: "/bridge-location" };
  await h.mount(options);
  await h.flush();
  assert.equal(h.state.modelList.length, 2);
  pending = true;
  const { installPrimaryHost } = await import("./primary-host-test-fixture.mjs");
  const replacement = installPrimaryHost(globalThis.window, { "models.list": () => new Promise(() => {}) });
  t.after(() => replacement.close());
  await h.remount(options);
  await h.flush();
  assert.deepEqual(h.state.modelList, []);
  assert.equal(h.state.modelLoading, true);
});

for (const operation of ["load", "refresh"]) {
  test(`a genuine backend ${operation} failure after transport closure replaces reconnecting with the visible error`, async (t) => {
    const { RpcError } = await import("../../../contract/types.ts");
    let backendAvailable = false;
    const backendFailure = () => {
      throw new RpcError({ code: "INTERNAL", message: "catalog configuration is corrupt" });
    };
    const host = createSessionTestHost({
      listModels: async () => {
        if (backendAvailable) return backendFailure();
        throw new RpcError({ code: "CLOSED", message: "RPC port closed" });
      },
      refreshModels: async () => backendFailure(),
    });
    const h = await createSessionHookHarness(t, { bundleName: `models-backend-after-close-${operation}`, host });
    const options = { session: null, newSessionCwd: "/corrupt-catalog" };
    await h.mount(options);
    await h.flush();
    assert.equal(h.state.modelReconnecting, true);
    assert.equal(h.state.modelLoadError, null);
    backendAvailable = true;
    if (operation === "refresh") await h.act(() => h.state.refreshModels());
    else await h.update({ ...options, modelsRefreshKey: 1 });
    await h.flush();
    assert.equal(h.state.modelReconnecting, false);
    assert.equal(h.state.modelLoadError, "catalog configuration is corrupt");
    assert.deepEqual(h.state.modelList, []);
    assert.equal(h.state.modelLoading, false);
    assert.equal(h.state.modelRefreshing, false);
  });
}
