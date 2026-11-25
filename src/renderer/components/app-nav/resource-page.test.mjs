import assert from "node:assert/strict";
import test, { after } from "node:test";
import { useState } from "react";
import {
  dom,
  keyDown,
  createElement,
  click,
  mouseDown,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../../../../tests/support/renderer.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
const api = await loadRenderer(
  "resource-page-real-components",
  'export {ResourcePage} from "./src/renderer/components/app-nav/resource-page.tsx"; export {resetCodemodeSettingsCache} from "./src/renderer/lib/codemode-settings.ts";',
);
after(restoreGlobals);

function externalResources({ codemode = {}, onCodemodeSet = () => {} } = {}) {
  api.resetCodemodeSettingsCache();
  let settings = {
    enabled: true,
    mode: "on",
    configPath: "/home/fixture/.pi/settings.json",
    availability: { available: true },
    projectOverride: null,
    ...codemode,
  };
  return installRendererApi(dom.window, api, () => ({
    call(method, params) {
      if (method === "plugins.list")
        return {
          packages: [
            {
              source: "npm:fixture-plugin",
              scope: "project",
              status: "loaded",
              disabled: false,
              filtered: false,
              counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
              resources: [],
            },
          ],
          totals: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
          diagnostics: [],
        };
      if (method === "codemode.get") return settings;
      if (method === "codemode.set") {
        onCodemodeSet(params);
        settings = { ...settings, ...params };
        return settings;
      }
      if (method === "skills.list")
        return {
          skills: [
            {
              name: "fixture-skill",
              description: "Fixture skill",
              filePath: "/workspace/SKILL.md",
              baseDir: "/workspace",
              disableModelInvocation: false,
              sourceInfo: { source: "project", scope: "project" },
            },
          ],
        };
      assert.equal(method, "skills.getContent");
      return { content: "# Fixture skill", cwd: "/workspace" };
    },
  }));
}

const noChannels = { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };
const props = (activeTab = "plugins", onTabChange = () => {}, view = "manage", onViewChange = () => {}) => ({
  environmentId: "primary",
  cwd: "/workspace",
  view,
  onViewChange,
  activeTab,
  onTabChange,
  channelSnapshot: noChannels,
  onOpenRemote: () => {},
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the overview shows skills and the plugin's sources together on one page, without tabs", async (t) => {
  const host = externalResources();
  const view = await mount(
    t,
    api.ResourcePage,
    props("plugins", () => {}, "overview"),
    { release: host.close },
  );
  await settle();
  const page = view.container;
  assert.equal(page.querySelector("h1").textContent, "Plugins & Skills");
  assert.match(page.textContent, /fixture-skill/);
  assert.match(page.textContent, /Fixture skill/);
  assert.match(page.textContent, /These capabilities come from 1 installed packages/);
  assert.equal(page.querySelectorAll('[role="tab"]').length, 0);
  assert.equal(page.querySelectorAll('[role="tabpanel"]').length, 0);
});

test("the built-in plugins section contains Remote chat and Code Mode with a count of two", async (t) => {
  const host = externalResources();
  const view = await mount(
    t,
    api.ResourcePage,
    props("plugins", () => {}, "overview"),
    { release: host.close },
  );
  await settle();
  const section = view.container.querySelector('[aria-labelledby="resource-builtin-heading"]');
  assert.ok(section);
  assert.match(section.textContent, /Built-in plugins2/);
  assert.match(section.textContent, /Remote chat/);
  assert.match(section.textContent, /Code Mode/);
});

test("Code Mode opens its configuration drawer and returns focus when Escape closes it", async (t) => {
  const host = externalResources();
  const view = await mount(
    t,
    api.ResourcePage,
    props("plugins", () => {}, "overview"),
    { release: host.close },
  );
  await settle();
  const card = view.container.querySelector('button[aria-label="Code Mode"]');
  card.focus();
  await click(card);
  const drawer = view.container.querySelector('[role="dialog"]');
  assert.ok(drawer, "the Code Mode configuration drawer is open");
  assert.equal(drawer.getAttribute("aria-modal"), "true");
  assert.match(drawer.className, /w-\[480px\]/);
  assert.match(drawer.textContent, /Execution mode/);
  assert.equal(drawer.querySelectorAll('input[type="radio"]').length, 2);
  await keyDown(drawer, "Escape");
  assert.equal(view.container.querySelector('[role="dialog"]'), null);
  assert.equal(dom.window.document.activeElement, card);
});

test("the Code Mode card switch saves immediately without opening the drawer", async (t) => {
  const writes = [];
  const host = externalResources({ onCodemodeSet: (patch) => writes.push(patch) });
  const view = await mount(
    t,
    api.ResourcePage,
    props("plugins", () => {}, "overview"),
    { release: host.close },
  );
  await settle();
  await click(view.container.querySelector('input[role="switch"]'));
  await settle();
  assert.deepEqual(writes, [{ enabled: false, cwd: "/workspace" }]);
  assert.equal(view.container.querySelector('input[role="switch"]').checked, false);
  assert.equal(view.container.querySelector('[role="dialog"]'), null);
  assert.match(view.container.textContent, /Not enabled/);
});

test("a failed Code Mode save restores the switch and provides a dismissible error", async (t) => {
  const host = externalResources({
    onCodemodeSet: () => {
      throw new Error("Fixture save refused");
    },
  });
  const view = await mount(
    t,
    api.ResourcePage,
    props("plugins", () => {}, "overview"),
    { release: host.close },
  );
  await settle();
  await click(view.container.querySelector('input[role="switch"]'));
  await settle();
  assert.equal(view.container.querySelector('input[role="switch"]').checked, true);
  assert.match(view.container.querySelector('[role="alert"]').textContent, /Fixture save refused/);
  await click(view.container.querySelector('button[aria-label="Dismiss error"]'));
  assert.equal(view.container.querySelector('[role="alert"]'), null);
});

test("selecting script-only mode saves the choice and updates the card status", async (t) => {
  const writes = [];
  const host = externalResources({ onCodemodeSet: (patch) => writes.push(patch) });
  const view = await mount(
    t,
    api.ResourcePage,
    props("plugins", () => {}, "overview"),
    { release: host.close },
  );
  await settle();
  await click(view.container.querySelector('button[aria-label="Code Mode"]'));
  await click(view.container.querySelector('input[type="radio"][value="only"]'));
  await settle();
  assert.deepEqual(writes, [{ mode: "only", cwd: "/workspace" }]);
  assert.equal(view.container.querySelector('input[type="radio"][value="only"]').checked, true);
  await click(view.container.querySelector('button[aria-label="Close"]'));
  assert.match(view.container.textContent, /Script-only mode/);
});

for (const [name, codemode, expected] of [
  ["disabled", { enabled: false }, /Turn on the switch at the top right/],
  [
    "unavailable",
    { availability: { available: false, reason: "missing_sandbox" } },
    /This environment doesn't support Code Mode yet/,
  ],
]) {
  test(`the ${name} Code Mode drawer explains the state without rendering mode choices`, async (t) => {
    const host = externalResources({ codemode });
    const view = await mount(
      t,
      api.ResourcePage,
      props("plugins", () => {}, "overview"),
      { release: host.close },
    );
    await settle();
    await click(view.container.querySelector('button[aria-label="Code Mode"]'));
    const drawer = view.container.querySelector('[role="dialog"]');
    assert.match(drawer.textContent, expected);
    assert.equal(drawer.querySelectorAll('input[type="radio"]').length, 0);
    if (name === "unavailable") assert.equal(drawer.querySelector('input[role="switch"]').disabled, true);
    await mouseDown(drawer.parentElement);
    assert.equal(view.container.querySelector('[role="dialog"]'), null);
  });
}

test("the Code Mode drawer keeps keyboard focus inside until it closes", async (t) => {
  const host = externalResources();
  const view = await mount(
    t,
    api.ResourcePage,
    props("plugins", () => {}, "overview"),
    { release: host.close },
  );
  await settle();
  await click(view.container.querySelector('button[aria-label="Code Mode"]'));
  const drawer = view.container.querySelector('[role="dialog"]');
  const first = drawer.querySelector('input[role="switch"]');
  const last = drawer.querySelector('button[aria-label="Copy configuration path"]');
  await keyDown(last, "Tab");
  assert.equal(dom.window.document.activeElement, first);
  await keyDown(first, "Tab", { shiftKey: true });
  assert.equal(dom.window.document.activeElement, last);
});

test("changing the project closes the Code Mode drawer before settings can be edited in the new scope", async (t) => {
  const host = externalResources();
  const overviewProps = props("plugins", () => {}, "overview");
  const view = await mount(t, api.ResourcePage, overviewProps, { release: host.close });
  await settle();
  await click(view.container.querySelector('button[aria-label="Code Mode"]'));
  assert.ok(view.container.querySelector('[role="dialog"]'));
  await view.update({ ...overviewProps, cwd: "/another-project" });
  assert.equal(view.container.querySelector('[role="dialog"]'), null);
});

test("copying the Code Mode configuration path writes the path and announces success", async (t) => {
  const clipboard = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  const copied = [];
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        copied.push(text);
      },
    },
  });
  t.after(() => {
    if (clipboard) Object.defineProperty(dom.window.navigator, "clipboard", clipboard);
    else delete dom.window.navigator.clipboard;
  });
  const host = externalResources();
  const view = await mount(
    t,
    api.ResourcePage,
    props("plugins", () => {}, "overview"),
    { release: host.close },
  );
  await settle();
  await click(view.container.querySelector('button[aria-label="Code Mode"]'));
  await click(view.container.querySelector('button[aria-label="Copy configuration path"]'));
  assert.deepEqual(copied, ["/home/fixture/.pi/settings.json"]);
  assert.match(view.container.querySelector('[role="dialog"]').textContent, /Copied/);
});

