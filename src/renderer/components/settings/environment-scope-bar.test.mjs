import assert from "node:assert/strict";
import test, { after } from "node:test";
import { useState } from "react";
import { MessageChannel } from "node:worker_threads";
import {
  dom,
  act,
  button,
  byRole,
  click,
  createElement,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../../../../tests/support/renderer.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { browserState } from "../../../../tests/support/browser-state.mjs";

const api = await loadRenderer(
  "environment-scope-bar",
  'export {EnvironmentScopeBar} from "./src/renderer/components/settings/environment-scope-bar.tsx";' +
    'export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";' +
    'export {workspaceStore} from "./src/renderer/lib/workspace-store.ts";' +
    'export {ToolchainsConfig} from "./src/renderer/components/ToolchainsConfig.tsx";' +
    'export {BrowserSettings} from "./src/renderer/components/browser/BrowserSettings.tsx";' +
    'export {ModelsConfig} from "./src/renderer/components/ModelsConfig.tsx";' +
    'export {SettingsConfig} from "./src/renderer/components/SettingsConfig.tsx";' +
    'export {ResourcePage} from "./src/renderer/components/app-nav/resource-page.tsx";' +
    'export {createRpcServer} from "./src/contract/rpc.ts";',
);
after(restoreGlobals);

const remote = (id = "gpu", phase = "connected") => ({
  id,
  label: id === "gpu" ? "GPU server" : id,
  enabled: true,
  target: { kind: "ssh", sshAlias: id },
  status: phase === "connected" ? { phase, generation: 1, since: 0 } : { phase, lastFailure: null },
  descriptor: null,
});

async function setup(views = [remote()], options = {}) {
  let revision = 1;
  let changed;
  const commands = [];
  const servers = [];
  const bridge = installRendererApi(dom.window, api, () => ({ call: options.call ?? (() => ({})) }), {
    bridge: {
      getUiState: async () => ({}),
      setUiState: async () => {},
      listEnvironments: async () => ({
        revision,
        policy: { detachedDaemon: true, autoReconnect: true },
        environments: views,
      }),
      onEnvironmentsChanged: (listener) => {
        changed = listener;
        return () => {};
      },
      environmentCommand: async (command) => commands.push(command),
      ...options.bridge,
    },
  });
  await act(async () => {
    api.setAppLanguage("en-US");
    api.environmentRegistry.initialize();
    await api.workspaceStore.initialize(dom.window.piBridge);
  });
  return {
    commands,
    serve(environmentId, handlers) {
      const server = api.createRpcServer();
      server.handle(handlers);
      const { port1, port2 } = new MessageChannel();
      server.attachPort(port1);
      const connection = api.environmentRegistry.getConnection(environmentId);
      connection.replacePort(port2, 1);
      servers.push({ server, port1, connection });
    },
    close() {
      for (const { server, port1, connection } of servers) {
        connection.close();
        server.detachPort(port1);
        port1.close();
      }
      bridge.close();
      api.environmentRegistry.initialize();
    },
    async push(next) {
      views = next;
      revision += 1;
      await act(async () => changed?.(await dom.window.piBridge.listEnvironments()));
    },
  };
}

test("selecting a connected server changes only the page scope, not the current workspace", async (t) => {
  const fixture = await setup([remote(), remote("offline", "offline")]);
  const focus = api.workspaceStore.getSnapshot().focus;
  function Page() {
    const [selected, select] = useState("primary");
    return createElement(api.EnvironmentScopeBar, {
      mode: "selector",
      selectedEnvironmentId: selected,
      onSelect: select,
    });
  }
  const view = await mount(t, Page, {}, { release: fixture.close });
  const local = button(view.container, "This computer");
  const server = button(view.container, "GPU server");
  assert.ok(server, "connected servers must be available as scope controls");
  assert.equal(local.getAttribute("aria-pressed"), "true");
  assert.equal(button(view.container, "offline"), undefined);
  await click(server);
  assert.equal(server.getAttribute("aria-pressed"), "true");
  assert.equal(local.getAttribute("aria-pressed"), "false");
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, focus);
  assert.deepEqual(fixture.commands, []);
});

