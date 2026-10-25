import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  byRole,
  click,
  dom,
  input,
  labelledControl,
  loadRenderer,
  mount,
  restoreGlobals,
  selectOption,
  waitFor,
} from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "default-model-behavior",
  [
    'export { ModelPickerCard } from "./src/renderer/components/chat-input/model-picker-card.tsx";',
    'export { ModelsConfig } from "./src/renderer/components/ModelsConfig.tsx";',
  ].join("\n"),
);
after(restoreGlobals);

function option(provider, modelId, name) {
  return { provider, modelId, name, image: false, reasoning: false };
}

const ANTHROPIC = {
  provider: "anthropic",
  name: "Anthropic",
  custom: false,
  options: [
    option("anthropic", "claude-opus-4-5", "Claude Opus 4.5"),
    option("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5"),
    option("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5"),
  ],
};
const OPENAI = {
  provider: "openai",
  name: "OpenAI",
  custom: false,
  options: [option("openai", "gpt-5", "GPT-5")],
};

function freshStorage(t) {
  dom.window.localStorage.clear();
  t.after(() => dom.window.localStorage.clear());
}

async function mountPicker(t, { groups = [ANTHROPIC, OPENAI], model = null } = {}) {
  const picks = [];
  const view = await mount(t, api.ModelPickerCard, {
    panelRef: { current: null },
    buttonRef: { current: null },
    style: {},
    model,
    groups,
    onModelPick: (provider, modelId, isActive) => picks.push({ provider, modelId, isActive }),
    onClose() {},
  });
  return { view, picks };
}

function recentGroup(container) {
  return byRole(container, "group", "Recently used");
}

function rowNames(group) {
  return [...group.querySelectorAll("button")].map((row) => row.textContent.trim());
}

async function pick(container, groupName, modelName) {
  await click(byRole(byRole(container, "group", groupName), "button", modelName));
}

test("before any model has been picked, the picker shows no Recently used group", async (t) => {
  freshStorage(t);
  const { view } = await mountPicker(t);
  assert.equal(recentGroup(view.container), undefined);
  assert.equal(view.container.querySelector('[role="separator"]'), null);
});

test("the next time the picker opens, the three most recently picked models come first, newest on top, then a separator", async (t) => {
  freshStorage(t);
  const first = await mountPicker(t);
  await pick(first.view.container, "Anthropic", "Claude Opus 4.5");
  await pick(first.view.container, "Anthropic", "Claude Haiku 4.5");
  await pick(first.view.container, "OpenAI", "GPT-5");
  await pick(first.view.container, "Anthropic", "Claude Sonnet 4.5");
  await first.view.unmount();

  const again = await mountPicker(t);
  const group = await waitFor(() => {
    const found = recentGroup(again.view.container);
    assert.ok(found, "the Recently used group is listed");
    return found;
  });
  assert.deepEqual(rowNames(group), ["Claude Sonnet 4.5", "GPT-5", "Claude Haiku 4.5"]);
  const separator = again.view.container.querySelector('[role="separator"]');
  assert.ok(separator, "a separator divides recent models from the full list");
  const anthropic = byRole(again.view.container, "group", "Anthropic");
  const order = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(group.compareDocumentPosition(separator) & order, "the separator follows the recent group");
  assert.ok(separator.compareDocumentPosition(anthropic) & order, "the full list follows the separator");
  assert.deepEqual(rowNames(anthropic), ["Claude Opus 4.5", "Claude Sonnet 4.5", "Claude Haiku 4.5"]);
});

test("picking a model again moves it to the top without listing it twice", async (t) => {
  freshStorage(t);
  const first = await mountPicker(t);
  await pick(first.view.container, "Anthropic", "Claude Opus 4.5");
  await pick(first.view.container, "OpenAI", "GPT-5");
  await pick(first.view.container, "Anthropic", "Claude Opus 4.5");
  await first.view.unmount();

  const again = await mountPicker(t);
  assert.deepEqual(rowNames(recentGroup(again.view.container)), ["Claude Opus 4.5", "GPT-5"]);
});

