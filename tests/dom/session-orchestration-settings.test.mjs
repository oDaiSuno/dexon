import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  dom,
  input,
  labelledControl,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../support/renderer.mjs";
import { blur } from "../support/dom-events.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "session-orchestration-settings",
  'export {GeneralSettings} from "./src/renderer/components/settings/general-settings.tsx";',
);
after(restoreGlobals);

const ENABLED_DEFAULTS = { enabled: true, maxRunning: 8, model: null, thinkingLevel: null, allowUserSessions: true };
const SAVED_DEFAULTS = {
  sessionOrchestration: { enabled: true, maxRunning: 8, model: null, thinkingLevel: null, allowUserSessions: true },
};

// Only the other process answers: the Host's model catalogue and the desktop
// bridge's preference store. The settings component itself stays production code.
const host = {
  call: async (method) => {
    if (method === "models.list") {
      return {
        models: [],
        nameMap: {},
        thinkingLevels: {},
        thinkingLevelMaps: {},
        catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] },
        defaultModel: null,
      };
    }
    throw new Error(`Settings fixture has no reply for ${method}`);
  },
};

function createBridge({ sessionOrchestration, failSave = false } = {}) {
  const saves = [];
  const state = {
    backgroundMode: true,
    managedProcessesEnabled: false,
    ...(sessionOrchestration ? { sessionOrchestration: structuredClone(sessionOrchestration) } : {}),
  };
  const bridge = {
    getUiState: async () => structuredClone(state),
    setUiState: async (patch) => {
      saves.push(structuredClone(patch));
      if (failSave) throw new Error("persist failed");
      Object.assign(state, patch);
      return patch;
    },
    getManagedProcessCapability: async () => ({ ready: true, backend: "test" }),
  };
  return { bridge, saves };
}

async function renderGeneral(t, options = {}) {
  const { bridge, saves } = createBridge(options);
  const boundary = installRendererApi(dom.window, api, () => host, { bridge });
  const view = await mount(
    t,
    api.GeneralSettings,
    {
      language: options.language ?? "en-US",
      onLanguageChange: () => {},
      isDark: false,
      onThemeChange: () => {},
      chatAppearance: { fontSize: "standard", layout: "fixed" },
      chatAppearanceSaving: false,
      onChatAppearanceChange: async () => {},
    },
    { release: boundary.close },
  );
  return { view, saves };
}

async function loaded(view) {
  const boxes = () => [...view.container.querySelectorAll('input[type="checkbox"]')];
  await waitFor(() =>
    assert.ok(
      boxes().length >= 2 && boxes().every((box) => !box.disabled),
      "the settings page finished loading its saved values",
    ),
  );
}

function alerts(container) {
  return [...container.querySelectorAll('[role="alert"]')].map((element) => element.textContent);
}

test("session collaboration is offered switched off, without its extra controls", async (t) => {
  const { view } = await renderGeneral(t);
  await loaded(view);
  assert.match(view.container.textContent, /Session collaboration/);
  assert.equal(labelledControl(view.container, "Enable session collaboration").checked, false);
  assert.throws(() => labelledControl(view.container, "Maximum running sessions"), /Missing labelled control/);
  assert.throws(() => labelledControl(view.container, "Session model"), /Missing labelled control/);
});

test("switching session collaboration on saves every default and reveals its controls", async (t) => {
  const { view, saves } = await renderGeneral(t);
  await loaded(view);
  await click(labelledControl(view.container, "Enable session collaboration"));
  await waitFor(() => assert.deepEqual(saves.at(-1), SAVED_DEFAULTS));
  for (const label of ["Maximum running sessions", "Session model", "Thinking level", "Allow messaging any session"])
    labelledControl(view.container, label);
});

test("changing how many agent sessions may run together saves the new limit", async (t) => {
  const { view, saves } = await renderGeneral(t, { sessionOrchestration: ENABLED_DEFAULTS });
  await loaded(view);
  const limit = labelledControl(view.container, "Maximum running sessions");
  await input(limit, "4");
  await blur(limit);
  await waitFor(() =>
    assert.deepEqual(saves.at(-1), {
      sessionOrchestration: { enabled: true, maxRunning: 4, model: null, thinkingLevel: null, allowUserSessions: true },
    }),
  );
});

test("a limit outside the allowed range is never saved", async (t) => {
  const { view, saves } = await renderGeneral(t, { sessionOrchestration: ENABLED_DEFAULTS });
  await loaded(view);
  const limit = () => labelledControl(view.container, "Maximum running sessions");
  for (const typed of ["0", "40"]) {
    await input(limit(), typed);
    await blur(limit());
    await waitFor(() => {
      const shown = Number(limit().value);
      assert.ok(shown >= 1 && shown <= 32, `the field keeps a usable limit instead of ${shown}`);
    });
  }
  for (const patch of saves.filter((entry) => entry.sessionOrchestration)) {
    const persisted = patch.sessionOrchestration.maxRunning;
    assert.ok(persisted >= 1 && persisted <= 32, `a saved limit of ${persisted} stays inside 1..32`);
  }
});

test("a failed save restores the previous setting and reports it", async (t) => {
  const { view } = await renderGeneral(t, { failSave: true });
  await loaded(view);
  await click(labelledControl(view.container, "Enable session collaboration"));
  await waitFor(() => assert.equal(labelledControl(view.container, "Enable session collaboration").checked, false));
  assert.ok(
    alerts(view.container).some((message) => message.includes("Session collaboration settings could not be saved")),
    "the save failure is reported",
  );
});

test("the Chinese interface calls the feature 会话协作", async (t) => {
  await act(async () => api.setAppLanguage("zh-CN"));
  t.after(async () => act(async () => api.setAppLanguage("en-US")));
  const { view } = await renderGeneral(t, { language: "zh-CN" });
  await loaded(view);
  assert.match(view.container.textContent, /会话协作/);
  assert.equal(labelledControl(view.container, "启用会话协作").checked, false);
});
