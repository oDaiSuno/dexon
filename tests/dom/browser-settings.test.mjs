import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  dom,
  byRole,
  click,
  input,
  keyDown,
  labelledControl,
  selectOption,
  button,
  text,
  waitFor,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../support/renderer.mjs";
import { blur } from "../support/dom-events.mjs";
import { precedes } from "../support/dom-queries.mjs";
import { browserState } from "../support/browser-state.mjs";
const { BrowserSettings, SettingsConfig, setAppLanguage } = await loadRenderer(
  "browser-settings-behavior",
  'export {BrowserSettings} from "./src/renderer/components/browser/BrowserSettings.tsx"; export {SettingsConfig} from "./src/renderer/components/SettingsConfig.tsx";',
);
after(restoreGlobals);
function installMain({ snippets = [] } = {}) {
  const state = browserState();
  let savedSnippets = structuredClone(snippets);
  const permissions = [];
  const confirmations = [];
  const updates = [];
  state.runtimeSessionGrants["session-one"] = { permission: "read", source: "local", expiresAt: 30000 };
  dom.window.piBridge = {
    browserGetState: async () => structuredClone(state),
    browserListPageSnippets: async () => structuredClone(savedSnippets),
    browserClearPageSnippets: async () => {
      savedSnippets = [];
    },
    browserGetHeaderRules: async () => [],
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
      if (patch.navigation) Object.assign(state.settings.settings.navigation, patch.navigation);
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
  const select = labelledControl(view.container, "Permanent Browser permission for this session");
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
  await click(labelledControl(view.container, "Enable Advanced Browser Mode for this launch"));
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

function group(container, title) {
  const section = [...container.querySelectorAll("section")].find(
    (candidate) => candidate.querySelector("h2")?.textContent === title,
  );
  assert.ok(section, `Missing settings group ${title}`);
  return section;
}

function rowLabels(section) {
  return [...section.querySelectorAll("label[for]")].map((label) => label.textContent.trim()).filter(Boolean);
}

const savedSnippet = {
  id: "snippet-one",
  enabled: true,
  host: "example.com",
  pathPattern: "/*",
  label: "Read the price table",
  useCount: 3,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  codeBytes: 2048,
  untrustedWebContent: true,
};

test("the four Browser permission settings close the Agent access group", async (t) => {
  installMain();
  setAppLanguage("en-US");
  const view = await mount(t, BrowserSettings, { sessionId: "session-one" });
  assert.deepEqual(rowLabels(group(view.container, "Agent access")).slice(-5), [
    "Use persistent Profiles by default when creating a Profile",
    "Allow specifically approved channel sessions",
    "Sensitive Agent actions",
    "Permanent Browser permission for this session",
    "Current temporary permission",
  ]);
  assert.ok(
    !rowLabels(group(view.container, "Basics")).includes("Use persistent Profiles by default when creating a Profile"),
  );
});

test("keeping sign-in state for new Profiles is still saved from the Agent access group", async (t) => {
  const main = installMain();
  setAppLanguage("en-US");
  const view = await mount(t, BrowserSettings, { sessionId: null });
  await click(
    labelledControl(
      group(view.container, "Agent access"),
      "Use persistent Profiles by default when creating a Profile",
    ),
  );
  assert.deepEqual(main.updates, [[{ panel: { saveLoginState: true } }, undefined]]);
});

test("Advanced Browser Mode details appear only after the mode is turned on", async (t) => {
  installMain();
  setAppLanguage("en-US");
  const view = await mount(t, BrowserSettings, { sessionId: null });
  const advanced = group(view.container, "Advanced and diagnostics");
  assert.match(advanced.textContent, /You type a confirmation phrase before turning it on/);
  for (const label of [
    "Browser identity",
    "Certificate bypass domains (comma separated)",
    "Captured requests per tab",
  ]) {
    assert.ok(!rowLabels(advanced).includes(label), `${label} is hidden while the mode is off`);
  }
  await click(labelledControl(view.container, "Enable Advanced Browser Mode for this launch"));
  const prompt = view.container.querySelector('[role="dialog"]');
  await input(prompt.querySelector("input"), "ENABLE ADVANCED BROWSER");
  await click(button(prompt, "Continue"));
  const opened = rowLabels(group(view.container, "Advanced and diagnostics"));
  for (const label of [
    "Browser identity",
    "Certificate bypass domains (comma separated)",
    "Captured requests per tab",
    "Captured body capacity per tab (MiB)",
    "JavaScript experiences per host",
  ]) {
    assert.ok(opened.includes(label), `${label} is shown once the mode is on`);
  }
});

test("header rules and the JavaScript experience library sit in a closed Developer options area at the bottom", async (t) => {
  installMain();
  setAppLanguage("en-US");
  const view = await mount(t, BrowserSettings, { sessionId: null });
  const toggle = button(view.container, "Developer options");
  assert.ok(toggle, "Developer options can be opened");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(precedes(text(view.container, "Advanced and diagnostics"), toggle), "it follows every other group");
  assert.doesNotMatch(view.container.textContent, /Advanced header rules|JavaScript experience library/);
  assert.equal(button(view.container, "Add header rule"), undefined);

  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const panel = view.container.ownerDocument.getElementById(toggle.getAttribute("aria-controls"));
  assert.ok(panel && view.container.contains(panel));
  assert.ok(button(panel, "Add header rule"));
  const library = group(panel, "JavaScript experience library");
  assert.match(library.textContent, /Saved code is never executed automatically/);
  assert.doesNotMatch(library.textContent, /No saved JavaScript experiences/);
  assert.equal(button(library, "Clear JavaScript experiences").disabled, true);
  assert.ok(precedes(text(panel, "Advanced header rules"), text(panel, "JavaScript experience library")));

  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(button(view.container, "Add header rule"), undefined);
});

test("clearing JavaScript experiences from Developer options empties the library", async (t) => {
  installMain({ snippets: [savedSnippet] });
  setAppLanguage("en-US");
  const view = await mount(t, BrowserSettings, { sessionId: null });
  await click(button(view.container, "Developer options"));
  const library = () => group(view.container, "JavaScript experience library");
  await waitFor(() => assert.match(library().textContent, /Read the price table/));
  await click(button(library(), "Clear JavaScript experiences"));
  await waitFor(() => assert.equal(button(library(), "Clear JavaScript experiences").disabled, true));
  assert.doesNotMatch(library().textContent, /Read the price table/);
});

test("the address bar search engine defaults to Bing and saves a built-in choice", async (t) => {
  const main = installMain();
  setAppLanguage("en-US");
  const view = await mount(t, BrowserSettings, { sessionId: null });
  const select = labelledControl(view.container, "Address bar search engine");
  assert.equal(select.value, "bing");
  assert.deepEqual(
    [...select.options].map((option) => [option.value, option.textContent]),
    [
      ["bing", "Bing"],
      ["google", "Google"],
      ["duckduckgo", "DuckDuckGo"],
      ["baidu", "Baidu"],
      ["custom", "Custom"],
    ],
  );
  assert.throws(() => labelledControl(view.container, "Custom search address"));
  await selectOption(select, "google");
  assert.deepEqual(main.updates, [[{ navigation: { searchEngine: "google" } }, undefined]]);
  assert.equal(labelledControl(view.container, "Address bar search engine").value, "google");
});

test("a custom search address is saved together with the custom choice once typed", async (t) => {
  const main = installMain();
  setAppLanguage("zh-CN");
  t.after(() => setAppLanguage("en-US"));
  const view = await mount(t, BrowserSettings, { sessionId: null });
  const select = labelledControl(view.container, "地址栏搜索引擎");
  assert.equal(select.options[3].textContent, "百度");
  await selectOption(select, "custom");
  assert.deepEqual(main.updates, [], "an empty custom address is not sent");
  const field = labelledControl(view.container, "自定义搜索地址");
  await input(field, "https://search.example/find?term={query}");
  await blur(field);
  assert.deepEqual(main.updates, [
    [
      { navigation: { searchEngine: "custom", customSearchTemplate: "https://search.example/find?term={query}" } },
      undefined,
    ],
  ]);
  assert.equal(labelledControl(view.container, "地址栏搜索引擎").value, "custom");
});