test("a local-only installation does not show a scope selector", async (t) => {
  const fixture = await setup([]);
  const view = await mount(
    t,
    api.EnvironmentScopeBar,
    {
      mode: "selector",
      selectedEnvironmentId: "primary",
      onSelect() {},
    },
    { release: fixture.close },
  );
  assert.equal(view.container.textContent, "");
});

test("a selected server stays selected and disabled after disconnecting, until the user chooses local", async (t) => {
  const fixture = await setup();
  function Page() {
    const [selected, select] = useState("gpu");
    return createElement(api.EnvironmentScopeBar, {
      mode: "selector",
      selectedEnvironmentId: selected,
      onSelect: select,
      purpose: "resources",
    });
  }
  const view = await mount(t, Page, {}, { release: fixture.close });
  await fixture.push([remote("gpu", "offline")]);
  const server = button(view.container, /GPU server/);
  assert.ok(server, "disconnecting must not silently relabel server resources as local");
  assert.equal(server.disabled, true);
  assert.equal(server.getAttribute("aria-pressed"), "true");
  assert.match(server.textContent, /Not connected/);
  assert.match(view.container.textContent, /Resources from/);
  await click(button(view.container, "This computer"));
  assert.equal(button(view.container, "This computer").getAttribute("aria-pressed"), "true");
  assert.equal(button(view.container, /GPU server/), undefined);
});

test("local-only notices name the focused server and offer a working view-local action", async (t) => {
  const fixture = await setup();
  let localViews = 0;
  const props = { mode: "local-only", focusedEnvironmentId: "gpu", onViewLocal: () => localViews++ };
  const view = await mount(t, api.EnvironmentScopeBar, props, { release: fixture.close });
  assert.ok(byRole(view.container, "heading", "Only on this computer"), "the notice must have a visible title");
  assert.match(view.container.textContent, /GPU server/);
  assert.match(view.container.textContent, /only available on this computer/);
  await click(button(view.container, "View local settings"));
  assert.equal(localViews, 1);
  await view.update({ ...props, focusedEnvironmentId: "primary" });
  assert.equal(view.container.textContent, "");
});

test("viewing local toolchains from a server never sends its remote directory to the local scanner", async (t) => {
  const directories = [];
  const fixture = await setup([remote()], {
    bridge: {
      onToolchainState: () => () => {},
      rescanToolchains: async (cwd) => {
        directories.push(cwd);
        throw new Error("Local scanner unavailable");
      },
    },
  });
  const view = await mount(
    t,
    api.ToolchainsConfig,
    {
      environmentId: "gpu",
      cwd: "/remote/project",
    },
    { release: fixture.close },
  );
  assert.deepEqual(directories, []);
  await click(button(view.container, "View local settings"));
  await waitFor(() => assert.equal(directories.length, 1));
  assert.deepEqual(directories, [undefined]);
  assert.match(view.container.textContent, /Rescan/);
});

test("remote Browser settings are explicitly local and never expose a remote session's local permissions", async (t) => {
  const fixture = await setup([remote()], {
    bridge: {
      browserGetState: async () => browserState(),
      browserListPageSnippets: async () => [],
      browserGetHeaderRules: async () => [],
    },
  });
  const view = await mount(
    t,
    api.BrowserSettings,
    {
      environmentId: "gpu",
      sessionId: "remote-session",
    },
    { release: fixture.close },
  );
  assert.match(view.container.textContent, /Browser settings on this computer/);
  assert.doesNotMatch(view.container.textContent, /Permanent Browser permission for this session/);
  await click(button(view.container, "View local settings"));
  assert.equal(Boolean(button(view.container, "View local settings")), false);
  assert.match(view.container.textContent, /Open a saved session/);
  assert.doesNotMatch(view.container.textContent, /Permanent Browser permission for this session/);
});

function modelReply(method) {
  if (method === "modelsConfig.get") return { config: { providers: {} }, version: "v1" };
  if (method === "modelsConfig.channels.get") return { channels: {} };
  if (method === "models.preferences.get") return { enabledModels: null, models: [] };
  if (method === "models.defaults.get") return { model: null, thinkingLevel: "medium" };
  if (method === "auth.providers" || method === "auth.allProviders") return { providers: [] };
  throw new Error(`Unexpected scope request: ${method}`);
}

