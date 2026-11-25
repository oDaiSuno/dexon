import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import {
  act,
  click,
  dom,
  labelledControl,
  loadRenderer,
  mount,
  restoreGlobals,
  selectOption,
  waitFor,
} from "../support/renderer.mjs";
import { createDeferred } from "#test-timing";
import {
  createFolderBrowserHost,
  remoteServer,
} from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "model-environment-isolation",
  'export {useOAuthLogin} from "./src/renderer/components/models/use-oauth-login.ts"; export {ModelsConfig} from "./src/renderer/components/ModelsConfig.tsx"; export {SessionOrchestrationSettings} from "./src/renderer/components/settings/session-orchestration-settings.tsx"; export {apiFetch} from "./src/renderer/lib/api-fetch.ts"; export {getSessionEnvironmentId, environmentRegistry} from "./src/renderer/lib/environment-registry.ts"; export {workspaceStore} from "./src/renderer/lib/workspace-store.ts"; export {loadSessionNamingSettings, saveSessionNamingSettings, primeSessionNamingSettings, resetSessionNamingSettingsCache, shouldAutoTitleMessage, requestAutoSessionTitle, regenerateSessionTitle, setSessionNamingModel} from "./src/renderer/lib/auto-session-title.ts";',
);
after(restoreGlobals);
beforeEach(() => {
  api.resetSessionNamingSettingsCache();
  dom.window.localStorage.clear();
});

async function host(t, reply = () => ({})) {
  let boundary;
  await act(async () => {
    boundary = await createFolderBrowserHost(api, {
      target: dom.window,
      servers: [remoteServer("primary"), remoteServer("gpu")],
      reply,
    });
    api.environmentRegistry.initialize();
    api.workspaceStore.openSpace({ environmentId: "gpu", path: "/same" });
  });
  t.after(async () => act(async () => boundary.close()));
  return boundary;
}

test("an unknown session has no environment owner even while a remote environment is focused", async (t) => {
  await host(t);
  assert.equal(api.getSessionEnvironmentId("unknown-session-id"), null);
});

test("retired model HTTP routes fail closed without contacting any environment", async (t) => {
  const boundary = await host(t);
  const response = await api.apiFetch("/api/models-config");
  assert.equal(response.ok, false);
  assert.deepEqual(boundary.requests, []);
});

test("model settings load their configuration and authentication providers only from their explicit environment", async (t) => {
  const boundary = await host(t, (_id, method) => {
    if (method === "modelsConfig.get") return { config: { providers: {} }, version: "gpu-version" };
    if (method === "auth.providers" || method === "auth.allProviders") return { providers: [] };
    if (method === "modelsConfig.channels.get") return { channels: {} };
    if (method === "models.preferences.get") return { models: [], enabledModels: null };
    if (method === "models.sessionNaming.get") return { enabled: true, model: null, configured: true };
    if (method === "models.defaults.get") return { model: null, thinkingLevel: "medium" };
    throw new Error(`Unexpected model request: ${method}`);
  });
  await act(async () => api.workspaceStore.openSpace({ environmentId: "primary", path: "/same" }));
  await mount(t, api.ModelsConfig, { environmentId: "gpu", embedded: true, cwd: "/same", onClose() {} });
  await waitFor(() => {
    assert.ok(boundary.requests.some((request) => request.method === "modelsConfig.get"));
    assert.ok(boundary.requests.some((request) => request.method === "auth.providers"));
  });
  assert.ok(boundary.requests.every((request) => request.environmentId === "gpu"));
  assert.equal(boundary.requests.filter((request) => request.environmentId === "primary").length, 0);
});

test("session orchestration lists models only on its explicit environment while focus is elsewhere", async (t) => {
  const boundary = await host(t, (_id, method) => {
    assert.equal(method, "models.list");
    return { models: [], nameMap: {}, thinkingLevels: {}, defaultModel: null };
  });
  await act(async () => api.workspaceStore.openSpace({ environmentId: "primary", path: "/same" }));
  await mount(t, api.SessionOrchestrationSettings, { environmentId: "gpu" });
  await waitFor(() => assert.ok(boundary.requests.some((request) => request.method === "models.list")));
  assert.deepEqual(
    boundary.requests.map((request) => request.environmentId),
    ["gpu"],
  );
});

