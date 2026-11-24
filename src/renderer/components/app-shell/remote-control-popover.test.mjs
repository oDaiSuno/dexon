import assert from "node:assert/strict";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import {
  dom,
  act,
  button,
  click,
  keyDown,
  mouseDown,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../../../../tests/support/renderer.mjs";
import { accessibleName } from "../../../../tests/support/dom-queries.mjs";

const api = await loadRenderer(
  "remote-control-popover",
  `export { TopBarServerStatus } from "./src/renderer/components/app-shell/top-bar-server-status.tsx";
export { workspaceStore } from "./src/renderer/lib/workspace-store.ts";
export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";
export { subscribeSettingsRequest, subscribeResourcesRequest } from "./src/renderer/lib/settings-request.ts";
export { ProjectMenuContent } from "./src/renderer/components/app-nav/project-menu.tsx";
export { projectMenuFor } from "./src/renderer/components/app-nav/project-menu-model.ts";
export { createRpcServer } from "./src/contract/rpc.ts";`,
);
after(restoreGlobals);

function remote(overrides = {}) {
  return {
    id: "gpu",
    label: "Training GPU",
    enabled: true,
    target: { kind: "ssh", sshAlias: "training", hostname: "gpu.example", user: "dev", port: 2222 },
    status: { phase: "connected", generation: 1, since: 0 },
    descriptor: null,
    runtime: {
      nodeVersion: "22.23.3",
      payloadVersion: "0.4.1",
      startedAt: 0,
      ownership: "managed",
      updatePending: false,
    },
    ...overrides,
  };
}

async function setup(t, { view = remote(), portForwards = [], command } = {}) {
  const original = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  const channels = [];
  const commands = [];
  const external = [];
  const settings = [];
  const resources = [];
  const browsed = [];
  const spaces = [
    { environmentId: "gpu", path: "/srv/train" },
    { environmentId: "gpu", path: "/srv/eval" },
    { environmentId: "other", path: "/srv/other" },
  ];
  let snapshot = {
    revision: 1,
    policy: { detachedDaemon: true, autoReconnect: true },
    environments: [{ ...remote(), id: "other", label: "Other server" }, view],
    portForwards,
  };
  let changed;
  const bridge = {
    getUiState: async () => ({ projectSpaces: { version: 2, spaces, seeded: [] } }),
    setUiState: async () => {},
    listEnvironments: async () => snapshot,
    onEnvironmentsChanged: (listener) => {
      changed = listener;
      return () => {
        changed = null;
      };
    },
    environmentCommand: async (action) => {
      commands.push(action);
      return command ? command(action) : snapshot.environments.find((item) => item.id === action.environmentId);
    },
    openExternal: async (url) => {
      external.push(url);
    },
    requestEnvironmentPort(environmentId) {
      const channel = new MessageChannel();
      const server = api.createRpcServer();
      server.handle({
        "projects.browse": (params) => {
          browsed.push({ environmentId, path: params.path });
          return {
            ok: true,
            path: "/srv/train",
            displayPath: "~/train",
            home: "/srv",
            parent: "/srv",
            git: null,
            folders: [],
            truncated: false,
          };
        },
        "system.validateCwd": ({ path }) => ({ ok: true, path }),
      });
      channels.push({ channel, server });
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
    api.workspaceStore.openSpace(spaces[0]);
  });
  const offSettings = api.subscribeSettingsRequest((request) => settings.push(request));
  const offResources = api.subscribeResourcesRequest((request) => resources.push(request));
  const page = await mount(
    t,
    api.TopBarServerStatus,
    {},
    {
      release() {
        offSettings();
        offResources();
        for (const { channel, server } of channels) {
          server.detachPort(channel.port1);
          channel.port1.close();
          channel.port2.close();
        }
        if (original) Object.defineProperty(dom.window, "piBridge", original);
        else delete dom.window.piBridge;
        api.environmentRegistry.initialize();
      },
    },
  );
  return {
    ...page,
    commands,
    external,
    settings,
    resources,
    browsed,
    trigger: () => page.container.querySelector('button[aria-haspopup="dialog"]'),
    dialog: () => dom.window.document.querySelector('[role="dialog"]'),
    async open() {
      await click(this.trigger());
      return this.dialog();
    },
    async push(patch) {
      await act(async () => {
        snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
        changed?.(snapshot);
      });
    },
  };
}

test("clicking the remote server opens its dialog and Escape closes it with focus restored", async (t) => {
  const page = await setup(t);
  const trigger = page.trigger();
  assert.ok(trigger, "the remote connection is an actionable dialog trigger");
  assert.match(trigger.textContent, /Training GPU.*Online/);
  assert.ok(button(page.container, "Training GPU · Online"), "the button name includes its server and status");
  assert.match(
    trigger.querySelector('[role="status"][aria-label="Server connection"]')?.textContent ?? "",
    /Training GPU.*Online/,
  );
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  await page.open();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(page.dialog());
  assert.match(page.dialog().textContent, /dev@gpu.example:2222/);
  await keyDown(page.dialog(), "Escape");
  assert.equal(page.dialog(), null);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(dom.window.document.activeElement, trigger);
  await page.open();
  await mouseDown(dom.window.document.body);
  assert.equal(page.dialog(), null);
});

test("connected server metrics stay quiet and model, resource and settings navigation keep the server scope", async (t) => {
  const page = await setup(t);
  await page.open();
  assert.match(page.dialog().textContent, /2 mounted spaces/);
  assert.match(page.dialog().textContent, /0 active port forwards/);
  await click(button(page.dialog(), "Configure models on this server"));
  assert.deepEqual(page.settings, [{ tab: "models", environmentId: "gpu" }]);
  assert.equal(page.dialog(), null);
  await page.open();
  await click(button(page.dialog(), "Manage plugins and skills on this server"));
  assert.deepEqual(page.resources, [{ environmentId: "gpu" }]);
  assert.equal(page.dialog(), null);
  await page.open();
  await click(button(page.dialog(), "All server settings"));
  assert.deepEqual(page.settings.at(-1), { tab: "servers", environmentId: "gpu" });
  assert.equal(page.dialog(), null);
});

test("opening a new folder closes the popover and browses this server without moving the workspace until mounting", async (t) => {
  const page = await setup(t);
  await page.open();
  await click(button(page.dialog(), "Open folder"));
  await waitFor(() => assert.equal(button(page.dialog(), "Mount project space")?.disabled, false));
  assert.equal(page.trigger().getAttribute("aria-expanded"), "false");
  assert.deepEqual(page.browsed, [{ environmentId: "gpu", path: "~" }]);
  assert.match(page.dialog().textContent, /Training GPU:~\/train/);
  await click(button(page.dialog(), "Cancel"));
  assert.equal(page.dialog(), null);
  assert.equal(dom.window.document.activeElement, page.trigger());
  await page.open();
  await click(button(page.dialog(), "Open folder"));
  await click(button(page.dialog(), "Server settings ↗"));
  assert.deepEqual(page.settings, [{ tab: "servers", environmentId: "gpu" }]);
  assert.equal(page.dialog(), null);
});

test("ports show only active forwards for this server and open or close the selected port through desktop commands", async (t) => {
  const entry = {
    id: "gpu:3000",
    environmentId: "gpu",
    remotePort: 3000,
    localPort: 43000,
    localUrl: "http://127.0.0.1:43000",
    status: "active",
  };
  const page = await setup(t, {
    portForwards: [
      entry,
      { ...entry, id: "other:8000", environmentId: "other", remotePort: 8000 },
      { ...entry, id: "gpu:9000", remotePort: 9000, status: "reconnecting" },
    ],
  });
  await page.open();
  assert.match(page.dialog().textContent, /1 active port forwards/);
  assert.match(page.dialog().textContent, /3000.*→.*http:\/\/127.0.0.1:43000/);
  assert.doesNotMatch(page.dialog().textContent, /8000|9000/);
  await click(button(page.dialog(), "Open port 3000 in browser"));
  assert.deepEqual(page.external, ["http://127.0.0.1:43000"]);
  await click(button(page.dialog(), "Close port forward 3000"));
  assert.deepEqual(page.commands, [{ type: "close-port-forward", environmentId: "gpu", remotePort: 3000 }]);
  await page.push({ portForwards: [] });
  assert.match(page.dialog().textContent, /0 active port forwards/);
  assert.equal(Boolean(button(page.dialog(), "Open port 3000 in browser")), false);
});

test("a pending managed update explains idle installation and restarting requires an in-place confirmation", async (t) => {
  const base = remote();
  const page = await setup(t, { view: { ...base, runtime: { ...base.runtime, updatePending: true } } });
  const dialog = await page.open();
  assert.match(dialog.textContent, /automatically when the server is idle/);
  await click(button(dialog, "Restart remote daemon"));
  assert.equal(page.dialog(), dialog);
  assert.match(dialog.textContent, /Confirm daemon restart/);
  assert.match(dialog.textContent, /Running sessions and processes on this server will be interrupted/);
  assert.match(dialog.textContent, /Training GPU/);
  assert.match(dialog.textContent, /dev@gpu.example:2222/);
  assert.doesNotMatch(dialog.textContent, /mounted spaces|active port forwards/);
  for (const label of [
    "Open folder",
    "Configure models on this server",
    "Manage plugins and skills on this server",
    "Disconnect",
    "All server settings",
  ]) {
    assert.equal(Boolean(button(dialog, label)), false, `${label} is hidden while confirming restart`);
  }
  assert.deepEqual(page.commands, []);
  await click(button(dialog, "Cancel"));
  assert.ok(button(dialog, "Restart remote daemon"));
  assert.ok(button(dialog, "All server settings"));
  assert.deepEqual(page.commands, []);
  await click(button(dialog, "Restart remote daemon"));
  await click(button(dialog, "Confirm daemon restart"));
  assert.deepEqual(page.commands, [{ type: "restart-daemon", environmentId: "gpu" }]);
  assert.ok(button(dialog, "Restart remote daemon"));
});

for (const stopOnDisconnect of [false, true]) {
  test(`disconnecting sends only the named command and ${stopOnDisconnect ? "warns that remote tasks stop" : "explains that remote tasks are not stopped"}`, async (t) => {
    const base = remote();
    const page = await setup(t, { view: { ...base, target: { ...base.target, stopOnDisconnect } } });
    await page.open();
    assert.match(
      page.dialog().textContent,
      stopOnDisconnect ? /stops the remote service and interrupts its tasks/ : /does not stop remote tasks/,
    );
    await click(button(page.dialog(), "Disconnect"));
    assert.deepEqual(page.commands, [{ type: "disconnect", environmentId: "gpu" }]);
  });
}

test("retry countdown ticks in the trigger and dialog while recovery actions preserve the saved draft reassurance", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 10_000 });
  const page = await setup(t, {
    view: remote({
      status: { phase: "backoff", reason: "network", detail: "raw socket detail", retryAt: 13_000, failureCount: 2 },
    }),
  });
  await page.open();
  assert.match(page.trigger().textContent, /Reconnecting in 3s/);
  assert.match(page.dialog().textContent, /Draft saved automatically/);
  assert.match(page.dialog().textContent, /Remote tasks are not stopped by this disconnection/);
  await act(async () => t.mock.timers.tick(1000));
  assert.match(page.trigger().textContent, /Reconnecting in 2s/);
  assert.match(page.dialog().textContent, /Reconnecting in 2s/);
  await click(button(page.dialog(), "Reconnect now"));
  await click(button(page.dialog(), "Pause reconnecting"));
  assert.deepEqual(page.commands, [
    { type: "connect", environmentId: "gpu" },
    { type: "disconnect", environmentId: "gpu" },
  ]);
  await page.push({
    environments: [remote({ status: { phase: "connecting", stage: "synchronizing", progress: null, attempt: 3 } })],
  });
  assert.match(page.trigger().textContent, /Connecting/);
  assert.match(page.dialog().textContent, /Draft saved automatically/);
  await click(button(page.dialog(), "Disconnect"));
  assert.deepEqual(page.commands.at(-1), { type: "disconnect", environmentId: "gpu" });
  const base = remote();
  await page.push({
    environments: [
      remote({ target: { ...base.target, stopOnDisconnect: true }, status: { phase: "offline", lastFailure: null } }),
    ],
  });
  assert.doesNotMatch(page.dialog().textContent, /Remote tasks are not stopped/);
  assert.match(page.dialog().textContent, /configured to stop on disconnect/);
});

