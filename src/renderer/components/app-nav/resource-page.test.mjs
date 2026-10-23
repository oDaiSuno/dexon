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
const props = (activeTab = "plugins", onTabChange = () => {}) => ({
  cwd: "/workspace",
  activeTab,
  onTabChange,
  channelSnapshot: noChannels,
  onOpenRemote: () => {},
});

test("the active resource tab displays its real configuration, not the other one", async (t) => {
  const host = externalResources();
  const view = await mount(t, api.ResourcePage, props(), { release: host.close });
  const panel = () => view.container.querySelector('[role="tabpanel"]');
  assert.match(panel().textContent, /npm:fixture-plugin/);
  assert.doesNotMatch(panel().textContent, /fixture-skill/);
  await view.update(props("skills"));
  assert.match(panel().textContent, /fixture-skill/);
  assert.doesNotMatch(panel().textContent, /npm:fixture-plugin/);
});

test("the resource page exposes exactly Plugins and Skills with the correct selected state", async (t) => {
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
