import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import {
  createFolderBrowserHost,
  remoteServer,
} from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "model-environment-isolation",
  'export {useOAuthLogin} from "./src/renderer/components/models/use-oauth-login.ts"; export {ModelsConfig} from "./src/renderer/components/ModelsConfig.tsx"; export {SessionOrchestrationSettings} from "./src/renderer/components/settings/session-orchestration-settings.tsx"; export {apiFetch} from "./src/renderer/lib/api-fetch.ts"; export {getSessionEnvironmentId, environmentRegistry} from "./src/renderer/lib/environment-registry.ts"; export {workspaceStore} from "./src/renderer/lib/workspace-store.ts";',
);
after(restoreGlobals);

async function host(t, reply = () => ({})) {
  const boundary = await createFolderBrowserHost(api, {
    target: dom.window,
    servers: [remoteServer("primary"), remoteServer("gpu")],
    reply,
  });
  t.after(() => boundary.close());
  api.environmentRegistry.initialize();
  await act(async () => api.workspaceStore.openSpace({ environmentId: "gpu", path: "/same" }));
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