const modelMethods = [
  "modelsConfig.get",
  "modelsConfig.channels.get",
  "models.preferences.get",
  "models.defaults.get",
  "auth.providers",
  "auth.allProviders",
];

test("remote models name the server's models.json, omit local cwd, and can switch to local without moving focus", async (t) => {
  const calls = [];
  const fixture = await setup([remote()], { call: modelReply });
  fixture.serve(
    "gpu",
    Object.fromEntries(
      modelMethods.map((method) => [
        method,
        (params) => {
          calls.push({ method, params });
          return modelReply(method);
        },
      ]),
    ),
  );
  const focus = api.workspaceStore.getSnapshot().focus;
  const view = await mount(
    t,
    api.ModelsConfig,
    {
      environmentId: "gpu",
      cwd: "/local/project-must-not-reach-server",
      embedded: true,
      onClose() {},
    },
    { release: fixture.close },
  );
  await waitFor(() => assert.ok(calls.some(({ method }) => method === "models.preferences.get")));
  assert.equal(
    calls.some(({ params }) => params?.cwd),
    false,
    "server model preferences must not receive a local path",
  );
  assert.match(view.container.textContent, /GPU server.*~\/.pi\/agent\/models.json.*only affect that server/);
  await click(button(view.container, "This computer"));
  assert.equal(button(view.container, "This computer").getAttribute("aria-pressed"), "true");
  assert.match(view.container.textContent, /only affect this computer/);
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, focus);
});

test("settings keep the selected scope across tabs and reset it for a new navigation request", async (t) => {
  const localDirectories = [];
  const fixture = await setup([remote()], {
    call: modelReply,
    bridge: {
      onToolchainState: () => () => {},
      rescanToolchains: async (cwd) => {
        localDirectories.push(cwd);
        throw new Error("Local scanner unavailable");
      },
    },
  });
  fixture.serve("gpu", Object.fromEntries(modelMethods.map((method) => [method, () => modelReply(method)])));
  const props = {
    environmentId: "gpu",
    cwd: "/remote/project",
    sessionId: "remote-session",
    initialTab: "models",
    navigationRequestId: 0,
    onClose() {},
    onModelsChanged() {},
    chatAppearance: { fontSize: "standard", layout: "fixed" },
    chatAppearanceSaving: false,
    async onChatAppearanceChange() {},
  };
  const view = await mount(t, api.SettingsConfig, props, { release: fixture.close });
  await click(button(view.container, "This computer"));
  await click(byRole(view.container, "tab", "Developer Tools"));
  assert.equal(Boolean(button(view.container, "View local settings")), false);
  assert.deepEqual(localDirectories, [undefined], "changing the settings scope must discard the source directory");
  await click(byRole(view.container, "tab", "Models"));
  assert.equal(button(view.container, "This computer").getAttribute("aria-pressed"), "true");
  await view.update({ ...props, initialTab: "tools", navigationRequestId: 1 });
  assert.ok(button(view.container, "View local settings"), "a new request must restore its requested server");
});

const noChannels = { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };
const pluginReply = () => ({
  packages: [],
  totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
  diagnostics: [],
});

