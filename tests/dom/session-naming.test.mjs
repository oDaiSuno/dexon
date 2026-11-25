import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { createDeferred } from "#test-timing";
import {
  act,
  button,
  byRole,
  click,
  dom,
  hover,
  labelledControl,
  loadRenderer,
  mount,
  restoreGlobals,
  selectOption,
  waitFor,
} from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "session-naming-behavior",
  [
    'export { SessionItem } from "./src/renderer/components/session-sidebar/session-item.tsx";',
    'export { ModelsConfig } from "./src/renderer/components/ModelsConfig.tsx";',
    'export { requestAutoSessionTitle, setSessionNamingModel, loadSessionNamingSettings, resetSessionNamingSettingsCache } from "./src/renderer/lib/auto-session-title.ts";',
  ].join("\n"),
);
after(restoreGlobals);
beforeEach(() => api.resetSessionNamingSettingsCache());

const NAMING_MODEL = { provider: "deepseek", modelId: "deepseek-chat" };
const FIRST_MESSAGE = "Add a right-click menu to the sidebar sessions";

function session(overrides = {}) {
  return {
    environmentId: "primary",
    id: "s1",
    name: "Base session",
    firstMessage: FIRST_MESSAGE,
    cwd: "/workspace/dexon",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

function useNamingModel(t, model) {
  dom.window.localStorage.clear();
  if (model) api.setSessionNamingModel(model);
  t.after(() => dom.window.localStorage.clear());
}

async function mountRow(t, { reply = () => ({ title: "Sidebar context menu" }), ...props } = {}) {
  const requests = [];
  const boundary = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      requests.push({ method, params });
      if (method === "agent.generateTitle") return reply(params);
      if (method === "sessions.descendants") return { sessionIds: [], runningSessionIds: [] };
      throw new Error(`unexpected row request: ${method}`);
    },
  }));
  const view = await mount(
    t,
    api.SessionItem,
    { session: session(), isSelected: false, activity: "idle", relation: null, onClick: () => {}, ...props },
    { release: boundary.close },
  );
  const titleRequests = () => requests.filter((request) => request.method === "agent.generateTitle");
  return { ...view, titleRequests };
}

async function openMenu(view) {
  await hover(view.container.querySelector('[role="listitem"]'));
  await click(button(view.container, "Session actions for Base session"));
  return waitFor(() => {
    const menu = byRole(view.container, "menu", "Session actions");
    assert.ok(menu, "the session menu is open");
    return menu;
  });
}

function menuItemNames(menu) {
  return [...menu.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.getAttribute("aria-label") ?? item.textContent.trim(),
  );
}

test("with a naming model chosen, the session menu offers Regenerate name right after Rename", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  const view = await mountRow(t);
  const menu = await openMenu(view);
  assert.deepEqual(menuItemNames(menu), ["Rename", "Regenerate name", "Copy session path", "Delete session"]);
  assert.equal(byRole(menu, "menuitem", "Regenerate name").disabled, false);
});

test("regenerating asks the naming model to rename from the first message, even though the session already has a name", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  const renamed = [];
  const view = await mountRow(t, { onRenamed: () => renamed.push("renamed") });
  await click(byRole(await openMenu(view), "menuitem", "Regenerate name"));
  await waitFor(() => assert.equal(renamed.length, 1));
  assert.deepEqual(
    view.titleRequests().map((request) => request.params),
    [{ sessionId: "s1", trigger: "regenerate", namingModel: NAMING_MODEL }],
  );
  assert.equal(view.container.querySelector('[role="menu"]'), null, "the menu closes once the request starts");
});

test("while a new name is being generated the row says so and the menu does not start a second request", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  const pending = createDeferred();
  const view = await mountRow(t, { reply: () => pending.promise });
  await click(byRole(await openMenu(view), "menuitem", "Regenerate name"));
  await waitFor(() => assert.ok(button(view.container, "Base session · Naming…"), "the row says it is naming"));
  const menu = await openMenu(view);
  assert.equal(byRole(menu, "menuitem", "Regenerate name").disabled, true);
  await act(async () => pending.resolve({ title: "Sidebar context menu" }));
  await waitFor(() => assert.ok(button(view.container, "Base session"), "the naming note goes away"));
  assert.equal(view.titleRequests().length, 1);
});

