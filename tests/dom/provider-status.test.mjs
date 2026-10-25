import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  dom,
  button,
  byRole,
  click,
  input,
  labelledControl,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "provider-status",
  'export {ModelsConfig} from "./src/renderer/components/ModelsConfig.tsx";',
);
api.setAppLanguage("en-US");
after(restoreGlobals);

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

function storedChannels() {
  return {
    openrouter: { enabled: false, lastTest: null },
    deepseek: { enabled: true, lastTest: { ok: true, latencyMs: 182, status: 200, testedAt: minutesAgo(2) } },
    gateway: {
      enabled: true,
      lastTest: { ok: false, reason: "timeout", error: "Request timed out", testedAt: minutesAgo(5) },
    },
  };
}

async function openModels(t, { setEnabled, testChannel } = {}) {
  const calls = [];
  let changed = 0;
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
                    models: [{ id: "acme-chat" }],
                  },
                  gateway: {
                    api: "openai-completions",
                    baseUrl: "https://llm.corp.internal/v1",
                    models: [{ id: "corp-chat" }],
                  },
                },
              },
              version: "v1",
            };
          case "modelsConfig.channels.get":
            return { channels: storedChannels() };
          case "modelsConfig.channels.setEnabled":
            if (setEnabled) return setEnabled(params);
            return {
              channels: { ...storedChannels(), [params.provider]: { enabled: params.enabled, lastTest: null } },
            };
          case "modelsConfig.channels.test":
            return testChannel(params);
          case "auth.providers":
            return { providers: [] };
          case "auth.allProviders":
            return {
              providers: [
                { id: "deepseek", displayName: "DeepSeek", configured: true, modelCount: 3 },
                { id: "openrouter", displayName: "OpenRouter", configured: true, modelCount: 12 },
              ],
            };
          case "models.preferences.get":
            return { enabledModels: null, models: [] };
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
    { onClose() {}, onChanged: () => changed++, embedded: true, cwd: "/workspace" },
    { release: host.close },
  );
  const row = (name) =>
    [...view.container.querySelectorAll("[role='button']")].find((element) =>
      [...element.querySelectorAll("span")].some((span) => span.textContent === name),
    );
  await waitFor(() => assert.ok(row("gateway") && row("DeepSeek")));
  await waitFor(() => assert.match(row("OpenRouter").textContent, /Disabled/));
  const dialogs = () => [...dom.window.document.querySelectorAll("[role='dialog']")];
  const callsOf = (method) => calls.filter((entry) => entry.method === method).map((entry) => entry.params);
  return { view, row, dialogs, callsOf, changes: () => changed };
}

test("every channel row shows its saved state: a turned-off channel stays listed as Disabled, a timed-out one says so", async (t) => {
  const models = await openModels(t);

  assert.match(models.row("OpenRouter").textContent, /Disabled/);
  assert.equal(byRole(models.view.container, "switch", "Enable OpenRouter").checked, false);

  assert.match(models.row("DeepSeek").textContent, /Active/);
  assert.equal(byRole(models.view.container, "switch", "Enable DeepSeek").checked, true);

  assert.match(models.row("gateway").textContent, /Timed out/);
  assert.equal(byRole(models.view.container, "switch", "Enable gateway").checked, true);

  assert.match(models.row("acme").textContent, /Active/);
  assert.equal(byRole(models.view.container, "switch", "Enable acme").checked, true);
});

test("switching a channel off saves it, marks the row Disabled, tells open sessions, and does not open its details", async (t) => {
  const models = await openModels(t);

  await click(byRole(models.view.container, "switch", "Enable DeepSeek"));

  await waitFor(() => assert.match(models.row("DeepSeek").textContent, /Disabled/));
  assert.deepEqual(models.callsOf("modelsConfig.channels.setEnabled"), [{ provider: "deepseek", enabled: false }]);
  assert.equal(byRole(models.view.container, "switch", "Enable DeepSeek").checked, false);
  assert.equal(models.changes(), 1, "open sessions are told the model list changed");
  assert.equal(models.dialogs().length, 0, "the switch does not open the channel details");
});

test("when switching a channel fails, the switch keeps its old position and the reason is shown", async (t) => {
  const models = await openModels(t, {
    setEnabled() {
      throw new Error("settings file is read-only");
    },
  });

  await click(byRole(models.view.container, "switch", "Enable acme"));

  await waitFor(() => assert.match(byRole(models.view.container, "alert").textContent, /settings file is read-only/));
  assert.equal(byRole(models.view.container, "switch", "Enable acme").checked, true);
  assert.match(models.row("acme").textContent, /Active/);
  assert.equal(models.changes(), 0);
});

test("the channel details show the last test result, and testing again replaces it in the details and the row", async (t) => {
  let release;
  const models = await openModels(t, {
    testChannel: (params) =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            ok: false,
            reason: "error",
            error: "401 Unauthorized",
            testedAt: new Date().toISOString(),
            provider: params.provider,
          });
      }),
  });

  await click(models.row("DeepSeek"));
  const dialog = models.dialogs().at(-1);
  assert.match(dialog.textContent, /Connection OK · 182 ms · 2 min ago/);

  const testButton = button(dialog, "Test connection");
  await click(testButton);
  assert.deepEqual(models.callsOf("modelsConfig.channels.test"), [{ provider: "deepseek" }]);
  await waitFor(() => assert.ok(button(dialog, "Testing…")?.disabled, "the button shows the test is running"));

  release();
  await waitFor(() => assert.match(dialog.textContent, /Connection failed · 401 Unauthorized · just now/));
  assert.doesNotMatch(dialog.textContent, /Connection OK/);
  assert.equal(button(dialog, "Test connection").disabled, false);
  assert.match(models.row("DeepSeek").textContent, /Connection failed/);
});

test("a custom channel with unsaved edits cannot be tested until the edits are saved", async (t) => {
  const models = await openModels(t, {
    testChannel: () => ({ ok: true, latencyMs: 90, testedAt: new Date().toISOString() }),
  });

  await click(models.row("gateway"));
  const dialog = models.dialogs().at(-1);
  assert.match(dialog.textContent, /Timed out · 5 min ago/);
  assert.equal(button(dialog, "Test connection").disabled, false);

  await input(labelledControl(dialog, "Base URL"), "https://llm.corp.internal/v2");
  const blocked = button(dialog, "Test connection");
  assert.equal(blocked.disabled, true);
  assert.equal(blocked.getAttribute("title"), "Save your changes before testing");
});