test("a blocked server shows a human diagnosis without raw failure text and offers scoped diagnosis and retry", async (t) => {
  const page = await setup(t, {
    view: remote({
      status: {
        phase: "blocked",
        diagnosis: {
          reason: "authentication",
          detail: "SECRET_SSH_CONFIG Permission denied: publickey",
          copyIdCommand: null,
        },
      },
    }),
  });
  await page.open();
  assert.match(page.trigger().textContent, /Needs attention/);
  assert.match(page.dialog().textContent, /Passwordless login is not configured/);
  assert.doesNotMatch(
    page.dialog().textContent,
    /SECRET_SSH_CONFIG|Permission denied: publickey|Remote tasks are not stopped/,
  );
  await click(button(page.dialog(), "Retry"));
  assert.deepEqual(page.commands, [{ type: "connect", environmentId: "gpu" }]);
  await click(button(page.dialog(), "View diagnosis"));
  assert.deepEqual(page.settings, [{ tab: "servers", environmentId: "gpu" }]);
  assert.equal(page.dialog(), null);
});

test("a connection loss replaces a stale restart confirmation with recovery actions", async (t) => {
  const page = await setup(t);
  await page.open();
  await click(button(page.dialog(), "Restart remote daemon"));
  await page.push({ environments: [remote({ status: { phase: "offline", lastFailure: null } })] });
  assert.equal(Boolean(button(page.dialog(), "Confirm daemon restart")), false);
  assert.ok(button(page.dialog(), "Reconnect now"));
  assert.deepEqual(page.commands, []);
});