test("a failed regeneration keeps the row usable and does not report a rename", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  const renamed = [];
  const view = await mountRow(t, { reply: () => ({ title: null }), onRenamed: () => renamed.push("renamed") });
  await click(byRole(await openMenu(view), "menuitem", "Regenerate name"));
  await waitFor(() => assert.equal(view.titleRequests().length, 1));
  await waitFor(() => assert.ok(button(view.container, "Base session"), "the naming note goes away"));
  assert.deepEqual(renamed, []);
});

test("without a naming preference, Regenerate name stays available and lets the Host use the conversation model", async (t) => {
  useNamingModel(t, null);
  const renamed = [];
  const view = await mountRow(t, { onRenamed: () => renamed.push("renamed") });
  const menu = await openMenu(view);
  const item = byRole(menu, "menuitem", "Regenerate name");
  assert.ok(item);
  assert.equal(item.disabled, false);
  assert.doesNotMatch(menu.textContent, /Go to settings/);
  await click(item);
  await waitFor(() => assert.equal(renamed.length, 1));
  assert.equal(view.container.querySelector('[role="menu"]'), null);
  assert.deepEqual(
    view.titleRequests().map((request) => request.params),
    [{ sessionId: "s1", trigger: "regenerate" }],
  );
});

test("automatic naming forwards the naming preference without replacing the conversation model", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  const requests = [];
  const boundary = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      requests.push({ method, params });
      return { title: "Login page styling" };
    },
  }));
  t.after(boundary.close);
  const title = await api.requestAutoSessionTitle({
    environmentId: "primary",
    sessionId: "fresh-1",
    prompt: "Fix the login page styling",
  });
  assert.equal(title, "Login page styling");
  assert.deepEqual(requests, [
    {
      method: "agent.generateTitle",
      params: {
        sessionId: "fresh-1",
        trigger: "first-prompt",
        prompt: "Fix the login page styling",
        namingModel: NAMING_MODEL,
      },
    },
  ]);
});

test("without a naming preference, automatic naming leaves model selection to the Host", async (t) => {
  useNamingModel(t, null);
  const requests = [];
  const boundary = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      requests.push({ method, params });
      return { title: null };
    },
  }));
  t.after(boundary.close);
  await api.requestAutoSessionTitle({
    environmentId: "primary",
    sessionId: "fresh-2",
    prompt: "Fix the login page",
  });
  assert.deepEqual(requests[0].params, {
    sessionId: "fresh-2",
    trigger: "first-prompt",
    prompt: "Fix the login page",
  });
});

const PREFERENCE_MODELS = [
  { id: "deepseek-chat", name: "DeepSeek V3", provider: "deepseek" },
  { id: "deepseek-reasoner", name: "DeepSeek R1", provider: "deepseek" },
  { id: "gpt-5", name: "GPT-5", provider: "openai" },
];

async function mountModels(
  t,
  {
    settings = { enabled: true, model: null, configured: true },
    save,
    load,
    loadPreferences,
    loadConfig,
    waitUntilReady = true,
  } = {},
) {
  const requests = [];
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method, params) {
        requests.push({ method, params });
        switch (method) {
          case "models.sessionNaming.get":
            return load ? load() : settings;
          case "models.sessionNaming.set":
            return Promise.resolve(save ? save(params) : { ...settings, ...params, configured: true }).then(
              (result) => {
                settings = result;
                return result;
              },
            );
          case "modelsConfig.get":
            return loadConfig ? loadConfig() : { config: { providers: {} }, version: "v1" };
          case "auth.providers":
          case "auth.allProviders":
            return { providers: [] };
          case "models.preferences.get":
            return loadPreferences
              ? loadPreferences()
              : { models: PREFERENCE_MODELS, enabledModels: ["deepseek/deepseek-chat", "openai/gpt-5"] };
          case "modelsConfig.channels.get":
            return { channels: {} };
          case "models.defaults.get":
            return { model: null, thinkingLevel: "medium" };
          default:
            throw new Error(`unexpected model request: ${method}`);
        }
      },
      subscribe() {
        return () => {};
      },
    }),
    { bridge: { openExternal: async () => {} } },
  );
  const view = await mount(
    t,
    api.ModelsConfig,
    { onClose() {}, embedded: true, cwd: "/workspace" },
    { release: host.close },
  );
  const select = await waitFor(() => {
    const control = labelledControl(view.container, "Naming model");
    if (waitUntilReady) {
      assert.ok(control.options.length > 1, "enabled models are listed");
      assert.equal(control.disabled, false);
    }
    return control;
  });
  return { view, select, requests, settings: () => settings };
}