test("OAuth events, replies, logout and cancellation retain the provider environment when focus changes", async (t) => {
  const boundary = await host(t, (_id, method) => {
    if (method === "auth.loginStart") return { ok: true, started: true };
    if (method === "auth.logout") return { ok: true, warning: { code: "MODEL_SYNC_FAILED", message: "Refresh later" } };
    assert.ok(["auth.loginCancel", "auth.loginSubmit"].includes(method));
    return { ok: true };
  });
  const provider = { id: "copilot", name: "Copilot", usesCallbackServer: false, loggedIn: false };
  let login;
  let refreshed = 0;
  function Probe() {
    login = api.useOAuthLogin("gpu", provider, () => refreshed++);
    return null;
  }
  const view = await mount(t, Probe);
  await act(async () => login.handleLogin());
  await act(async () => api.workspaceStore.openSpace({ environmentId: "primary", path: "/same" }));
  await act(async () => boundary.emit("primary", "auth.login", "copilot", { type: "success" }));
  assert.equal(login.loginState.phase, "connecting");
  await act(async () =>
    boundary.emit("gpu", "auth.login", "copilot", {
      type: "select_request",
      message: "Choose account",
      token: "selection",
      options: [{ id: "work", label: "Work" }],
    }),
  );
  assert.equal(login.loginState.phase, "select");
  await act(async () => login.submitSelection("selection", "work"));
  await act(async () =>
    boundary.emit("gpu", "auth.login", "copilot", {
      type: "prompt_request",
      message: "Enter code",
      token: "manual",
    }),
  );
  assert.equal(login.loginState.phase, "prompt");
  await act(async () => login.submitCode("manual", " 1234 "));
  assert.deepEqual(
    boundary.requests.filter((request) => request.method === "auth.loginSubmit").map((request) => request.params),
    [
      { provider: "copilot", token: "selection", code: "work" },
      { provider: "copilot", token: "manual", code: "1234" },
    ],
  );
  await act(async () => boundary.emit("gpu", "auth.login", "copilot", { type: "success" }));
  assert.equal(login.loginState.phase, "success");
  assert.equal(refreshed, 1);
  await act(async () => login.handleLogout());
  assert.deepEqual(login.loginState, { phase: "success", message: "Refresh later", warning: true });
  assert.equal(refreshed, 2);
  await act(async () => login.handleLogin());
  await act(async () => login.handleCancelLogin());
  await act(async () => boundary.emit("gpu", "auth.login", "copilot", { type: "progress", message: "Late event" }));
  assert.equal(login.loginState.phase, "idle");
  const cancellationsBeforeUnmount = boundary.requests.filter(
    (request) => request.method === "auth.loginCancel",
  ).length;
  await view.unmount();
  await waitFor(() =>
    assert.equal(
      boundary.requests.filter((request) => request.method === "auth.loginCancel").length,
      cancellationsBeforeUnmount + 1,
    ),
  );
  assert.ok(boundary.requests.every((request) => request.environmentId === "gpu"));
  assert.equal(boundary.requests.filter((request) => request.environmentId === "primary").length, 0);
});

test("an OAuth submission with no server error message still reports the server error code", async (t) => {
  await host(t, (_id, method) => {
    if (method === "auth.loginSubmit") throw Object.assign(new Error(""), { code: "BAD_REQUEST" });
    return { ok: true };
  });
  let login;
  const provider = { id: "copilot", name: "Copilot", usesCallbackServer: false, loggedIn: false };
  function Probe() {
    login = api.useOAuthLogin("gpu", provider, () => {});
    return null;
  }
  const view = await mount(t, Probe);
  await act(async () => login.submitCode("manual", "1234"));
  assert.deepEqual(login.loginState, { phase: "error", message: "Server error BAD_REQUEST" });
  await view.unmount();
});

async function namingHost(t, { states = {}, get, set } = {}) {
  return host(t, (environmentId, method, params) => {
    if (method === "models.sessionNaming.get")
      return get ? get(environmentId) : (states[environmentId] ?? { enabled: true, model: null, configured: true });
    if (method === "models.sessionNaming.set") {
      if (set) return set(environmentId, params);
      states[environmentId] = { ...states[environmentId], ...params, configured: true };
      return states[environmentId];
    }
    if (method === "modelsConfig.get") return { config: { providers: {} }, version: "v1" };
    if (method === "modelsConfig.channels.get") return { channels: {} };
    if (method === "auth.providers" || method === "auth.allProviders") return { providers: [] };
    if (method === "models.defaults.get") return { model: null, thinkingLevel: "medium" };
    if (method === "models.preferences.get")
      return {
        models: [
          { provider: "remote", id: "fast", name: "GPU Fast" },
          { provider: "remote", id: "disabled", name: "GPU Disabled" },
        ],
        enabledModels: ["remote/fast"],
      };
    if (method === "agent.generateTitle") return { title: "Generated title" };
    throw new Error(`Unexpected naming request: ${method}`);
  });
}