test("a recent row picks that model and is marked when it is the current model", async (t) => {
  freshStorage(t);
  const first = await mountPicker(t);
  await pick(first.view.container, "OpenAI", "GPT-5");
  await first.view.unmount();

  const again = await mountPicker(t, { model: { provider: "openai", modelId: "gpt-5" } });
  const row = byRole(recentGroup(again.view.container), "button", "GPT-5");
  assert.equal(row.getAttribute("aria-current"), "true");
  await click(row);
  assert.deepEqual(again.picks.at(-1), { provider: "openai", modelId: "gpt-5", isActive: true });
});

test("a recently used model that is no longer available is left out of Recently used", async (t) => {
  freshStorage(t);
  const first = await mountPicker(t);
  await pick(first.view.container, "OpenAI", "GPT-5");
  await pick(first.view.container, "Anthropic", "Claude Haiku 4.5");
  await first.view.unmount();

  const withoutOpenAI = await mountPicker(t, { groups: [ANTHROPIC] });
  assert.deepEqual(rowNames(recentGroup(withoutOpenAI.view.container)), ["Claude Haiku 4.5"]);
  await withoutOpenAI.view.unmount();

  const nothingLeft = await mountPicker(t, { groups: [OPENAI] });
  assert.deepEqual(rowNames(recentGroup(nothingLeft.view.container)), ["GPT-5"]);
  await nothingLeft.view.unmount();

  const noneAvailable = await mountPicker(t, {
    groups: [{ ...ANTHROPIC, options: [ANTHROPIC.options[0]] }],
  });
  assert.equal(recentGroup(noneAvailable.view.container), undefined);
  assert.equal(noneAvailable.view.container.querySelector('[role="separator"]'), null);
});

test("while searching, Recently used is hidden and only matching models are listed", async (t) => {
  freshStorage(t);
  const first = await mountPicker(t);
  await pick(first.view.container, "OpenAI", "GPT-5");
  await first.view.unmount();

  const again = await mountPicker(t);
  await input(byRole(again.view.container, "searchbox", "Search models…"), "claude");
  assert.equal(recentGroup(again.view.container), undefined);
  assert.equal(again.view.container.querySelector('[role="separator"]'), null);
  assert.deepEqual(rowNames(byRole(again.view.container, "group", "Anthropic")), [
    "Claude Opus 4.5",
    "Claude Sonnet 4.5",
    "Claude Haiku 4.5",
  ]);
});

const PREFERENCE_MODELS = [
  { id: "deepseek-chat", name: "DeepSeek V3", provider: "deepseek" },
  { id: "deepseek-reasoner", name: "DeepSeek R1", provider: "deepseek" },
  { id: "gpt-5", name: "GPT-5", provider: "github-copilot" },
];

async function mountModels(t, { defaults = { model: null, thinkingLevel: "medium" }, save } = {}) {
  const saves = [];
  let changed = 0;
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method, params) {
        switch (method) {
          case "modelsConfig.get":
            return { config: { providers: {} }, version: "v1" };
          case "auth.providers":
          case "auth.allProviders":
            return { providers: [] };
          case "models.preferences.get":
            return { models: PREFERENCE_MODELS, enabledModels: ["deepseek/deepseek-chat", "github-copilot/gpt-5"] };
          case "modelsConfig.channels.get":
            return { channels: {} };
          case "models.defaults.get":
            return defaults;
          case "models.defaults.set":
            saves.push(params);
            return save ? save(params) : { ...defaults, ...params };
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
    { onClose() {}, onChanged: () => (changed += 1), embedded: true, cwd: "/workspace" },
    { release: host.close },
  );
  const modelSelect = await waitFor(() => {
    const control = labelledControl(view.container, "New sessions use");
    assert.ok(control.options.length > 1, "enabled models are listed");
    assert.equal(control.disabled, false, "the saved default has loaded");
    return control;
  });
  const thinkingSelect = view.container.querySelector('select[aria-label="Default thinking level"]');
  assert.ok(thinkingSelect, "the thinking level control is named for screen readers");
  return { view, modelSelect, thinkingSelect, saves, changed: () => changed };
}