test("resource scope requests use the matching server APIs and label Remote chat as local-only", async (t) => {
  const remoteCalls = [];
  const localCalls = [];
  const fixture = await setup([remote()], {
    call(method, params) {
      localCalls.push({ method, params });
      if (method === "plugins.list") return pluginReply();
      if (method === "skills.list") return { skills: [] };
      throw new Error(`Unexpected local resource request: ${method}`);
    },
  });
  fixture.serve("gpu", {
    "plugins.list": (params) => {
      remoteCalls.push({ method: "plugins.list", params });
      return pluginReply();
    },
    "skills.list": (params) => {
      remoteCalls.push({ method: "skills.list", params });
      return { skills: [] };
    },
  });
  const focus = api.workspaceStore.getSnapshot().focus;
  function Page() {
    const [scope, select] = useState("gpu");
    return createElement(api.ResourcePage, {
      environmentId: scope,
      cwd: scope === "gpu" ? "/srv/project" : "/local/project",
      onScopeChange: select,
      view: "overview",
      onViewChange() {},
      activeTab: "plugins",
      onTabChange() {},
      channelSnapshot: { ...noChannels, bindings: [{ id: "local-binding" }] },
      onOpenRemote() {},
    });
  }
  const view = await mount(t, Page, {}, { release: fixture.close });
  await waitFor(() => assert.ok(remoteCalls.some(({ method }) => method === "skills.list")));
  assert.equal(
    remoteCalls.every(({ params }) => params?.cwd === "/srv/project"),
    true,
  );
  const card = button(view.container, "Remote chat");
  assert.match(card.textContent, /Only affects this computer/);
  assert.doesNotMatch(card.textContent, /conversations connected/);
  assert.equal(button(view.container, "GPU server").getAttribute("aria-pressed"), "true");
  await click(button(view.container, "This computer"));
  await waitFor(() => assert.ok(localCalls.some(({ method }) => method === "skills.list")));
  assert.equal(
    localCalls.every(({ params }) => params?.cwd === "/local/project"),
    true,
  );
  assert.match(button(view.container, "Remote chat").textContent, /1 conversations connected/);
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, focus);
});

const resourceProps = {
  environmentId: "gpu",
  cwd: "",
  view: "overview",
  onViewChange() {},
  activeTab: "plugins",
  onTabChange() {},
  channelSnapshot: noChannels,
  onOpenRemote() {},
};

function resourceHandlers(calls) {
  return {
    "plugins.list": (params) => {
      calls.push(params.cwd);
      return pluginReply();
    },
    "skills.list": (params) => {
      calls.push(params.cwd);
      return { skills: [] };
    },
  };
}

test("resources without a mounted folder use the target descriptor home, never an empty working directory", async (t) => {
  const calls = [];
  const fixture = await setup([{ ...remote(), descriptor: { platform: { home: "/home/gpu" } } }]);
  fixture.serve("gpu", resourceHandlers(calls));
  const view = await mount(t, api.ResourcePage, resourceProps, { release: fixture.close });
  await waitFor(() => assert.ok(calls.length >= 2));
  assert.deepEqual(calls, ["/home/gpu", "/home/gpu"]);
  assert.ok(button(view.container, "Remote chat"));
});

test("resources wait for the target server's home API before loading plugins or skills", async (t) => {
  const calls = [];
  let resolveHome;
  const fixture = await setup();
  fixture.serve("gpu", {
    ...resourceHandlers(calls),
    "system.home": () =>
      new Promise((resolve) => {
        resolveHome = resolve;
      }),
  });
  const view = await mount(t, api.ResourcePage, resourceProps, { release: fixture.close });
  assert.ok(byRole(view.container, "status", "Resolving resource folder"));
  assert.ok(button(view.container, "This computer"), "scope controls remain usable while resolving the home");
  await waitFor(() => assert.equal(typeof resolveHome, "function"));
  assert.deepEqual(calls, []);
  await act(async () => resolveHome({ home: "/srv/remote-home" }));
  await waitFor(() => assert.ok(calls.length >= 2));
  assert.deepEqual(calls, ["/srv/remote-home", "/srv/remote-home"]);
});

test("a failed home lookup blocks resource calls but leaves retry and scope selection available", async (t) => {
  const calls = [];
  let attempts = 0;
  const fixture = await setup();
  fixture.serve("gpu", {
    ...resourceHandlers(calls),
    "system.home": () => {
      if (++attempts === 1) throw new Error("Server home unavailable");
      return { home: "/home/recovered" };
    },
  });
  const view = await mount(t, api.ResourcePage, resourceProps, { release: fixture.close });
  await waitFor(() => assert.ok(byRole(view.container, "alert")));
  assert.deepEqual(calls, []);
  assert.ok(button(view.container, "This computer"));
  await click(button(view.container, "Retry"));
  await waitFor(() => assert.ok(calls.length >= 2));
  assert.deepEqual(calls, ["/home/recovered", "/home/recovered"]);
});