test("remote naming settings stay on gpu and preserve an unavailable stored model with a fallback hint", async (t) => {
  const states = {
    primary: { enabled: true, model: null, configured: true },
    gpu: { enabled: false, model: { provider: "old", modelId: "missing" }, configured: true },
  };
  const boundary = await namingHost(t, { states });
  await act(async () => api.workspaceStore.openSpace({ environmentId: "primary", path: "/same" }));
  const view = await mount(t, api.ModelsConfig, { environmentId: "gpu", embedded: true, onClose() {} });
  const select = await waitFor(() => {
    const control = labelledControl(view.container, "Naming model");
    assert.ok(control);
    assert.equal(control.disabled, false);
    return control;
  });
  assert.equal(labelledControl(view.container, "Auto-name new sessions").checked, false);
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), false);
  assert.deepEqual(
    [...select.options].map((option) => option.textContent),
    ["Not set", "GPU Fast · fast", "old/missing"],
  );
  assert.equal(select.value, "old/missing");
  assert.match(view.container.textContent, /unavailable or not enabled in this environment.*active session model/);
  assert.deepEqual(states.gpu.model, { provider: "old", modelId: "missing" });
  await click(labelledControl(view.container, "Auto-name new sessions"));
  await waitFor(() => assert.equal(states.gpu.enabled, true));
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), true);
  await selectOption(select, "remote/fast");
  await waitFor(() => assert.deepEqual(states.gpu.model, { provider: "remote", modelId: "fast" }));
  assert.doesNotMatch(view.container.textContent, /unavailable or not enabled in this environment/);
  assert.deepEqual(states.primary, { enabled: true, model: null, configured: true });
  assert.ok(boundary.requests.every(({ environmentId }) => environmentId === "gpu"));
  assert.deepEqual(
    boundary.requests.filter(({ method }) => method === "models.sessionNaming.set").map(({ params }) => params),
    [{ enabled: true }, { model: { provider: "remote", modelId: "fast" } }],
  );
  assert.match(view.container.textContent, /Settings are saved on gpu and only affect that server/);
});

test("an older gpu host keeps the session naming card visible with an update notice and legacy fallback", async (t) => {
  const boundary = await namingHost(t, {
    get: () => {
      throw Object.assign(new Error("Unknown method: models.sessionNaming.get"), { code: "METHOD_NOT_FOUND" });
    },
  });
  const view = await mount(t, api.ModelsConfig, { environmentId: "gpu", embedded: true, onClose() {} });
  await waitFor(() => assert.match(view.container.textContent, /Update this server to configure session naming/));
  assert.match(view.container.textContent, /Session naming/);
  assert.equal(view.container.querySelector('[role="alert"]'), null);
  const card = [...view.container.querySelectorAll("section")].find((section) =>
    /Session naming/.test(section.textContent),
  );
  assert.equal(card.querySelector("select, input"), null);
  const reads = boundary.requests.filter(({ method }) => method === "models.sessionNaming.get").length;
  api.primeSessionNamingSettings("gpu");
  assert.equal(boundary.requests.filter(({ method }) => method === "models.sessionNaming.get").length, reads);
  assert.deepEqual(await api.loadSessionNamingSettings("gpu"), { status: "unsupported" });
  dom.window.localStorage.setItem("dexon:autoSessionTitle", "off");
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), false);
  dom.window.localStorage.removeItem("dexon:autoSessionTitle");
  api.setSessionNamingModel({ provider: "legacy", modelId: "fast" });
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), true);
  assert.equal(
    await api.requestAutoSessionTitle({ environmentId: "gpu", sessionId: "remote", prompt: "Fix the login page" }),
    "Generated title",
  );
  assert.deepEqual(boundary.requests.find(({ method }) => method === "agent.generateTitle").params.namingModel, {
    provider: "legacy",
    modelId: "fast",
  });
});

test("gpu can disable automatic naming independently while manual regeneration stays available and hosts choose models", async (t) => {
  api.setSessionNamingModel({ provider: "legacy", modelId: "fast" });
  const boundary = await namingHost(t, {
    states: {
      primary: { enabled: true, model: null, configured: true },
      gpu: { enabled: false, model: { provider: "remote", modelId: "fast" }, configured: true },
    },
  });
  await Promise.all([api.loadSessionNamingSettings("primary"), api.loadSessionNamingSettings("gpu")]);
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), false);
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "primary"), true);
  assert.equal(api.shouldAutoTitleMessage("/model fast", "primary"), false);
  assert.equal(
    await api.requestAutoSessionTitle({ environmentId: "gpu", sessionId: "remote", prompt: "Fix the login page" }),
    null,
  );
  assert.equal(boundary.requests.filter(({ method }) => method === "agent.generateTitle").length, 0);
  assert.equal(
    await api.requestAutoSessionTitle({ environmentId: "primary", sessionId: "local", prompt: "Fix the login page" }),
    "Generated title",
  );
  assert.equal(await api.regenerateSessionTitle("gpu", "remote"), "Generated title");
  assert.deepEqual(
    boundary.requests
      .filter(({ method }) => method === "agent.generateTitle")
      .map(({ environmentId, params }) => ({ environmentId, params })),
    [
      {
        environmentId: "primary",
        params: { sessionId: "local", trigger: "first-prompt", prompt: "Fix the login page" },
      },
      { environmentId: "gpu", params: { sessionId: "remote", trigger: "regenerate" } },
    ],
  );
  assert.equal(
    dom.window.localStorage.getItem("dexon:sessionNamingModel"),
    JSON.stringify({ provider: "legacy", modelId: "fast" }),
  );
});