test("the Naming model setting lists only enabled models and starts unset", async (t) => {
  useNamingModel(t, null);
  const { select } = await mountModels(t);
  assert.deepEqual(
    [...select.options].map((option) => option.textContent),
    ["Not set", "DeepSeek V3 · deepseek-chat", "GPT-5 · gpt-5"],
  );
  assert.equal(select.selectedOptions[0].textContent, "Not set");
});

test("a chosen naming model is remembered on the host and regeneration leaves model selection to that host", async (t) => {
  useNamingModel(t, null);
  const first = await mountModels(t);
  const chosen = [...first.select.options].find((option) => option.textContent === "DeepSeek V3 · deepseek-chat");
  await selectOption(first.select, chosen.value);
  await first.view.unmount();
  const again = await mountModels(t, { settings: first.settings() });
  assert.deepEqual(again.settings().model, NAMING_MODEL);
  assert.equal(again.select.selectedOptions[0].textContent, "DeepSeek V3 · deepseek-chat");
  await again.view.unmount();

  const row = await mountRow(t);
  await click(byRole(await openMenu(row), "menuitem", "Regenerate name"));
  await waitFor(() => assert.equal(row.titleRequests().length, 1));
  assert.equal(row.titleRequests()[0].params.namingModel, undefined);
});

test("the session naming card shows the fixed example of a first message turning into a sidebar name", async (t) => {
  useNamingModel(t, null);
  const { view } = await mountModels(t);
  const text = view.container.textContent;
  assert.match(text, /First message/);
  assert.match(text, /≈ 1s/);
  assert.match(text, /Shown in the sidebar as/);
});

test("a session with no messages yet cannot have its name regenerated even without a naming preference", async (t) => {
  useNamingModel(t, null);
  const view = await mountRow(t, { session: session({ messageCount: 0, firstMessage: "(no messages)" }) });
  const menu = await openMenu(view);
  assert.equal(byRole(menu, "menuitem", "Regenerate name").disabled, true);
});

test("a session whose first prompt is a command or bare skill cannot have its name regenerated", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  for (const firstMessage of ["/model gpt-5", "/skill:groksearch", "a"]) {
    const view = await mountRow(t, { session: session({ firstMessage }) });
    const menu = await openMenu(view);
    assert.equal(byRole(menu, "menuitem", "Regenerate name").disabled, true, firstMessage);
    await view.unmount();
  }
});

test("primary session naming loads from its host and saves toggle, model, and explicit unset", async (t) => {
  useNamingModel(t, null);
  const models = await mountModels(t);
  assert.equal(models.requests.filter(({ method }) => method === "models.sessionNaming.get").length, 1);
  const toggle = labelledControl(models.view.container, "Auto-name new sessions");
  await click(toggle);
  await waitFor(() => assert.equal(models.settings().enabled, false));
  assert.equal(toggle.checked, false);
  await selectOption(models.select, "deepseek/deepseek-chat");
  await waitFor(() => assert.deepEqual(models.settings().model, NAMING_MODEL));
  await selectOption(models.select, "");
  await waitFor(() => assert.equal(models.settings().model, null));
  assert.deepEqual(
    models.requests.filter(({ method }) => method === "models.sessionNaming.set").map(({ params }) => params),
    [{ enabled: false }, { model: NAMING_MODEL }, { model: null }],
  );
  assert.equal(dom.window.localStorage.getItem("dexon:autoSessionTitle"), null);
  assert.equal(dom.window.localStorage.getItem("dexon:sessionNamingModel"), null);
});