test("externally managed and unknown daemons never offer a restart even with a pending update", async (t) => {
  const base = remote();
  const page = await setup(t, {
    view: {
      ...base,
      target: { kind: "websocket", url: "wss://external.example" },
      runtime: { ...base.runtime, updatePending: true },
    },
  });
  await page.open();
  for (const view of [
    { ...base, runtime: null },
    { ...base, runtime: { ...base.runtime, ownership: "external", updatePending: true } },
  ]) {
    assert.equal(Boolean(button(page.dialog(), "Restart remote daemon")), false);
    await page.push({ environments: [view] });
  }
  assert.equal(Boolean(button(page.dialog(), "Restart remote daemon")), false);
});

test("a pending restart blocks duplicate submissions and a failed command leaves confirmation available for retry", async (t) => {
  let reject;
  const pending = new Promise((_resolve, fail) => {
    reject = fail;
  });
  const page = await setup(t, { command: () => pending });
  await page.open();
  await click(button(page.dialog(), "Restart remote daemon"));
  assert.equal(dom.window.document.activeElement, button(page.dialog(), "Cancel"));
  await click(button(page.dialog(), "Confirm daemon restart"));
  assert.equal(button(page.dialog(), "Confirm daemon restart").disabled, true);
  assert.equal(button(page.dialog(), "Cancel").disabled, true);
  await act(async () => reject(new Error("PRIVATE_INTERNAL_FAILURE")));
  assert.match(page.dialog().querySelector('[role="alert"]').textContent, /could not be completed/);
  assert.doesNotMatch(page.dialog().textContent, /PRIVATE_INTERNAL_FAILURE/);
  assert.equal(button(page.dialog(), "Confirm daemon restart").disabled, false);
  assert.equal(page.commands.length, 1);
});

