import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach } from "node:test";
import { createManagedDomRoot, dom, restoreGlobals } from "../../resource-dom-environment.mjs";
import { act, createElement } from "react";
import { button, click, input, labelledControl } from "../../../../../tests/support/dom-events.mjs";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "../../renderer-real-graph.mjs";

const root = path.resolve(import.meta.dirname, "../../../../..");
const { EditServerDialog, AddServerDialog, environmentRegistry } = await importTestBundle("server-dialogs", {
  stdin: {
    contents: `export { EditServerDialog } from "./src/renderer/components/settings/servers/edit-server-dialog.tsx";
export { AddServerDialog } from "./src/renderer/components/settings/servers/add-server-dialog.tsx";
export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";`,
    resolveDir: root,
    sourcefile: "server-dialogs-entry.tsx",
    loader: "tsx",
  },
  ...realRendererGraphOptions(root),
});
const remote = {
  id: "worker-a",
  label: "Research",
  enabled: true,
  target: { kind: "websocket", url: "wss://worker.example", expectedEnvironmentId: "saved-id" },
  status: { phase: "offline", lastFailure: null },
  descriptor: null,
};
let mounted;
let originalBridge;
after(async () => {
  await act(async () => new Promise((resolve) => dom.window.setTimeout(resolve, 0)));
  restoreGlobals();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  if (originalBridge) Object.defineProperty(dom.window, "piBridge", originalBridge);
  else delete dom.window.piBridge;
  environmentRegistry.initialize();
});

async function renderDialog(Component, command, props = {}, policy = { detachedDaemon: true, autoReconnect: true }) {
  const view = props.view ?? remote;
  originalBridge = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  dom.window.piBridge = {
    listEnvironments: async () => ({
      revision: 1,
      policy,
      environments: [view],
    }),
    onEnvironmentsChanged: () => () => {},
    getUiState: async () => ({}),
    environmentCommand: command,
  };
  await act(async () => environmentRegistry.initialize());
  mounted = createManagedDomRoot();
  let closed = false;
  await mounted.render(
    createElement(Component, {
      ...props,
      onClose: () => {
        closed = true;
      },
    }),
  );
  return { container: mounted.container, closed: () => closed };
}

const renderEdit = (command, view = remote, policy) => renderDialog(EditServerDialog, command, { view }, policy);

const passedProbe = {
  steps: [],
  latencyMs: 24,
  nodeVersion: "v22.23.3",
  daemon: { running: true, since: 1000, ownership: "managed", payloadVersion: "0.3.3" },
  failure: null,
};

for (const kind of ["ssh", "websocket"]) {
  test(`manual ${kind} drafts can be tested before addition, clear reports on edits and open the saved server`, async () => {
    const commands = [];
    const opened = [];
    const connected = { ...remote, id: "worker-new", status: { phase: "connected", generation: 1, since: 0 } };
    const page = await renderDialog(
      AddServerDialog,
      async (command) => {
        commands.push(command);
        return command.type === "test" ? passedProbe : connected;
      },
      { initialTab: "manual", onOpenProject: (id) => opened.push(id) },
    );
    const container = page.container;
    if (kind === "websocket") await click(button(container, "WebSocket address"));
    assert.ok(button(container, "Test connection"), "manual drafts must offer a connection test before addition");
    await click(button(container, "Test connection"));
    assert.deepEqual(commands, []);
    await input(labelledControl(container, "Display name"), "Worker");
    if (kind === "ssh") await input(labelledControl(container, "Host or SSH alias"), "worker");
    else {
      await input(labelledControl(container, "Remote service address"), "https://invalid.example");
      await input(labelledControl(container, "Access token"), "new-token");
      await click(button(container, "Test connection"));
      assert.deepEqual(commands, []);
      await input(labelledControl(container, "Remote service address"), "wss://worker.example");
    }
    await click(button(container, "Test connection"));
    const draft =
      kind === "ssh"
        ? { label: "Worker", target: { kind: "ssh", sshAlias: "worker", stopOnDisconnect: false } }
        : { label: "Worker", target: { kind: "websocket", url: "wss://worker.example" }, authToken: "new-token" };
    assert.deepEqual(commands, [{ type: "test", subject: { draft } }]);
    assert.match(container.textContent, /Connection test passed/);
    assert.match(container.textContent, /24 ms/);
    assert.match(container.textContent, /Daemon is running/);
    await input(labelledControl(container, "Display name"), "Renamed");
    assert.doesNotMatch(container.textContent, /Connection test passed/);
    await click(button(container, "Add and connect"));
    assert.deepEqual(commands.at(-1), { type: "add", connect: true, draft: { ...draft, label: "Renamed" } });
    await click(button(container, "Open project"));
    assert.deepEqual(opened, ["worker-new"]);
  });
}