test("primary migrates both legacy choices atomically once and removes the old keys only after success", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  dom.window.localStorage.setItem("dexon:autoSessionTitle", "off");
  const models = await mountModels(t, { settings: { enabled: true, model: null, configured: false } });
  assert.deepEqual(models.settings(), { enabled: false, model: NAMING_MODEL, configured: true });
  assert.equal(labelledControl(models.view.container, "Auto-name new sessions").checked, false);
  assert.equal(models.select.value, "deepseek/deepseek-chat");
  assert.deepEqual(
    models.requests.filter(({ method }) => method === "models.sessionNaming.set").map(({ params }) => params),
    [{ enabled: false, model: NAMING_MODEL }],
  );
  assert.equal(dom.window.localStorage.getItem("dexon:autoSessionTitle"), null);
  assert.equal(dom.window.localStorage.getItem("dexon:sessionNamingModel"), null);
  api.resetSessionNamingSettingsCache();
  await api.loadSessionNamingSettings("primary");
  assert.equal(models.requests.filter(({ method }) => method === "models.sessionNaming.set").length, 1);
});

for (const model of [null, { provider: "openai", modelId: "gpt-5" }]) {
  test(`an explicitly configured host keeps its ${model ? "chosen" : "unset"} model instead of importing legacy preferences`, async (t) => {
    useNamingModel(t, NAMING_MODEL);
    dom.window.localStorage.setItem("dexon:autoSessionTitle", "off");
    const models = await mountModels(t, { settings: { enabled: true, model, configured: true } });
    assert.equal(labelledControl(models.view.container, "Auto-name new sessions").checked, true);
    assert.equal(models.select.value, model ? "openai/gpt-5" : "");
    assert.equal(models.requests.filter(({ method }) => method === "models.sessionNaming.set").length, 0);
    assert.equal(dom.window.localStorage.getItem("dexon:autoSessionTitle"), "off");
    assert.equal(dom.window.localStorage.getItem("dexon:sessionNamingModel"), JSON.stringify(NAMING_MODEL));
  });
}

for (const legacy of ["toggle", "model", "invalid", "none"]) {
  test(`an unconfigured primary host migrates only valid legacy choices: ${legacy}`, async (t) => {
    useNamingModel(t, legacy === "model" ? NAMING_MODEL : null);
    if (legacy === "toggle") dom.window.localStorage.setItem("dexon:autoSessionTitle", "off");
    if (legacy === "invalid")
      dom.window.localStorage.setItem("dexon:sessionNamingModel", JSON.stringify({ provider: " ", modelId: "bad" }));
    const models = await mountModels(t, { settings: { enabled: true, model: null, configured: false } });
    const saves = models.requests.filter(({ method }) => method === "models.sessionNaming.set");
    assert.deepEqual(
      saves.map(({ params }) => params),
      legacy === "toggle"
        ? [{ enabled: false, model: null }]
        : legacy === "model"
          ? [{ enabled: true, model: NAMING_MODEL }]
          : [],
    );
  });
}

test("concurrent primary loads share one migration and keep both controls disabled until it finishes", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  dom.window.localStorage.setItem("dexon:autoSessionTitle", "off");
  const pending = createDeferred();
  const models = await mountModels(t, {
    settings: { enabled: true, model: null, configured: false },
    save: () => pending.promise,
    waitUntilReady: false,
  });
  const first = api.loadSessionNamingSettings("primary");
  const second = api.loadSessionNamingSettings("primary");
  assert.equal(models.select.disabled, true);
  assert.equal(labelledControl(models.view.container, "Auto-name new sessions").disabled, true);
  assert.equal(dom.window.localStorage.getItem("dexon:autoSessionTitle"), "off");
  await act(async () => pending.resolve({ enabled: false, model: NAMING_MODEL, configured: true }));
  assert.deepEqual(await first, await second);
  await waitFor(() => assert.equal(models.select.disabled, false));
  assert.equal(models.requests.filter(({ method }) => method === "models.sessionNaming.get").length, 1);
  assert.equal(models.requests.filter(({ method }) => method === "models.sessionNaming.set").length, 1);
  assert.equal(dom.window.localStorage.getItem("dexon:sessionNamingModel"), null);
});