test("changing servers dismisses the old dialog and late command completion cannot leak into the new server", async (t) => {
  let resolve;
  const pending = new Promise((finish) => {
    resolve = finish;
  });
  const page = await setup(t, { command: () => pending });
  await page.open();
  await click(button(page.dialog(), "Restart remote daemon"));
  await click(button(page.dialog(), "Confirm daemon restart"));
  await act(async () => api.workspaceStore.openSpace({ environmentId: "other", path: "/srv/other" }));
  assert.equal(page.dialog(), null);
  assert.match(page.trigger().textContent, /Other server/);
  await act(async () => resolve(remote()));
  await page.open();
  assert.equal(Boolean(button(page.dialog(), "Confirm daemon restart")), false);
  assert.equal(page.dialog().querySelector('[role="alert"]'), null);
  await act(async () => api.workspaceStore.openSpace({ environmentId: "primary", path: "/local" }));
  assert.equal(page.trigger(), null);
  assert.equal(page.dialog(), null);
});

test("global shutdown policy is respected unless this SSH server explicitly keeps running", async (t) => {
  const page = await setup(t);
  await page.open();
  await page.push({ policy: { detachedDaemon: false, autoReconnect: true } });
  assert.match(page.dialog().textContent, /stops the remote service and interrupts its tasks/);
  const base = remote();
  await page.push({ environments: [remote({ target: { ...base.target, stopOnDisconnect: false } })] });
  assert.match(page.dialog().textContent, /does not stop remote tasks/);
});

