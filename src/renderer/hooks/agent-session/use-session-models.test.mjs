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