test("a failed migration preserves legacy choices for retry instead of caching unsupported", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  dom.window.localStorage.setItem("dexon:autoSessionTitle", "off");
  let fail = true;
  const models = await mountModels(t, {
    settings: { enabled: true, model: null, configured: false },
    save: (patch) => {
      if (fail) throw new Error("session-naming.json is read-only");
      return { ...patch, configured: true };
    },
    waitUntilReady: false,
  });
  await waitFor(() => assert.match(byRole(models.view.container, "alert").textContent, /read-only/));
  assert.equal(models.select.disabled, true);
  assert.equal(dom.window.localStorage.getItem("dexon:autoSessionTitle"), "off");
  assert.equal(dom.window.localStorage.getItem("dexon:sessionNamingModel"), JSON.stringify(NAMING_MODEL));
  fail = false;
  const state = await api.loadSessionNamingSettings("primary");
  assert.deepEqual(state, { status: "ready", settings: { enabled: false, model: NAMING_MODEL, configured: true } });
  assert.equal(dom.window.localStorage.getItem("dexon:autoSessionTitle"), null);
  assert.equal(models.requests.filter(({ method }) => method === "models.sessionNaming.set").length, 2);
});

test("saving a naming toggle is optimistic, disables controls, and rolls back with an inline error on failure", async (t) => {
  useNamingModel(t, null);
  const pending = createDeferred();
  const models = await mountModels(t, { save: () => pending.promise });
  const toggle = labelledControl(models.view.container, "Auto-name new sessions");
  await click(toggle);
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, true);
  assert.equal(models.select.disabled, true);
  await act(async () => pending.reject(new Error("session-naming.json is read-only")));
  await waitFor(() =>
    assert.match(byRole(models.view.container, "alert").textContent, /Couldn't save session naming:.*read-only/),
  );
  assert.equal(toggle.checked, true);
  assert.equal(toggle.disabled, false);
  assert.equal(models.select.disabled, false);
  assert.deepEqual(models.settings(), { enabled: true, model: null, configured: true });
});

test("a failed naming model save restores the previous model and a later successful save clears the error", async (t) => {
  useNamingModel(t, null);
  let fail = true;
  const models = await mountModels(t, {
    save: (patch) => {
      if (fail) throw new Error("Connection lost");
      return { enabled: true, model: patch.model, configured: true };
    },
  });
  await selectOption(models.select, "deepseek/deepseek-chat");
  await waitFor(() => assert.match(byRole(models.view.container, "alert").textContent, /Connection lost/));
  assert.equal(models.select.value, "");
  fail = false;
  await selectOption(models.select, "openai/gpt-5");
  await waitFor(() => assert.deepEqual(models.settings().model, { provider: "openai", modelId: "gpt-5" }));
  assert.equal(models.select.value, "openai/gpt-5");
  assert.equal(byRole(models.view.container, "alert"), undefined);
});

test("session naming loads alongside configuration and model preferences while controls keep their layout disabled", async (t) => {
  useNamingModel(t, null);
  const config = createDeferred();
  const preferences = createDeferred();
  const naming = createDeferred();
  const models = await mountModels(t, {
    load: () => naming.promise,
    loadPreferences: () => preferences.promise,
    loadConfig: () => config.promise,
    waitUntilReady: false,
  });
  const toggle = labelledControl(models.view.container, "Auto-name new sessions");
  assert.equal(models.select.disabled, true);
  assert.equal(toggle.disabled, true);
  for (const method of ["modelsConfig.get", "models.preferences.get", "models.sessionNaming.get"])
    assert.equal(models.requests.filter((request) => request.method === method).length, 1);
  await act(async () => naming.resolve({ enabled: false, model: NAMING_MODEL, configured: true }));
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, true);
  assert.equal(models.select.disabled, true);
  assert.equal(models.select.value, "deepseek/deepseek-chat");
  await act(async () => {
    preferences.resolve({ models: PREFERENCE_MODELS, enabledModels: null });
    config.resolve({ config: { providers: {} }, version: "v1" });
  });
  assert.equal(models.select.disabled, false);
  assert.equal(toggle.disabled, false);
  assert.equal(labelledControl(models.view.container, "Naming model"), models.select);
  assert.equal(labelledControl(models.view.container, "Auto-name new sessions"), toggle);
});
