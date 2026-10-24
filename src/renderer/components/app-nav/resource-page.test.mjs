import assert from "node:assert/strict";
import test, { after } from "node:test";
import { useState } from "react";
import {
  dom,
  keyDown,
  createElement,
  click,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../../../../tests/support/renderer.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
const api = await loadRenderer(
  "resource-page-real-components",
  'export {ResourcePage} from "./src/renderer/components/app-nav/resource-page.tsx";',
);
after(restoreGlobals);

function externalResources() {
  return installRendererApi(dom.window, api, () => ({
    call(method) {
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

test("opening a skill card from the overview selects that skill in the Skills manager", async (t) => {
  const host = externalResources();
  function ControlledPage() {
    const [tab, setTab] = useState("plugins");
    const [view, setView] = useState("overview");
    return createElement(api.ResourcePage, props(tab, setTab, view, setView));
  }
  const view = await mount(t, ControlledPage, {}, { release: host.close });
  await settle();
  const card = [...view.container.querySelectorAll("button")].find(
    (element) => element.textContent.trim() === "fixture-skill",
  );
  await click(card);
  await settle();
  const skills = [...view.container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Skills");
  assert.equal(skills.getAttribute("aria-selected"), "true");
  assert.match(view.container.querySelector('[role="tabpanel"]').textContent, /fixture-skill/);
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
