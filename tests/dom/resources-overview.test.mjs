import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  dom,
  byRole,
  button,
  click,
  keyDown,
  waitFor,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";
import { allByRole, getByRole } from "../support/dom-queries.mjs";

const api = await loadRenderer(
  "resources-overview",
  'export {ResourcePage} from "./src/renderer/components/app-nav/resource-page.tsx";',
);
api.setAppLanguage("zh-CN");
after(restoreGlobals);

const CWD = "/work/project";
const BROWSER_SOURCE = "npm:browser-tools-package";
const SUBAGENTS_SOURCE = "npm:pi-subagents";
const WEB_RESEARCH = "/home/tester/.pi/agent/npm/node_modules/browser-tools-package/skills/web-research/SKILL.md";
const CODE_REVIEW = "/work/project/.pi/skills/code-review/SKILL.md";
const COMMIT_MESSAGE = "/home/tester/.pi/agent/skills/commit-message/SKILL.md";
const DEPLOY_PREVIEW = "/home/tester/.pi/agent/npm/node_modules/pi-deploy/skills/deploy-preview/SKILL.md";
const WEB_RESEARCH_TEXT = "---\nname: web-research\n---\n\n# Web research\n\nSearch and cite sources.\n";

function plugin(source, overrides = {}) {
  return {
    source,
    scope: "global",
    filtered: false,
    disabled: false,
    installedPath: `/home/tester/.pi/agent/npm/node_modules/${source.replace(/^npm:/, "")}`,
    packageName: source.replace(/^npm:/, ""),
    version: "1.0.0",
    counts: { extensions: 0, skills: 1, prompts: 0, themes: 0 },
    resources: [],
    status: "loaded",
    ...overrides,
  };
}

function skill(name, filePath, overrides = {}) {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: filePath.replace(/\/SKILL\.md$/, ""),
    disableModelInvocation: false,
    sourceInfo: { source: "local", scope: "user" },
    ...overrides,
  };
}

function initialState() {
  return {
    packages: [
      plugin(BROWSER_SOURCE, { displayName: "浏览器工具" }),
      plugin(SUBAGENTS_SOURCE, { packageName: "pi-subagents", version: "0.9.0", pendingReloadVersion: "0.9.0" }),
    ],
    skills: [
      skill("web-research", WEB_RESEARCH, {
        sourceInfo: { source: BROWSER_SOURCE, scope: "user" },
        plugin: {
          source: BROWSER_SOURCE,
          scope: "global",
          displayName: "浏览器工具",
          packageName: "browser-tools-package",
        },
      }),
      skill("code-review", CODE_REVIEW, { sourceInfo: { source: "local", scope: "project" } }),
      skill("commit-message", COMMIT_MESSAGE, { disableModelInvocation: true }),
      skill("deploy-preview", DEPLOY_PREVIEW, {
        sourceInfo: { source: "npm:pi-deploy", scope: "user" },
        plugin: { source: "npm:pi-deploy", scope: "global", packageName: "pi-deploy" },
      }),
    ],
  };
}

function scene(t, { sessionId = "session-1", bridge = {} } = {}) {
  const state = initialState();
  const calls = [];
  const opened = [];
  const host = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method, params) {
        calls.push({ method, params });
        if (method === "plugins.list")
          return {
            packages: structuredClone(state.packages),
            totals: { extensions: 0, skills: 2, prompts: 0, themes: 0 },
            diagnostics: [],
          };
        if (method === "skills.list") return { skills: structuredClone(state.skills) };
        if (method === "skills.getContent") {
          assert.equal(params.cwd, CWD);
          return { content: params.filePath === WEB_RESEARCH ? WEB_RESEARCH_TEXT : "# other\n" };
        }
        if (method === "skills.set") {
          const target = state.skills.find((item) => item.filePath === params.filePath);
          target.disableModelInvocation = params.disableModelInvocation;
          return { ok: true };
        }
        if (method === "agent.command") {
          assert.deepEqual(params, { sessionId: "session-1", command: { type: "reload" } });
          return { success: true };
        }
        if (method === "plugins.markReloaded") {
          assert.equal(params.cwd, CWD);
          for (const pkg of state.packages) delete pkg.pendingReloadVersion;
          return {
            packages: structuredClone(state.packages),
            totals: { extensions: 0, skills: 2, prompts: 0, themes: 0 },
            diagnostics: [],
          };
        }
        throw new Error(`unexpected ${method}`);
      },
    }),
    {
      bridge: {
        platform: "darwin",
        openFile: async (filePath) => {
          opened.push(filePath);
        },
        ...bridge,
      },
    },
  );
  const views = [];
  const props = {
    cwd: CWD,
    sessionId,
    view: "overview",
    onViewChange: (view) => views.push(view),
    activeTab: "plugins",
    onTabChange: () => {},
    channelSnapshot: { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] },
    onOpenRemote: () => {},
  };
  return {
    state,
    calls,
    opened,
    views,
    host,
    props,
    count: (method) => calls.filter((call) => call.method === method).length,
  };
}

async function open(t, options) {
  const env = scene(t, options);
  const view = await mount(t, api.ResourcePage, env.props, { release: env.host.close });
  await waitFor(() => assert.ok(button(view.container, "web-research"), "skills are listed"));
  return { ...env, view };
}

function skillCard(container, name) {
  return button(container, name).closest("li");
}

