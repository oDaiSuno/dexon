import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { createManagedDomRoot, dom, restoreGlobals } from "../../resource-dom-environment.mjs";
import { act, createElement, StrictMode } from "react";
import { button, byRole, click, input, labelledControl, waitFor } from "../../../../../tests/support/dom-events.mjs";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "../../renderer-real-graph.mjs";

const root = path.resolve(import.meta.dirname, "../../../../..");
const api = await importTestBundle("server-management", {
  stdin: {
    contents: `export { ServersSettings } from "./src/renderer/components/settings/servers/servers-settings.tsx";
export { AddServerDialog } from "./src/renderer/components/settings/servers/add-server-dialog.tsx";
export { RemoveServerDialog } from "./src/renderer/components/settings/servers/remove-server-dialog.tsx";
export { SshHostList } from "./src/renderer/components/settings/servers/ssh-host-list.tsx";
export { workspaceStore } from "./src/renderer/lib/workspace-store.ts";
export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";
export { createRpcServer } from "./src/contract/rpc.ts";
export { subscribeSettingsRequest, subscribeResourcesRequest } from "./src/renderer/lib/settings-request.ts";`,
    resolveDir: root,
    sourcefile: "server-management-entry.tsx",
    loader: "tsx",
  },
  ...realRendererGraphOptions(root),
});
const remote = (id = "gpu", status = { phase: "offline", lastFailure: null }) => ({
  id,
  label: id,
  enabled: true,
  target: { kind: "ssh", sshAlias: id },
  status,
  descriptor: null,
});
const runtime = (overrides = {}) => ({
  nodeVersion: "v22.23.3",
  payloadVersion: "0.3.3",
  startedAt: 1000,
  ownership: "managed",
  updatePending: false,
  ...overrides,
});
const host = (alias, extra = {}) => ({
  alias,
  hostname: "10.0.0.8",
  user: "ubuntu",
  port: 22,
  identityFile: null,
  proxyJump: null,
  sourceFile: "~/.ssh/config",
  addedAs: null,
  ...extra,
});
let mounted;
let cleanup;
after(async () => {
  await act(async () => new Promise((resolve) => dom.window.setTimeout(resolve, 0)));
  restoreGlobals();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  cleanup?.();
  cleanup = null;
});

async function setup({ views = [], ui = {}, command, sessions } = {}) {
  const original = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  const commands = [];
  const channels = [];
  let currentViews = views;
  let revision = 1;
  let changed;
  const server = api.createRpcServer();
  if (sessions) server.handle({ "sessions.list": () => sessions });
  const bridge = {
    getUiState: async () => ui,
    setUiState: async () => {},
    listEnvironments: async () => ({
      revision,
      policy: { detachedDaemon: true, autoReconnect: true },
      environments: currentViews,
    }),
    onEnvironmentsChanged: (callback) => {
      changed = callback;
      return () => {
        changed = null;
      };
    },
    environmentCommand: async (action) => {
      commands.push(action);
      return command?.(action) ?? { configPath: "~/.ssh/config", hosts: [], error: null };
    },
    requestEnvironmentPort(environmentId) {
      const channel = new MessageChannel();
      channels.push(channel);
      server.attachPort(channel.port1);
      dom.window.dispatchEvent(
        new dom.window.MessageEvent("message", {
          source: dom.window,
          data: { channel: "dexon-host-port", environmentId, generation: 1 },
          ports: [channel.port2],
        }),
      );
    },
  };
  dom.window.piBridge = bridge;
  await act(async () => {
    api.environmentRegistry.initialize();
    await api.workspaceStore.initialize(bridge);
  });
  cleanup = () => {
    for (const channel of channels) {
      server.detachPort(channel.port1);
      channel.port1.close();
      channel.port2.close();
    }
    if (original) Object.defineProperty(dom.window, "piBridge", original);
    else delete dom.window.piBridge;
    api.environmentRegistry.initialize();
  };
  return {
    commands,
    async changeViews(next) {
      await act(async () => {
        currentViews = next;
        revision += 1;
        changed?.(await bridge.listEnvironments());
      });
    },
  };
}

