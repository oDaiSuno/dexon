import assert from "node:assert/strict";
import test, { after } from "node:test";
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
    'export { requestAutoSessionTitle, setSessionNamingModel } from "./src/renderer/lib/auto-session-title.ts";',
  ].join("\n"),
);
after(restoreGlobals);

const NAMING_MODEL = { provider: "deepseek", modelId: "deepseek-chat" };
const FIRST_MESSAGE = "Add a right-click menu to the sidebar sessions";

function session(overrides = {}) {
  return {
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
    [{ sessionId: "s1", message: FIRST_MESSAGE, provider: "deepseek", modelId: "deepseek-chat", replace: true }],
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

test("without a naming model, Regenerate name is greyed out, points to Settings and never asks for a name", async (t) => {
  useNamingModel(t, null);
  const view = await mountRow(t);
  const menu = await openMenu(view);
  const item = byRole(menu, "menuitem", "Regenerate name: choose a naming model in Settings");
  assert.ok(item, "the item explains that a naming model is needed");
  assert.match(item.textContent, /Regenerate name/);
  assert.match(item.textContent, /Go to settings/);
  assert.equal(item.disabled, false, "the item stays reachable so it can lead to Settings");
  await click(item);
  assert.equal(view.container.querySelector('[role="menu"]'), null);
  assert.deepEqual(view.titleRequests(), []);
});

test("automatic naming uses the chosen naming model instead of the conversation's model", async (t) => {
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
    sessionId: "fresh-1",
    message: "Fix the login page styling",
    provider: "openai",
    modelId: "gpt-5",
  });
  assert.equal(title, "Login page styling");
  assert.deepEqual(requests, [
    {
      method: "agent.generateTitle",
      params: {
        sessionId: "fresh-1",
        message: "Fix the login page styling",
        provider: "deepseek",
        modelId: "deepseek-chat",
      },
    },
  ]);
});

test("without a naming model, automatic naming keeps using the conversation's model", async (t) => {
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
    sessionId: "fresh-2",
    message: "Fix the login page",
    provider: "openai",
    modelId: "gpt-5",
  });
  assert.deepEqual(requests[0].params, {
    sessionId: "fresh-2",
    message: "Fix the login page",
    provider: "openai",
    modelId: "gpt-5",
  });
});

const PREFERENCE_MODELS = [
  { id: "deepseek-chat", name: "DeepSeek V3", provider: "deepseek" },
  { id: "deepseek-reasoner", name: "DeepSeek R1", provider: "deepseek" },
  { id: "gpt-5", name: "GPT-5", provider: "openai" },
];

async function mountModels(t) {
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method) {
        switch (method) {
          case "modelsConfig.get":
            return { config: { providers: {} }, version: "v1" };
          case "auth.providers":
          case "auth.allProviders":
            return { providers: [] };
          case "models.preferences.get":
            return { models: PREFERENCE_MODELS, enabledModels: ["deepseek/deepseek-chat", "openai/gpt-5"] };
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
    assert.ok(control.options.length > 1, "enabled models are listed");
    return control;
  });
  return { view, select };
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

test("a chosen naming model is remembered on this computer and enables Regenerate name in the session menu", async (t) => {
  useNamingModel(t, null);
  const first = await mountModels(t);
  const chosen = [...first.select.options].find((option) => option.textContent === "DeepSeek V3 · deepseek-chat");
  await selectOption(first.select, chosen.value);
  await first.view.unmount();
  const again = await mountModels(t);
  assert.equal(again.select.selectedOptions[0].textContent, "DeepSeek V3 · deepseek-chat");
  await again.view.unmount();

  const row = await mountRow(t);
  await click(byRole(await openMenu(row), "menuitem", "Regenerate name"));
  await waitFor(() => assert.equal(row.titleRequests().length, 1));
  assert.equal(row.titleRequests()[0].params.provider, "deepseek");
  assert.equal(row.titleRequests()[0].params.modelId, "deepseek-chat");
});

test("the session naming card shows the fixed example of a first message turning into a sidebar name", async (t) => {
  useNamingModel(t, null);
  const { view } = await mountModels(t);
  const text = view.container.textContent;
  assert.match(text, /First message/);
  assert.match(text, /≈ 1s/);
  assert.match(text, /Shown in the sidebar as/);
});

test("a session with no messages yet cannot have its name regenerated", async (t) => {
  useNamingModel(t, NAMING_MODEL);
  const view = await mountRow(t, { session: session({ messageCount: 0, firstMessage: "(no messages)" }) });
  const menu = await openMenu(view);
  assert.equal(byRole(menu, "menuitem", "Regenerate name").disabled, true);
});