test("an unconfigured remote never imports local legacy choices or forwards them to automatic naming", async (t) => {
  dom.window.localStorage.setItem("dexon:autoSessionTitle", "off");
  api.setSessionNamingModel({ provider: "local", modelId: "private" });
  const boundary = await namingHost(t, { states: { gpu: { enabled: true, model: null, configured: false } } });
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), true);
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "primary"), false);
  await api.requestAutoSessionTitle({ environmentId: "gpu", sessionId: "uncached", prompt: "Fix the login page" });
  await api.loadSessionNamingSettings("gpu");
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), true);
  await api.requestAutoSessionTitle({ environmentId: "gpu", sessionId: "unconfigured", prompt: "Fix the login page" });
  assert.equal(boundary.requests.filter(({ method }) => method === "models.sessionNaming.set").length, 0);
  assert.deepEqual(
    boundary.requests.filter(({ method }) => method === "agent.generateTitle").map(({ params }) => params),
    [
      { sessionId: "uncached", trigger: "first-prompt", prompt: "Fix the login page" },
      { sessionId: "unconfigured", trigger: "first-prompt", prompt: "Fix the login page" },
    ],
  );
  assert.equal(dom.window.localStorage.getItem("dexon:autoSessionTitle"), "off");
  assert.equal(
    dom.window.localStorage.getItem("dexon:sessionNamingModel"),
    JSON.stringify({ provider: "local", modelId: "private" }),
  );
});

test("repeated preloads share one request per environment and use the cached result without blocking callers", async (t) => {
  const pending = createDeferred();
  const boundary = await namingHost(t, { get: () => pending.promise });
  assert.equal(api.primeSessionNamingSettings("gpu"), undefined);
  api.primeSessionNamingSettings("gpu");
  const loaded = api.loadSessionNamingSettings("gpu");
  await waitFor(() =>
    assert.equal(boundary.requests.filter(({ method }) => method === "models.sessionNaming.get").length, 1),
  );
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), true);
  pending.resolve({ enabled: false, model: null, configured: true });
  await loaded;
  api.primeSessionNamingSettings("gpu");
  assert.equal(boundary.requests.filter(({ method }) => method === "models.sessionNaming.get").length, 1);
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), false);
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "primary"), true);
  api.resetSessionNamingSettingsCache();
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), true);
});

test("transient naming load errors surface as errors and remain retryable rather than becoming unsupported", async (t) => {
  let fail = true;
  const boundary = await namingHost(t, {
    get: () => {
      if (fail) throw Object.assign(new Error("Connection interrupted"), { code: "TIMEOUT" });
      return { enabled: false, model: null, configured: true };
    },
  });
  const view = await mount(t, api.ModelsConfig, { environmentId: "gpu", embedded: true, onClose() {} });
  await waitFor(() =>
    assert.match(view.container.querySelector('[role="alert"]').textContent, /Connection interrupted/),
  );
  assert.doesNotMatch(view.container.textContent, /Update this server/);
  assert.equal(labelledControl(view.container, "Naming model").disabled, true);
  await assert.rejects(api.loadSessionNamingSettings("gpu"), /Connection interrupted/);
  fail = false;
  assert.deepEqual(await api.loadSessionNamingSettings("gpu"), {
    status: "ready",
    settings: { enabled: false, model: null, configured: true },
  });
  assert.equal(api.shouldAutoTitleMessage("Fix the login page", "gpu"), false);
  assert.equal(boundary.requests.filter(({ method }) => method === "models.sessionNaming.get").length, 3);
});

test("manual regeneration retains the legacy model fallback for uncached and unconfigured remote hosts", async (t) => {
  api.setSessionNamingModel({ provider: "legacy", modelId: "fast" });
  const boundary = await namingHost(t, { states: { gpu: { enabled: false, model: null, configured: false } } });
  await api.regenerateSessionTitle("gpu", "uncached");
  await api.loadSessionNamingSettings("gpu");
  await api.regenerateSessionTitle("gpu", "unconfigured");
  assert.deepEqual(
    boundary.requests.filter(({ method }) => method === "agent.generateTitle").map(({ params }) => params),
    [
      { sessionId: "uncached", trigger: "regenerate", namingModel: { provider: "legacy", modelId: "fast" } },
      { sessionId: "unconfigured", trigger: "regenerate", namingModel: { provider: "legacy", modelId: "fast" } },
    ],
  );
});