async function render(Component, props = {}, strict = false) {
  mounted = createManagedDomRoot();
  const element = createElement(Component, props);
  await mounted.render(strict ? createElement(StrictMode, null, element) : element);
  return mounted.container;
}

test("SSH discovery survives a restarted effect and only offers new hosts for connection", async () => {
  const chosen = [];
  const fixture = await setup({
    views: [remote("already")],
    command: async () => ({
      configPath: "~/.ssh/config",
      hosts: [host("already", { addedAs: "already" }), host("new-host")],
      error: null,
    }),
  });
  const page = await render(
    api.SshHostList,
    { onConnect: (candidate) => chosen.push(candidate.alias), onManual: () => {} },
    true,
  );
  assert.match(page.textContent, /Already added/);
  assert.equal([...page.querySelectorAll("button")].filter((element) => element.textContent === "Connect").length, 1);
  await input(labelledControl(page, "Filter SSH hosts"), "10.0.0.8");
  await click(button(page, "Connect"));
  assert.deepEqual(chosen, ["new-host"]);
  await fixture.changeViews([]);
  assert.doesNotMatch(page.textContent, /Already added/);
  assert.equal([...page.querySelectorAll("button")].filter((element) => element.textContent === "Connect").length, 2);
});

test("offline removal defaults to keeping the daemon and does not claim to know running sessions", async () => {
  const spaces = [
    { environmentId: "gpu", path: "/code/a" },
    { environmentId: "gpu", path: "/code/b" },
  ];
  const { commands } = await setup({
    views: [remote()],
    ui: { projectSpaces: { version: 2, spaces, seeded: [] } },
    command: () => ({ remoteDaemon: "kept" }),
  });
  const focus = api.workspaceStore.getSnapshot().focus;
  const page = await render(api.RemoveServerDialog, { view: remote(), onClose: () => {} });
  assert.equal(page.querySelector('input[value="keep"]').checked, true);
  assert.match(page.textContent, /2 mounted project spaces/);
  assert.match(page.textContent, /cannot be confirmed/);
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, focus);
  await click(button(page, "Remove from this computer"));
  assert.deepEqual(commands, [{ type: "remove", environmentId: "gpu", remoteDaemon: "keep" }]);
  assert.match(page.textContent, /daemon was left running/);
});

test("running-session impact comes from the public list boundary without moving the current workspace", async () => {
  const view = remote("gpu", { phase: "connected", generation: 1, since: 0 });
  await setup({ views: [view], sessions: { sessions: [], runningSessionIds: ["one", "two"] } });
  const focus = api.workspaceStore.getSnapshot().focus;
  const page = await render(api.RemoveServerDialog, { view, onClose: () => {} });
  await waitFor(() => assert.match(page.textContent, /2 sessions are currently running/));
  assert.deepEqual(api.workspaceStore.getSnapshot().focus, focus);
});

test("removing an unreachable daemon reports the uncertainty instead of claiming it stopped", async () => {
  const { commands } = await setup({ views: [remote()], command: () => ({ remoteDaemon: "unreachable" }) });
  const page = await render(api.RemoveServerDialog, { view: remote(), onClose: () => {} });
  await click(page.querySelector('input[value="stop"]'));
  await click(button(page, "Remove and stop remote service"));
  assert.deepEqual(commands, [{ type: "remove", environmentId: "gpu", remoteDaemon: "stop" }]);
  assert.match(page.textContent, /may still be running/);
});

test("settings exclude the primary environment and explain automatic defaults without global lifecycle switches", async () => {
  const local = { ...remote("primary"), target: { kind: "primary" }, label: "Primary device" };
  const { commands } = await setup({ views: [local, remote()] });
  const page = await render(api.ServersSettings);
  assert.equal(page.querySelector('article[aria-label="Primary device"]'), null);
  assert.ok(page.querySelector('article[aria-label="gpu"]'));
  assert.equal(page.querySelectorAll('[role="switch"]').length, 0);
  assert.doesNotMatch(page.textContent, /Independent daemon/);
  assert.match(page.textContent, /automatically managed/);
  assert.match(page.textContent, /tasks keep running/);
  assert.match(page.textContent, /backoff/);
  assert.match(page.textContent, /idle/);
  assert.match(page.textContent, /per server/);
  assert.equal(
    commands.some((command) => command.type === "set-policy"),
    false,
  );
});