test("an offline remote project's first enabled menu action highlights reconnect and connects its named server", async (t) => {
  const page = await setup(t, { view: remote({ label: "gpu-a100", status: { phase: "offline", lastFailure: null } }) });
  const project = {
    key: '["gpu","/srv/train"]',
    environmentId: "gpu",
    path: "/srv/train",
    displayPath: "~/train",
    root: "/srv/train",
    name: "train",
    environment: remote({ label: "gpu-a100", status: { phase: "offline", lastFailure: null } }),
    connection: {
      tone: "offline",
      status: { kind: "offline", label: "Offline" },
      step: null,
      progress: null,
      countdown: null,
      canSend: false,
      primaryAction: "connect",
      diagnosis: null,
    },
    sessions: [],
    sessionActivity: "idle",
    activity: { workInFlight: false, urgency: null, counts: {} },
    current: true,
    pinned: false,
    missing: false,
    loading: false,
    error: null,
    homeDir: "/home/dev",
  };
  const model = api.projectMenuFor(project, { canMoveUp: false, canMoveDown: false });
  assert.equal(model.entries[0].action, "reconnect");
  assert.equal(model.entries[0].disabled, false);
  const menu = await mount(t, api.ProjectMenuContent, {
    project,
    missing: false,
    canMoveUp: false,
    canMoveDown: false,
    canClose: true,
    onMoveUp() {},
    onMoveDown() {},
    onClose() {},
  });
  const items = [...menu.container.querySelectorAll('[role="menuitem"]')];
  const firstEnabled = items.find((item) => item.getAttribute("aria-disabled") !== "true");
  assert.ok(firstEnabled);
  assert.equal(accessibleName(firstEnabled), "Reconnect gpu-a100");
  assert.equal(firstEnabled.dataset.highlighted, "true");
  assert.ok(firstEnabled.classList.contains("project-menu-reconnect"));
  await click(firstEnabled);
  await waitFor(() => assert.deepEqual(page.commands, [{ type: "connect", environmentId: "gpu" }]));
});
