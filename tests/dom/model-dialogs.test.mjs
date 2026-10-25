import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  dom,
  button,
  click,
  input,
  keyDown,
  labelledControl,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../support/renderer.mjs";
import { blur } from "../support/dom-events.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "model-dialogs-behavior",
  'export {ModelsConfig} from "./src/renderer/components/ModelsConfig.tsx";',
);
after(restoreGlobals);

const COPILOT_MODELS = Array.from({ length: 9 }, (_, index) => ({
  id: `copilot-${index + 1}`,
  name: `copilot-${index + 1}`,
  provider: "github-copilot",
}));

async function openModels(t) {
  const calls = [];
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method, params) {
        calls.push({ method, params });
        switch (method) {
          case "modelsConfig.get":
            return {
              config: {
                providers: {
                  acme: {
                    api: "openai-completions",
                    baseUrl: "https://acme.example/v1",
                    models: [{ id: "acme-chat", reasoning: true }],
                  },
                },
              },
              version: "v1",
            };
          case "modelsConfig.set":
            return { ok: true, version: "v2" };
          case "modelsConfig.test":
            return { ok: true, latencyMs: 120, status: 200 };
          case "auth.providers":
            return {
              providers: [
                { id: "github-copilot", name: "GitHub Copilot", loggedIn: true },
                { id: "openai-codex", name: "ChatGPT Plus/Pro", loggedIn: false },
                { id: "google-gemini-cli", name: "Gemini CLI", loggedIn: false },
              ],
            };
          case "auth.allProviders":
            return { providers: [{ id: "deepseek", displayName: "DeepSeek", configured: true, modelCount: 2 }] };
          case "auth.setApiKey":
            return { ok: true, synchronized: true };
          case "auth.loginCancel":
            return { ok: true };
          case "auth.loginStart":
            return { ok: true, started: true };
          case "models.preferences.get":
            return {
              enabledModels: null,
              models: [...COPILOT_MODELS, { id: "x", name: "x", provider: "other" }],
            };
          case "models.defaults.get":
            return { model: null, thinkingLevel: "medium" };
          case "models.preferences.set":
            return {
              enabledModels: params.enabledModels,
              models: [...COPILOT_MODELS, { id: "x", name: "x", provider: "other" }],
            };
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
  await waitFor(() => assert.ok(view.container.textContent.includes("acme")));
  const openRow = (name) =>
    click([...view.container.querySelectorAll("span")].find((element) => element.textContent === name));
  const dialog = () => {
    const dialogs = [...dom.window.document.querySelectorAll("[role='dialog']")];
    assert.ok(dialogs.length > 0, "a dialog is open");
    return dialogs.at(-1);
  };
  const callsOf = (method) => calls.filter((entry) => entry.method === method).map((entry) => entry.params);
  return { view, openRow, dialog, callsOf };
}

async function openModelDialog(models) {
  await models.openRow("acme");
  const channel = models.dialog();
  await click([...channel.querySelectorAll("button")].find((element) => element.textContent.includes("acme-chat")));
  const dialog = models.dialog();
  assert.match(dialog.textContent, /Configure model/);
  return dialog;
}

test("the configure model dialog keeps API override, thinking options and prices folded under Advanced settings", async (t) => {
  const models = await openModels(t);
  const dialog = await openModelDialog(models);
  const advanced = button(dialog, "Advanced settings");
  assert.ok(advanced, "an Advanced settings toggle is shown");
  assert.equal(advanced.getAttribute("aria-expanded"), "false", "it starts collapsed");
  assert.doesNotMatch(dialog.textContent, /API override/);
  assert.doesNotMatch(dialog.textContent, /DeepSeek thinking compatibility/);
  assert.doesNotMatch(dialog.textContent, /Cost \(per million tokens\)/);

  await click(advanced);
  assert.equal(advanced.getAttribute("aria-expanded"), "true");
  assert.ok(labelledControl(dialog, "API override"), "API override becomes editable");
  assert.match(dialog.textContent, /DeepSeek thinking compatibility/);
  assert.match(dialog.textContent, /Thinking level map/);
  assert.match(dialog.textContent, /Cost \(per million tokens\)/);
});

test("testing and deleting a single model happen from the dialog's bottom bar", async (t) => {
  const models = await openModels(t);
  const dialog = await openModelDialog(models);
  const footer = dialog.querySelector("footer");
  assert.ok(footer, "the dialog has a bottom bar");
  const header = dialog.querySelector("header");
  assert.equal(Boolean(button(header, "Test")), false, "no test button at the top");
  assert.ok(button(footer, "Delete model"), "delete sits in the bottom bar");
  const testButton = button(footer, "Test");
  assert.ok(testButton, "test sits in the bottom bar");

  await click(testButton);
  await waitFor(() => assert.match(footer.querySelector("[role='status']")?.textContent ?? "", /Connected/));
  assert.equal(models.callsOf("modelsConfig.test")[0].model.id, "acme-chat");
});

test("a custom channel is renamed by clicking its title, and the new name is used when saved", async (t) => {
  const models = await openModels(t);
  await models.openRow("acme");
  const dialog = models.dialog();
  assert.throws(() => labelledControl(dialog, "Provider name"), "the separate name field is gone");

  await click(button(dialog, "Rename acme"));
  const nameField = dialog.querySelector("input[aria-label='Channel name']");
  assert.ok(nameField, "clicking the title turns it into a name field");
  await input(nameField, "acme-2");
  await keyDown(nameField, "Enter");
  assert.ok(button(dialog, "Rename acme-2"), "the title shows the new name");

  await click(button(dialog, "Save"));
  await waitFor(() => assert.equal(models.callsOf("modelsConfig.set").length, 1));
  const saved = models.callsOf("modelsConfig.set")[0].config.providers;
  assert.deepEqual(Object.keys(saved), ["acme-2"]);
});

test("pressing Escape while renaming keeps the old name and leaves the dialog open", async (t) => {
  const models = await openModels(t);
  await models.openRow("acme");
  const dialog = models.dialog();
  await click(button(dialog, "Rename acme"));
  const nameField = dialog.querySelector("input[aria-label='Channel name']");
  await input(nameField, "typo");
  await keyDown(nameField, "Escape");
  assert.ok(dialog.isConnected, "the dialog stays open");
  assert.ok(button(dialog, "Rename acme"), "the old name is kept");
});

test("a built-in provider saves its API key and base URL as soon as the field is left", async (t) => {
  const models = await openModels(t);
  await models.openRow("DeepSeek");
  const dialog = models.dialog();
  assert.equal(Boolean(button(dialog, "Save")), false, "there is no separate save button");

  const keyField = labelledControl(dialog, "API Key");
  await input(keyField, "sk-new");
  await blur(keyField);
  await waitFor(() => assert.deepEqual(models.callsOf("auth.setApiKey"), [{ provider: "deepseek", key: "sk-new" }]));
  await waitFor(() => assert.match(dialog.textContent, /Saved/));
  assert.ok(dialog.isConnected, "the dialog stays open after saving");
  assert.equal(labelledControl(dialog, "API Key").value, "");

  const baseUrlField = labelledControl(dialog, "Base URL");
  await input(baseUrlField, "https://proxy.example/v1");
  await blur(baseUrlField);
  await waitFor(() => assert.equal(models.callsOf("modelsConfig.set").length, 1));
  assert.equal(models.callsOf("modelsConfig.set")[0].config.providers.deepseek.baseUrl, "https://proxy.example/v1");
});

test("enable all and disable all live in the model list's more menu, with search above a long list", async (t) => {
  const models = await openModels(t);
  await models.openRow("GitHub Copilot");
  const dialog = models.dialog();
  await waitFor(() => assert.match(dialog.textContent, /copilot-9/));
  assert.equal(Boolean(button(dialog, "Enable all")), false);
  assert.equal(Boolean(button(dialog, "Disable all")), false);
  assert.ok(dialog.querySelector("input[type='search']"), "nine models get a search box");

  const more = button(dialog, "More model actions");
  assert.ok(more, "the model list title has a more button");
  assert.equal(more.getAttribute("aria-haspopup"), "menu");
  await click(more);
  const menu = dom.window.document.querySelector("[role='menu']");
  assert.ok(menu, "the more menu opens");
  const items = [...menu.querySelectorAll("[role='menuitem']")];
  const enableAll = items.find((item) => item.textContent === "Enable all");
  const disableAll = items.find((item) => item.textContent === "Disable all");
  assert.equal(enableAll?.disabled, true, "everything is already on");
  assert.equal(disableAll?.disabled, false);

  await click(disableAll);
  await waitFor(() => assert.equal(models.callsOf("models.preferences.set").length, 1));
  assert.deepEqual(models.callsOf("models.preferences.set")[0].enabledModels, ["other/x"]);
});

test("the Login button on a signed-out account starts signing in right away; the row itself only opens details", async (t) => {
  const models = await openModels(t);
  await models.openRow("Gemini CLI");
  assert.match(models.dialog().textContent, /Gemini CLI/);
  assert.deepEqual(models.callsOf("auth.loginStart"), [], "opening details does not start a login");
  await click(button(models.dialog(), "Close"));

  await click(button(models.view.container, "Log in to ChatGPT Plus/Pro"));
  await waitFor(() => assert.deepEqual(models.callsOf("auth.loginStart"), [{ provider: "openai-codex" }]));
});