test("a directory permission diagnosis opens edit with the suggested directory expanded and focused", async () => {
  const view = remote("readonly", {
    phase: "blocked",
    diagnosis: { reason: "permission", detail: "EACCES", path: "~/.dexon", suggestedStateDir: "/data/dexon" },
  });
  await setup({ views: [view] });
  const page = await render(api.ServersSettings);
  await click(button(page, "Change remote directory"));
  const field = labelledControl(page.querySelector('[role="dialog"]'), "Remote data directory");
  await waitFor(() => assert.equal(dom.window.document.activeElement?.id, field.id));
  await act(async () => new Promise((resolve) => dom.window.setTimeout(resolve, 0)));
  assert.equal(dom.window.document.activeElement === field, true);
  assert.equal(field.value, "/data/dexon");
  assert.equal(field.closest("details").open, true);
  assert.equal(field.selectionStart, 0);
  assert.equal(field.selectionEnd, "/data/dexon".length);
});

test("host identity diagnosis shows the verification details and trusts only the named server", async () => {
  const view = remote("changed", {
    phase: "blocked",
    diagnosis: {
      reason: "host-key-changed",
      detail: "Host key changed",
      knownHost: "changed.example",
      fingerprint: "SHA256:example",
      knownHostsFile: "/home/dev/.ssh/known_hosts",
      mismatchLayer: "ssh-known-hosts",
    },
  });
  const { commands } = await setup({
    views: [view],
    command: (action) =>
      action.type === "discover-ssh-hosts" ? { configPath: "~/.ssh/config", hosts: [], error: null } : view,
  });
  const page = await render(api.ServersSettings);
  assert.match(page.textContent, /SHA256:example/);
  assert.match(page.textContent, /\/home\/dev\/\.ssh\/known_hosts/);
  await click(button(page, "Verify and trust again"));
  assert.deepEqual(
    commands.filter((command) => command.type === "trust"),
    [{ type: "trust", environmentId: "changed", trust: "host-key" }],
  );
});

test("deploying servers expose all four setup stages and the uploaded percentage", async () => {
  await setup({
    views: [remote("deploying", { phase: "connecting", stage: "deploying", attempt: 1, progress: 0.68 })],
  });
  const page = await render(api.ServersSettings);
  const progress = page.querySelector('[role="progressbar"]');
  assert.equal(progress.getAttribute("aria-valuenow"), "68");
  assert.match(page.textContent, /Verify passwordless login/);
  assert.match(page.textContent, /Check remote Node.js version/);
  assert.match(page.textContent, /Upload and deploy remote service \(68%\)/);
  assert.match(page.textContent, /Start daemon/);
});

test("authentication diagnosis copies the exact setup command for the selected server", async (t) => {
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
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
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
  const view = remote("auth", {
    phase: "blocked",
    diagnosis: {
      reason: "authentication",
      detail: "Permission denied: publickey",
      copyIdCommand: "ssh-copy-id -p 2222 ubuntu@10.0.0.8",
    },
  });
  await setup({ views: [view] });
  const page = await render(api.ServersSettings);
  await click(button(page, "Copy setup command"));
  assert.deepEqual(copied, ["ssh-copy-id -p 2222 ubuntu@10.0.0.8"]);
  assert.ok(button(page, "Copied"));
});

test("externally managed WebSocket services never offer a managed restart", async () => {
  const view = {
    ...remote("external"),
    target: { kind: "websocket", url: "wss://external.example" },
    runtime: runtime({ ownership: "external", updatePending: true }),
  };
  await setup({ views: [view] });
  const page = await render(api.ServersSettings);
  assert.equal(Boolean(button(page, "Restart and update")), false);
  await click(button(page, "More actions for external"));
  assert.equal(Boolean(byRole(dom.window.document.body, "menuitem", "Restart remote daemon")), false);
  assert.match(page.textContent, /Externally managed service/);
});

