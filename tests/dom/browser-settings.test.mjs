import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  dom,
  byRole,
  click,
  input,
  keyDown,
  selectOption,
  button,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../support/renderer.mjs";
import { browserState } from "../support/browser-state.mjs";
const { BrowserSettings, SettingsConfig, setAppLanguage } = await loadRenderer(
  "browser-settings-behavior",
  'export {BrowserSettings} from "./src/renderer/components/browser/BrowserSettings.tsx"; export {SettingsConfig} from "./src/renderer/components/SettingsConfig.tsx";',
);
after(restoreGlobals);
function field(container, label) {
  return [...container.querySelectorAll("label")].find((element) => element.textContent.includes(label));
}
function installMain() {
  const state = browserState();
  const permissions = [];
  const confirmations = [];
  const updates = [];
  state.runtimeSessionGrants["session-one"] = { permission: "read", source: "local", expiresAt: 30000 };
  dom.window.piBridge = {
    browserGetState: async () => structuredClone(state),
    browserListPageSnippets: async () => [],
    browserSetPersistentSessionPermission: async (id, permission) => {
      permissions.push([id, permission]);
      state.persistentSessionPermissions[id] = permission;
    },
    browserRevokeTemporarySessionPermission: async (id) => {
      delete state.runtimeSessionGrants[id];
    },
    browserRequestConfirmation: async (...args) => {
      confirmations.push(args);
      return { token: "main-confirmation" };
    },
    browserUpdateSettings: async (patch, proof) => {
      updates.push([patch, proof]);
      if (patch.advancedBrowserMode) {
        state.settings.settings.advancedBrowserMode.enabled = patch.advancedBrowserMode.enabled;
        state.settings.runtime.advancedBrowserModeEnabled = patch.advancedBrowserMode.enabled;
      }
    },
    onUpdateState: () => () => {},
    getUpdateState: async () => ({ phase: "idle", currentVersion: "0.1.0", automaticChecksEnabled: false }),
    getUiState: async () => ({}),
    getManagedProcessCapability: async () => ({ ready: false }),
  };
  return { state, permissions, confirmations, updates };
}

test("permanent permission and temporary grants remain independent user actions", async (t) => {
  const main = installMain();
  setAppLanguage("en-US");
  const view = await mount(t, BrowserSettings, { sessionId: "session-one" });
  const select = field(view.container, "Permanent Browser permission for this session").querySelector("select");
  await selectOption(select, "interact");
  assert.deepEqual(main.permissions, [["session-one", "interact"]]);
  assert.equal(main.state.runtimeSessionGrants["session-one"].permission, "read");
  await click(button(view.container, "Revoke temporary permission"));
  assert.equal(button(view.container, "Revoke temporary permission"), undefined);
  assert.equal(select.value, "interact", "revoking temporary access does not erase saved policy");
});

test("advanced mode requires the exact in-app phrase and a Main confirmation", async (t) => {
  const main = installMain();
  setAppLanguage("en-US");
  const view = await mount(t, BrowserSettings, { sessionId: null });
  await click(field(view.container, "Enable Advanced Browser Mode for this launch").querySelector("input"));
  const prompt = view.container.querySelector('[role="dialog"]');
  assert.ok(prompt);
  assert.equal(button(prompt, "Continue").disabled, true);
  await input(prompt.querySelector("input"), "ENABLE UNSAFE BROWSER");
  assert.equal(button(prompt, "Continue").disabled, true);
  assert.deepEqual(main.updates, []);
  await input(prompt.querySelector("input"), "ENABLE ADVANCED BROWSER");
  await click(button(prompt, "Continue"));
  assert.deepEqual(main.confirmations, [
    ["advanced-browser-mode", { advancedBrowserMode: { enabled: true } }, "en-US"],
  ]);
  assert.deepEqual(main.updates, [[{ advancedBrowserMode: { enabled: true } }, { token: "main-confirmation" }]]);
  assert.equal(view.container.querySelector('[role="dialog"]'), null);
});

test("Browser settings are reachable by vertical keyboard navigation and use the selected language", async (t) => {
  installMain();
  setAppLanguage("zh-CN");
  t.after(() => setAppLanguage("en-US"));
  const view = await mount(t, SettingsConfig, {
    cwd: "/workspace",
    sessionId: "session-one",
    initialTab: "browser",
    onClose() {},
    onModelsChanged() {},
    onPluginsReloaded() {},
    onChannelsChanged() {},
    chatAppearance: { fontSize: "standard", layout: "fixed" },
    chatAppearanceSaving: false,
    onChatAppearanceChange: async () => {},
  });
  assert.equal(view.container.querySelector('[role="tablist"]').getAttribute("aria-orientation"), "vertical");
  assert.match(view.container.textContent, /内置浏览器/);
  assert.match(view.container.textContent, /此会话的永久浏览器权限/);
  const browser = byRole(view.container, "tab", "浏览器");
  assert.equal(browser.getAttribute("aria-selected"), "true");
  await keyDown(browser, "Home");
  const general = byRole(view.container, "tab", "通用");
  assert.equal(general.getAttribute("aria-selected"), "true");
  await keyDown(general, "End");
  const about = byRole(view.container, "tab", "关于");
  assert.equal(about.getAttribute("aria-selected"), "true");
  await keyDown(about, "ArrowDown");
  assert.equal(general.getAttribute("aria-selected"), "true");
  await keyDown(general, "ArrowUp");
  assert.equal(about.getAttribute("aria-selected"), "true");
});