function optionTexts(select) {
  return [...select.options].map((entry) => entry.textContent);
}

function chosen(select) {
  return select.selectedOptions[0].textContent;
}

test("the Models settings page starts with Default model, then Session naming, then the channel groups", async (t) => {
  const { view } = await mountModels(t);
  const headings = [...view.container.querySelectorAll("h2")].map((heading) => heading.textContent.trim());
  assert.equal(headings[0], "Default model");
  assert.equal(headings[1], "Session naming");
  assert.ok(headings.indexOf("Custom channels") > 1, "channel groups come after the two setting groups");
  assert.match(view.container.textContent, /Only affects sessions created after this\./);
});

test("the default model lists only enabled models and the thinking level lists every level Pi accepts", async (t) => {
  const { modelSelect, thinkingSelect } = await mountModels(t, {
    defaults: { model: { provider: "github-copilot", modelId: "gpt-5" }, thinkingLevel: "high" },
  });
  assert.deepEqual(optionTexts(modelSelect), ["DeepSeek V3 · DeepSeek", "GPT-5 · GitHub Copilot"]);
  assert.equal(chosen(modelSelect), "GPT-5 · GitHub Copilot");
  assert.deepEqual(optionTexts(thinkingSelect), [
    "Thinking: Off",
    "Thinking: Minimal",
    "Thinking: Low",
    "Thinking: Medium",
    "Thinking: High",
    "Thinking: Extra high",
    "Thinking: Max",
  ]);
  assert.equal(chosen(thinkingSelect), "Thinking: High");
});

test("with no default model saved yet, the model control says Not set", async (t) => {
  const { modelSelect, thinkingSelect } = await mountModels(t);
  assert.equal(chosen(modelSelect), "Not set");
  assert.equal(chosen(thinkingSelect), "Thinking: Medium");
});

test("choosing a model saves it as the shared default without changing the thinking level", async (t) => {
  const models = await mountModels(t);
  const deepseek = [...models.modelSelect.options].find((entry) => entry.textContent === "DeepSeek V3 · DeepSeek");
  await selectOption(models.modelSelect, deepseek.value);
  await waitFor(() => assert.equal(models.saves.length, 1));
  assert.deepEqual(models.saves[0].model, { provider: "deepseek", modelId: "deepseek-chat" });
  assert.equal(models.saves[0].thinkingLevel, undefined);
  await waitFor(() => assert.equal(models.changed(), 1, "open chats reload the new-session default"));
  assert.equal(chosen(models.modelSelect), "DeepSeek V3 · DeepSeek");
});

test("choosing a thinking level saves only the thinking level", async (t) => {
  const models = await mountModels(t, {
    defaults: { model: { provider: "deepseek", modelId: "deepseek-chat" }, thinkingLevel: "medium" },
  });
  await selectOption(models.thinkingSelect, "low");
  await waitFor(() => assert.equal(models.saves.length, 1));
  assert.equal(models.saves[0].thinkingLevel, "low");
  assert.equal(models.saves[0].model, undefined);
  await waitFor(() => assert.equal(chosen(models.thinkingSelect), "Thinking: Low"));
});

test("when saving fails, the page says why and keeps showing the previous default", async (t) => {
  const models = await mountModels(t, {
    defaults: { model: { provider: "deepseek", modelId: "deepseek-chat" }, thinkingLevel: "medium" },
    save: () => {
      throw new Error("settings.json is read-only");
    },
  });
  await selectOption(models.thinkingSelect, "max");
  const alert = await waitFor(() => {
    const found = [...models.view.container.querySelectorAll('[role="alert"]')].find((node) =>
      /read-only/.test(node.textContent),
    );
    assert.ok(found, "the save error is announced");
    return found;
  });
  assert.ok(alert);
  assert.equal(chosen(models.thinkingSelect), "Thinking: Medium");
  assert.equal(models.changed(), 0);
});