test("externally managed services can be removed locally but cannot be selected for daemon shutdown", async () => {
  const view = {
    ...remote("external"),
    target: { kind: "websocket", url: "wss://external.example" },
    runtime: runtime({ ownership: "external", updatePending: false }),
  };
  const { commands } = await setup({ views: [view], command: () => ({ remoteDaemon: "kept" }) });
  const page = await render(api.RemoveServerDialog, { view, onClose: () => {} });
  assert.equal(page.querySelector('input[value="stop"]').disabled, true);
  await click(button(page, "Remove from this computer"));
  assert.deepEqual(commands, [{ type: "remove", environmentId: "external", remoteDaemon: "keep" }]);
});

test("backoff starts with current time, ticks without snapshots and releases its timer when reconnect ends", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const set = Object.getOwnPropertyDescriptor(dom.window, "setInterval");
  const clear = Object.getOwnPropertyDescriptor(dom.window, "clearInterval");
  const timers = new Map();
  let nextTimer = 0;
  dom.window.setInterval = (callback) => {
    timers.set(++nextTimer, callback);
    return nextTimer;
  };
  dom.window.clearInterval = (timer) => {
    timers.delete(timer);
  };
  t.after(() => {
    Object.defineProperty(dom.window, "setInterval", set);
    Object.defineProperty(dom.window, "clearInterval", clear);
  });
  const fixture = await setup({ views: [remote()] });
  const page = await render(api.ServersSettings);
  assert.equal(timers.size, 0);
  t.mock.timers.tick(300_000);
  await fixture.changeViews([
    remote("gpu", { phase: "backoff", reason: "network", detail: "Network lost", retryAt: 303000, failureCount: 2 }),
  ]);
  assert.equal(page.querySelector("output").textContent, "Reconnecting · 2s");
  assert.equal(timers.size, 1);
  await act(async () => {
    t.mock.timers.tick(1000);
    for (const callback of timers.values()) callback();
  });
  assert.equal(page.querySelector("output").textContent, "Reconnecting · 1s");
  await fixture.changeViews([remote()]);
  assert.equal(timers.size, 0);
  await fixture.changeViews([
    remote("gpu", { phase: "backoff", reason: "network", detail: "Network lost", retryAt: 303000, failureCount: 2 }),
  ]);
  await mounted.unmount();
  assert.equal(timers.size, 0);
});

test("retry status identifies the next attempt and preserves the server runtime metadata", async () => {
  const view = {
    ...remote("gpu", {
      phase: "backoff",
      reason: "network",
      detail: "Network lost",
      retryAt: Date.now() + 12_000,
      failureCount: 2,
    }),
    runtime: runtime({ ownership: "managed", updatePending: false }),
  };
  await setup({ views: [view] });
  const page = await render(api.ServersSettings);
  assert.match(page.textContent, /attempt 3/);
  assert.doesNotMatch(page.textContent, /v22.23.3|0.3.3|Started/);
  await click(button(page, "More actions for gpu"));
  await click(byRole(dom.window.document.body, "menuitem", "Runtime details"));
  assert.match(page.textContent, /v22.23.3/);
  assert.match(page.textContent, /0.3.3/);
  await click(page.querySelector("details summary"));
  assert.equal(page.querySelector("details").open, false);
  await click(button(page, "More actions for gpu"));
  await click(byRole(dom.window.document.body, "menuitem", "Runtime details"));
  assert.equal(page.querySelector("details").open, true);
});

test("unsupported SSH environments never expose managed restart or allow daemon shutdown", async () => {
  const view = {
    ...remote("unsupported", {
      phase: "blocked",
      diagnosis: { reason: "unsupported", detail: "Unsupported remote platform" },
    }),
    runtime: runtime({ ownership: "managed", updatePending: true }),
  };
  await setup({ views: [view] });
  const page = await render(api.ServersSettings);
  assert.equal(Boolean(button(page, "Restart and update")), false);
  await click(button(page, "More actions for unsupported"));
  assert.equal(Boolean(byRole(dom.window.document.body, "menuitem", "Restart remote daemon")), false);
  await click(byRole(dom.window.document.body, "menuitem", "Remove remote server"));
  assert.equal(page.querySelector('input[value="stop"]').disabled, true);
});