test("saving a WebSocket edit sends the changed address without clearing the saved token or trusted identity", async () => {
  const commands = [];
  const page = await renderEdit(async (command) => {
    commands.push(command);
    return remote;
  });
  await input(labelledControl(page.container, "Remote service address"), "wss://new-worker.example");
  await click(button(page.container, "Save changes"));
  assert.deepEqual(commands, [
    {
      type: "update",
      environmentId: "worker-a",
      draft: { label: "Research", target: { kind: "websocket", url: "wss://new-worker.example" } },
    },
  ]);
  assert.equal(page.closed(), true);
});

test("testing draft connection details reports latency, Node and daemon without saving", async () => {
  const commands = [];
  const page = await renderEdit(async (command) => {
    commands.push(command);
    return {
      steps: [
        { step: 1, outcome: "passed" },
        { step: 2, outcome: "passed" },
        { step: 3, outcome: "skipped" },
        { step: 4, outcome: "passed" },
      ],
      latencyMs: 24,
      nodeVersion: "v22.23.3",
      daemon: { running: true, since: 1000, ownership: "managed", payloadVersion: "0.3.3" },
      failure: null,
    };
  });
  await input(labelledControl(page.container, "Remote service address"), "wss://probe.example");
  await input(labelledControl(page.container, "Access token"), "new-token");
  await click(button(page.container, "Test connection"));
  assert.deepEqual(commands, [
    {
      type: "test",
      subject: {
        draft: { label: "Research", target: { kind: "websocket", url: "wss://probe.example" }, authToken: "new-token" },
      },
    },
  ]);
  assert.match(page.container.textContent, /24 ms/);
  assert.match(page.container.textContent, /v22.23.3/);
  assert.match(page.container.textContent, /Daemon is running/);
  assert.equal(page.closed(), false);
});

test("a blocked draft test cannot reconnect or change trust for the saved server", async () => {
  const commands = [];
  const page = await renderEdit(async (command) => {
    commands.push(command);
    return {
      steps: [],
      latencyMs: 24,
      nodeVersion: null,
      daemon: null,
      failure: {
        kind: "blocked",
        diagnosis: {
          reason: "identity-mismatch",
          detail: "The draft points at another environment",
          expectedEnvironmentId: "saved-id",
          actualEnvironmentId: "different-id",
          mismatchLayer: "dexon-environment-id",
        },
      },
    };
  });
  await input(labelledControl(page.container, "Remote service address"), "wss://different.example");
  await input(labelledControl(page.container, "Access token"), "draft-token");
  await click(button(page.container, "Test connection"));
  assert.equal(Boolean(button(page.container, "Verify and trust again")), false);
  assert.equal(Boolean(button(page.container, "Retry")), false);
  await click(button(page.container, "Test connection"));
  assert.equal(commands.length, 2);
  assert.deepEqual(
    commands.map((command) => command.type),
    ["test", "test"],
  );
  assert.equal(commands[1].subject.draft.target.url, "wss://different.example");
  assert.equal(page.closed(), false);
});

test("a failed save keeps the dialog open and displays the command failure", async () => {
  const page = await renderEdit(async () => {
    throw new Error("Permission denied by server");
  });
  await click(button(page.container, "Save changes"));
  assert.equal(page.closed(), false);
  assert.match(page.container.querySelector('[role="alert"]').textContent, /Permission denied by server/);
  assert.equal(button(page.container, "Save changes").disabled, false);
});