test("each skill card says where it comes from: the plugin's title, else its package name, else its scope", async (t) => {
  const { view } = await open(t);
  assert.match(skillCard(view.container, "web-research").textContent, /来自 浏览器工具/);
  assert.match(skillCard(view.container, "deploy-preview").textContent, /来自 pi-deploy/);
  assert.match(skillCard(view.container, "code-review").textContent, /本项目/);
  assert.match(skillCard(view.container, "commit-message").textContent, /全局 · 已对模型隐藏/);
});

test("a plugin updated but not yet reloaded keeps a reminder until the session is reloaded from it", async (t) => {
  const { view, calls } = await open(t);
  const reminders = getByRole(view.container, "list", "待处理");
  assert.match(reminders.textContent, /pi-subagents 已更新到 0\.9\.0/);
  assert.match(reminders.textContent, /重载当前会话后生效/);
  await click(button(reminders, "重载会话"));
  await waitFor(() => assert.equal(byRole(view.container, "list", "待处理"), undefined));
  assert.deepEqual(
    calls
      .filter((call) => call.method === "agent.command" || call.method === "plugins.markReloaded")
      .map((call) => call.method),
    ["agent.command", "plugins.markReloaded"],
  );
});

test("without an open conversation the reminder stays and its reload button is unavailable", async (t) => {
  const { view } = await open(t, { sessionId: null });
  const reminders = getByRole(view.container, "list", "待处理");
  assert.equal(button(reminders, "重载会话").disabled, true);
});

test("clicking a skill card slides in its details without leaving the overview, and Escape returns to the card", async (t) => {
  const { view, views } = await open(t);
  const card = button(view.container, "web-research");
  card.focus();
  await click(card);
  const panel = await waitFor(() => getByRole(dom.window.document.body, "dialog", "web-research"));
  assert.deepEqual(views, [], "the page stays on the overview");
  assert.match(panel.textContent, /来自 浏览器工具/);
  assert.match(panel.textContent, /browser-tools-package\/skills\/web-research\/SKILL\.md/);
  await waitFor(() => assert.match(panel.textContent, /Search and cite sources\./));
  assert.equal(allByRole(panel, "textbox").length, 0, "the content is a read-only preview");
  assert.equal(button(panel, "保存修改"), undefined);
  assert.ok(panel.contains(dom.window.document.activeElement), "focus moves into the panel");
  await keyDown(panel, "Escape");
  await waitFor(() => assert.equal(byRole(dom.window.document.body, "dialog", "web-research"), undefined));
  assert.equal(dom.window.document.activeElement, button(view.container, "web-research"));
});

test("the details panel switch changes whether the model can see the skill", async (t) => {
  const { view, state } = await open(t);
  await click(button(view.container, "web-research"));
  const panel = await waitFor(() => getByRole(dom.window.document.body, "dialog", "web-research"));
  await click(getByRole(panel, "switch"));
  await waitFor(() => assert.equal(state.skills[0].disableModelInvocation, true));
  await waitFor(() => assert.equal(getByRole(panel, "switch").checked, false));
});

test("Open in editor hands the skill's SKILL.md to the system default editor", async (t) => {
  const { view, opened } = await open(t);
  await click(button(view.container, "web-research"));
  const panel = await waitFor(() => getByRole(dom.window.document.body, "dialog", "web-research"));
  await click(button(panel, "在编辑器中打开"));
  assert.deepEqual(opened, [WEB_RESEARCH]);
});

test("when the editor cannot be opened, the panel says so", async (t) => {
  const { view } = await open(t, {
    bridge: {
      openFile: async () => {
        throw new Error("No application can open this file");
      },
    },
  });
  await click(button(view.container, "web-research"));
  const panel = await waitFor(() => getByRole(dom.window.document.body, "dialog", "web-research"));
  await click(button(panel, "在编辑器中打开"));
  await waitFor(() => assert.match(getByRole(panel, "alert").textContent, /No application can open this file/));
});

test("the refresh icon beside the page title reloads plugins and skills, showing newly added ones", async (t) => {
  const { view, state, count } = await open(t);
  const before = { plugins: count("plugins.list"), skills: count("skills.list") };
  state.skills.push(skill("fresh-skill", "/home/tester/.pi/agent/skills/fresh-skill/SKILL.md"));
  const title = getByRole(view.container, "heading", "插件与技能");
  const refresh = button(title.parentElement, "刷新");
  assert.ok(refresh, "the refresh control sits next to the page title");
  await click(refresh);
  await waitFor(() => assert.ok(button(view.container, "fresh-skill")));
  assert.equal(count("plugins.list"), before.plugins + 1);
  assert.equal(count("skills.list"), before.skills + 1);
});

test("Manage sources still reaches package management and its refresh is the same action", async (t) => {
  const env = scene(t);
  const view = await mount(
    t,
    api.ResourcePage,
    { ...env.props, view: "manage", activeTab: "plugins" },
    { release: env.host.close },
  );
  await waitFor(() => assert.ok(view.container.textContent.includes(BROWSER_SOURCE)));
  const before = { plugins: env.count("plugins.list"), skills: env.count("skills.list") };
  await click(button(view.container, "刷新"));
  await waitFor(() => assert.equal(env.count("skills.list"), before.skills + 1));
  assert.equal(env.count("plugins.list"), before.plugins + 1);
});