test("a managed SSH daemon with an update can still be restarted by its named server action", async () => {
  const view = {
    ...remote("managed"),
    runtime: runtime({ ownership: "managed", updatePending: true }),
  };
  const { commands } = await setup({
    views: [view],
    command: (action) =>
      action.type === "discover-ssh-hosts" ? { configPath: "~/.ssh/config", hosts: [], error: null } : view,
  });
  const page = await render(api.ServersSettings);
  assert.equal(Boolean(button(page, "Restart and update")), false);
  await click(button(page, "More actions for managed"));
  await click(byRole(dom.window.document.body, "menuitem", "Restart remote daemon"));
  assert.equal(
    commands.some((command) => command.type === "restart-daemon"),
    false,
  );
  assert.match(page.textContent, /Running sessions and processes on this server will be interrupted\./);
  await click(button(page, "Cancel restart"));
  assert.equal(Boolean(button(page, "Confirm daemon restart")), false);
  await click(button(page, "More actions for managed"));
  await click(byRole(dom.window.document.body, "menuitem", "Restart remote daemon"));
  await click(button(page, "Confirm daemon restart"));
  assert.deepEqual(
    commands.filter((command) => command.type === "restart-daemon"),
    [{ type: "restart-daemon", environmentId: "managed" }],
  );
});

test("server menus split model and resource navigation by environment while keeping routine actions visible", async (t) => {
  const view = remote("gpu", { phase: "connected", generation: 1, since: 0 });
  await setup({ views: [view] });
  const settings = [],
    resources = [];
  t.after(api.subscribeSettingsRequest((request) => settings.push(request)));
  t.after(api.subscribeResourcesRequest((request) => resources.push(request)));
  const page = await render(api.ServersSettings);
  const row = page.querySelector('article[aria-label="gpu"]');
  assert.ok(button(row, "Open folder"));
  assert.ok(button(row, "Disconnect"));
  assert.equal(Boolean(button(row, "Edit")), false);
  assert.equal(Boolean(button(row, "Remove")), false);
  await click(button(row, "More actions for gpu"));
  await click(byRole(dom.window.document.body, "menuitem", "Configure models on this server"));
  assert.deepEqual(settings, [{ tab: "models", environmentId: "gpu" }]);
  await click(button(row, "More actions for gpu"));
  await click(byRole(dom.window.document.body, "menuitem", "Manage plugins and skills on this server"));
  assert.deepEqual(resources, [{ environmentId: "gpu" }]);
  await click(button(row, "More actions for gpu"));
  await click(byRole(dom.window.document.body, "menuitem", "Edit connection"));
  assert.match(page.querySelector('[role="dialog"]').textContent, /Edit remote server/);
});

test("an open edit dialog refreshes runtime details and restart ownership without replacing unsaved fields", async () => {
  const view = remote();
  const fixture = await setup({ views: [view] });
  const page = await render(api.ServersSettings);
  await click(button(page, "More actions for gpu"));
  await click(byRole(dom.window.document.body, "menuitem", "Edit connection"));
  const dialog = page.querySelector('[role="dialog"]');
  await input(labelledControl(dialog, "Display name"), "Unsaved name");
  await fixture.changeViews([{ ...view, runtime: runtime() }]);
  assert.ok(button(dialog, "Restart remote daemon"), "runtime ownership must refresh while the edit dialog stays open");
  assert.match(dialog.textContent, /v22.23.3/);
  await fixture.changeViews([{ ...view, runtime: runtime({ payloadVersion: "0.4.1", ownership: "external" }) }]);
  assert.match(dialog.textContent, /0.4.1/);
  assert.equal(Boolean(button(dialog, "Restart remote daemon")), false);
  assert.equal(labelledControl(dialog, "Display name").value, "Unsaved name");
});