test("a pending save disables repeat submissions and resolving after unmount does not close a later screen", async () => {
  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const page = await renderEdit(() => {
    calls += 1;
    return result;
  });
  await click(button(page.container, "Save changes"));
  assert.equal(button(page.container, "Save changes").disabled, true);
  assert.equal(calls, 1);
  await mounted.unmount();
  await act(async () => {
    finish(remote);
    await result;
  });
  assert.equal(page.closed(), false);
});

test("testing an unchanged WebSocket address uses the stored token and trusted identity", async () => {
  const commands = [];
  const page = await renderEdit(async (command) => {
    commands.push(command);
    return { steps: [], latencyMs: 24, nodeVersion: null, daemon: null, failure: null };
  });
  await click(button(page.container, "Test connection"));
  assert.deepEqual(commands, [{ type: "test", subject: { environmentId: "worker-a" } }]);
});

test("SSH advanced options hide legacy service ports and save the per-server shutdown choice", async () => {
  const view = { ...remote, target: { kind: "ssh", sshAlias: "rented", remotePort: 39100 } };
  const commands = [];
  const page = await renderEdit(async (command) => {
    commands.push(command);
    return view;
  }, view);
  assert.doesNotMatch(page.container.textContent, /Remote service port/);
  await click(page.container.querySelector("details summary"));
  const shutdown = labelledControl(page.container, "Stop the remote service on disconnect or exit");
  assert.equal(shutdown.checked, false);
  assert.match(page.container.textContent, /temporary rented machines/);
  await click(shutdown);
  await click(button(page.container, "Save changes"));
  assert.deepEqual(commands, [
    {
      type: "update",
      environmentId: "worker-a",
      draft: {
        label: "Research",
        target: { kind: "ssh", sshAlias: "rented", remotePort: 39100, stopOnDisconnect: true },
      },
    },
  ]);
});

test("testing a changed WebSocket address asks for its token without pretending to test saved credentials", async () => {
  const commands = [];
  const page = await renderEdit(async (command) => {
    commands.push(command);
    return { steps: [], latencyMs: null, nodeVersion: null, daemon: null, failure: null };
  });
  await input(labelledControl(page.container, "Remote service address"), "wss://different.example");
  await click(button(page.container, "Test connection"));
  assert.deepEqual(commands, []);
  assert.match(page.container.textContent, /Enter the access token to test a changed WebSocket address/);
});

test("editing managed SSH offers emergency restart beside testing and keeps runtime metadata in a disclosure", async () => {
  const view = {
    ...remote,
    target: { kind: "ssh", sshAlias: "worker-a" },
    runtime: {
      nodeVersion: "v22.23.3",
      payloadVersion: "0.3.3",
      startedAt: 1000,
      ownership: "managed",
      updatePending: false,
    },
  };
  const commands = [];
  const page = await renderEdit(async (command) => {
    commands.push(command);
    return view;
  }, view);
  const container = page.container;
  assert.ok(button(container, "Restart remote daemon"), "managed SSH edit must offer an emergency restart");
  assert.ok(button(container, "Test connection"));
  const details = [...container.querySelectorAll("details")].find(
    (item) => item.querySelector("summary").textContent === "Runtime details",
  );
  assert.ok(details);
  assert.equal(details.open, false);
  await click(details.querySelector("summary"));
  assert.match(details.textContent, /v22.23.3/);
  assert.match(details.textContent, /0.3.3/);
  await input(labelledControl(container, "Host or SSH alias"), "unsaved-host");
  await click(button(container, "Restart remote daemon"));
  assert.deepEqual(commands, []);
  assert.match(container.textContent, /Running sessions and processes on this server will be interrupted\./);
  await click(button(container, "Cancel restart"));
  assert.equal(Boolean(button(container, "Confirm daemon restart")), false);
  await click(button(container, "Restart remote daemon"));
  await click(button(container, "Confirm daemon restart"));
  assert.deepEqual(commands, [{ type: "restart-daemon", environmentId: "worker-a" }]);
  assert.equal(page.closed(), false);
  assert.equal(Boolean(button(container, "Confirm daemon restart")), false);
});