test("Manage sources asks the parent to show the package manager on the current tab", async (t) => {
  const host = externalResources();
  const requested = [];
  const view = await mount(
    t,
    api.ResourcePage,
    props(
      "plugins",
      (tab) => requested.push(["tab", tab]),
      "overview",
      (next) => requested.push(["view", next]),
    ),
    { release: host.close },
  );
  await settle();
  const manage = [...view.container.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === "Manage sources",
  );
  await click(manage);
  assert.deepEqual(requested, [
    ["tab", "plugins"],
    ["view", "manage"],
  ]);
});

test("opening a skill card from the overview shows its details without leaving the overview", async (t) => {
  const host = externalResources();
  const requested = [];
  const view = await mount(
    t,
    api.ResourcePage,
    props(
      "plugins",
      (tab) => requested.push(["tab", tab]),
      "overview",
      (next) => requested.push(["view", next]),
    ),
    { release: host.close },
  );
  await settle();
  const card = [...view.container.querySelectorAll("button")].find(
    (element) => element.textContent.trim() === "fixture-skill",
  );
  await click(card);
  await settle();
  assert.deepEqual(requested, []);
  const panel = dom.window.document.body.querySelector('[role="dialog"]');
  assert.ok(panel, "the details panel is open");
  assert.match(panel.textContent, /fixture-skill/);
});

