import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach } from "node:test";
import { createManagedDomRoot, dom, restoreGlobals } from "../../resource-dom-environment.mjs";
import { act, createElement } from "react";
import { button, click, input, labelledControl } from "../../../../../tests/support/dom-events.mjs";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "../../renderer-real-graph.mjs";

const root = path.resolve(import.meta.dirname, "../../../../..");
const { EditServerDialog } = await importTestBundle("server-dialogs", {
  entryPoints: [path.join(import.meta.dirname, "edit-server-dialog.tsx")],
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
after(() => restoreGlobals());
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  if (originalBridge) Object.defineProperty(dom.window, "piBridge", originalBridge);
  else delete dom.window.piBridge;
});

async function renderEdit(command) {
  originalBridge = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  dom.window.piBridge = {
    listEnvironments: async () => ({
      revision: 1,
      policy: { detachedDaemon: true, autoReconnect: true },
      environments: [remote],
    }),
    onEnvironmentsChanged: () => () => {},
    getUiState: async () => ({}),
    environmentCommand: command,
  };
  mounted = createManagedDomRoot();
  let closed = false;
  await mounted.render(
    createElement(EditServerDialog, {
      view: remote,
      onClose: () => {
        closed = true;
      },
    }),
  );
  return { container: mounted.container, closed: () => closed };
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