for (const target of [
  { kind: "websocket", url: "wss://worker.example" },
  { kind: "ssh", sshAlias: "worker-a" },
]) {
  test(`editing an externally managed ${target.kind} service never offers restart`, async () => {
    const view = {
      ...remote,
      target,
      runtime: {
        nodeVersion: "v22.23.3",
        payloadVersion: "0.3.3",
        startedAt: 1000,
        ownership: "external",
        updatePending: true,
      },
    };
    const page = await renderEdit(async () => view, view);
    assert.equal(Boolean(button(page.container, "Restart remote daemon")), false);
  });
}

test("a pending SSH scan cannot block manual addition or replace it with a late scan failure", async () => {
  let rejectDiscovery;
  const discovery = new Promise((_resolve, reject) => {
    rejectDiscovery = reject;
  });
  const commands = [];
  const connected = { ...remote, id: "manual-new", status: { phase: "connected", generation: 1, since: 0 } };
  const page = await renderDialog(
    AddServerDialog,
    (command) => {
      commands.push(command);
      return command.type === "discover-ssh-hosts" ? discovery : connected;
    },
    { onOpenProject: () => {} },
  );
  assert.match(page.container.textContent, /Reading local SSH configuration/);
  await click(button(page.container, "Enter connection details"));
  await input(labelledControl(page.container, "Display name"), "Manual");
  await input(labelledControl(page.container, "Host or SSH alias"), "manual");
  await click(button(page.container, "Add and connect"));
  assert.equal(commands.filter((command) => command.type === "add").length, 1);
  assert.ok(button(page.container, "Open project"));
  await act(async () => {
    rejectDiscovery(new Error("Late discovery failure"));
    await discovery.catch(() => {});
  });
  assert.equal(page.container.querySelector('[role="alert"]'), null);
  assert.ok(button(page.container, "Open project"));
});

for (const stopOnDisconnect of [undefined, false]) {
  test(`editing a legacy SSH server preserves effective shutdown behavior with override ${stopOnDisconnect}`, async () => {
    const view = {
      ...remote,
      target: { kind: "ssh", sshAlias: "legacy", ...(stopOnDisconnect === undefined ? {} : { stopOnDisconnect }) },
    };
    const commands = [];
    const page = await renderEdit(
      async (command) => {
        commands.push(command);
        return view;
      },
      view,
      { detachedDaemon: false, autoReconnect: true },
    );
    await click(page.container.querySelector("details summary"));
    assert.equal(
      labelledControl(page.container, "Stop the remote service on disconnect or exit").checked,
      stopOnDisconnect ?? true,
    );
    await input(labelledControl(page.container, "Display name"), "Renamed legacy");
    await click(button(page.container, "Save changes"));
    assert.equal(commands[0].draft.target.stopOnDisconnect, stopOnDisconnect ?? true);
  });
}

test("adding a discovered SSH host explicitly keeps tasks alive even when a legacy global policy stops services", async () => {
  const commands = [];
  const page = await renderDialog(
    AddServerDialog,
    async (command) => {
      commands.push(command);
      return command.type === "discover-ssh-hosts"
        ? {
            configPath: "~/.ssh/config",
            error: null,
            hosts: [
              {
                alias: "gpu-new",
                hostname: "10.0.0.8",
                user: null,
                port: 22,
                identityFile: null,
                proxyJump: null,
                sourceFile: "~/.ssh/config",
                addedAs: null,
              },
            ],
          }
        : { ...remote, id: "gpu-new" };
    },
    {},
    { detachedDaemon: false, autoReconnect: true },
  );
  await click(button(page.container, "Connect"));
  assert.deepEqual(
    commands.find((command) => command.type === "add"),
    {
      type: "add",
      connect: true,
      draft: { label: "gpu-new", target: { kind: "ssh", sshAlias: "gpu-new", stopOnDisconnect: false } },
    },
  );
});