test("the active manager tab displays its real configuration, not the other one", async (t) => {
  const host = externalResources();
  const view = await mount(t, api.ResourcePage, props(), { release: host.close });
  const panel = () => view.container.querySelector('[role="tabpanel"]');
  assert.match(panel().textContent, /npm:fixture-plugin/);
  assert.doesNotMatch(panel().textContent, /fixture-skill/);
  await view.update(props("skills"));
  assert.match(panel().textContent, /fixture-skill/);
  assert.doesNotMatch(panel().textContent, /npm:fixture-plugin/);
});

test("the manager exposes exactly Plugins and Skills with the correct selected state", async (t) => {
  const host = externalResources();
  const view = await mount(t, api.ResourcePage, props(), { release: host.close });
  const tabs = [...view.container.querySelectorAll('[role="tab"]')];
  assert.deepEqual(
    tabs.map((tab) => tab.textContent.trim()),
    ["Plugins", "Skills"],
  );
  assert.deepEqual(
    tabs.map((tab) => tab.getAttribute("aria-selected")),
    ["true", "false"],
  );
  assert.equal(view.container.querySelectorAll('[role="tablist"]').length, 1);
  assert.equal(view.container.querySelectorAll('[role="tabpanel"]').length, 1);
});

test("the manager's back button asks the parent to return to the overview", async (t) => {
  const host = externalResources();
  const requested = [];
  const view = await mount(
    t,
    api.ResourcePage,
    props(
      "plugins",
      () => {},
      "manage",
      (next) => requested.push(next),
    ),
    { release: host.close },
  );
  const back = [...view.container.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === "Back to Plugins & Skills",
  );
  await click(back);
  assert.deepEqual(requested, ["overview"]);
});

test("clicks and keyboard arrows request the next resource tab from the parent", async (t) => {
  const host = externalResources();
  const requested = [];
  const view = await mount(
    t,
    api.ResourcePage,
    props("plugins", (tab) => requested.push(tab)),
    { release: host.close },
  );
  const [plugins, skills] = view.container.querySelectorAll('[role="tab"]');
  await click(skills);
  await keyDown(plugins, "ArrowRight");
  assert.deepEqual(requested, ["skills", "skills"]);
});

test("accepted keyboard tab changes move focus and render the corresponding configuration", async (t) => {
  const host = externalResources();
  function ControlledPage() {
    const [tab, select] = useState("plugins");
    return createElement(api.ResourcePage, props(tab, select));
  }
  const view = await mount(t, ControlledPage, {}, { release: host.close });
  const [plugins, skills] = view.container.querySelectorAll('[role="tab"]');
  await keyDown(plugins, "ArrowRight");
  assert.equal(dom.window.document.activeElement, skills);
  assert.equal(skills.getAttribute("aria-selected"), "true");
  await keyDown(skills, "ArrowLeft");
  assert.equal(dom.window.document.activeElement, plugins);
  assert.equal(plugins.getAttribute("aria-selected"), "true");
});
