import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, act, click, input, button, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installHostBridge } from "../support/host-bridge.mjs";
import { createManagedProcessHost } from "../support/managed-process-host.mjs";

const { ProcessPanel, resetRpc, setAppLanguage } = await loadRenderer(
  "managed-process-ui-behavior",
  'export {ProcessPanel} from "./src/renderer/components/ProcessPanel.tsx";',
);
setAppLanguage("en-US");
after(restoreGlobals);

function processInfo(state = "running", extra = {}) {
  return {
    processId: "process-one",
    runId: "run-one",
    generation: 1,
    label: "Fixture server",
    kind: "server",
    state,
    readiness: "not-requested",
    ownerSessionId: "session-one",
    cwdDisplay: "/workspace",
    commandDisplay: "node server.mjs",
    createdAt: 1,
    stdinOpen: true,
    endpoints: [
      {
        id: "endpoint-one",
        url: "http://127.0.0.1:4173/",
        source: "stdout",
        firstSeenAt: 1,
        lastSeenAt: 1,
        runId: "run-one",
      },
    ],
    networkWarnings: [],
    restartCount: 0,
    output: { earliestCursor: "r:0", latestCursor: "r:0", retainedBytes: 0, droppedBytes: 0, droppedRecords: 0 },
    ...extra,
  };
}
const twoServers = (selectedState = "running") => [
  processInfo(),
  processInfo(selectedState, {
    processId: "process-two",
    runId: "second-run-one",
    label: "Other server",
    ownerSessionId: "session-two",
    endpoints: [],
  }),
];

async function panel(t, processes = [processInfo()]) {
  const fixture = createManagedProcessHost(processes);
  const opened = [];
  let diagnostics = 0;
  const copied = [];
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        copied.push(text);
      },
    },
  });
  t.after(() => {
    if (clipboardDescriptor) Object.defineProperty(dom.window.navigator, "clipboard", clipboardDescriptor);
    else delete dom.window.navigator.clipboard;
  });
  const bridgeDescriptor = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  dom.window.piBridge = {
    browserCreateUserTab: async (request) => {
      opened.push(request);
      return { id: "browser-one" };
    },
    exportDiagnostics: async () => {
      diagnostics++;
    },
  };
  resetRpc();
  const host = installHostBridge(dom.window, { call: fixture.call });
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      resetRpc();
      host.close();
      if (bridgeDescriptor) Object.defineProperty(dom.window, "piBridge", bridgeDescriptor);
      else delete dom.window.piBridge;
    }
  });
  view = await mount(t, ProcessPanel);
  const processButton = (label) =>
    [...view.container.querySelectorAll("button")].find((control) => control.textContent.includes(label));
  return {
    ...view,
    copied,
    inputs: fixture.inputs,
    exported: fixture.exported,
    opened,
    processButton,
    select: (label) => click(processButton(label)),
    diagnostics: () => diagnostics,
    async output(records) {
      fixture.setOutput("process-one", records);
      await act(async () =>
        host.emit("processes.output", "process-one", {
          processId: "process-one",
          runId: "run-one",
          revision: 2,
          latestCursor: "r:1",
        }),
      );
    },
  };
}

function assertHealthy(view) {
  assert.equal(view.container.querySelector('[role="alert"]'), null, "all controls use a valid process/run request");
}

test("output availability shows bounded plain text rather than executable markup", async (t) => {
  const view = await panel(t);
  const records = Array.from({ length: 2010 }, (_, index) => ({
    seq: index + 1,
    runId: "run-one",
    stream: "stdout",
    timestamp: index,
    text: index === 2009 ? '<img src=x onerror="attack()">' : `line-${index}`,
  }));
  await view.output(records);
  const log = view.container.querySelector('[role="log"]');
  assert.match(log.textContent, /^\[stdout\] line-10/);
  assert.doesNotMatch(log.textContent, /\[stdout\] line-[0-9](?=\[stdout\])/);
  assert.match(log.textContent, /<img src=x onerror="attack\(\)">$/);
  await click(button(view.container, "Copy Visible"));
  const lines = view.copied.at(-1).split("\n");
  assert.equal(lines.length, 2000, "the public copy action contains exactly the retained 2,000 records");
  assert.equal(lines[0], "[stdout] line-10");
  assert.equal(lines.at(-1), '[stdout] <img src=x onerror="attack()">');
  assert.equal(log.querySelector("img"), null);
  assertHealthy(view);
});

test("Stop terminates only the selected server and Restart uses its current run identity", async (t) => {
  const view = await panel(t, twoServers());
  await view.select("Other server");
  await click(button(view.container, "Stop"));
  assert.match(view.processButton("Other server").textContent, /Exited/);
  assert.match(view.processButton("Fixture server").textContent, /Running/);
  assertHealthy(view);

  await click(button(view.container, "Restart"));
  assert.match(view.processButton("Other server").textContent, /Running/);
  assert.match(view.processButton("Fixture server").textContent, /Running/);
  await click(button(view.container, "Export Logs"));
  assert.deepEqual(view.exported, [
    { processId: "process-two", runId: "second-run-two", streams: ["stdout", "stderr", "system"] },
  ]);
  assertHealthy(view);
});

test("Force Stop force-terminates the selected server without stopping another running server", async (t) => {
  const view = await panel(t, twoServers());
  await view.select("Other server");
  await click(button(view.container, "Force Stop"));
  assert.match(view.processButton("Other server").textContent, /Killed/);
  assert.match(view.processButton("Fixture server").textContent, /Running/);
  assertHealthy(view);
});

test("stdin and browser controls preserve the selected process and owning session", async (t) => {
  const view = await panel(t);
  await input(view.container.querySelector('input[placeholder="Send line to stdin"]'), "hello server");
  await click(button(view.container, "Send"));
  assert.deepEqual(view.inputs, [
    { processId: "process-one", runId: "run-one", text: "hello server", appendNewline: true },
  ]);
  const endpoint = [...view.container.querySelectorAll("button")].find((control) =>
    control.textContent.includes("Open in Browser:"),
  );
  await click(endpoint);
  assert.deepEqual(view.opened, [{ url: "http://127.0.0.1:4173/", ownerSessionId: "session-one", activate: true }]);
  assertHealthy(view);
});

test("dismissing a finished selected process leaves another running server available", async (t) => {
  const view = await panel(t, twoServers("killed"));
  await view.select("Other server");
  await click(button(view.container, "Dismiss"));
  assert.equal(view.processButton("Other server"), undefined);
  assert.match(view.processButton("Fixture server").textContent, /Running/);
  assertHealthy(view);
});

test("dismissing the last finished process shows the empty process list", async (t) => {
  const view = await panel(t, [processInfo("killed")]);
  await click(button(view.container, "Dismiss"));
  assert.match(view.container.textContent, /No background processes/);
  assertHealthy(view);
});

test("a lost process offers diagnostics and stops other active processes without pretending containment was recovered", async (t) => {
  const view = await panel(t, twoServers("lost"));
  await view.select("Other server");
  assert.match(view.container.querySelector('[role="alert"]').textContent, /could not be safely confirmed as stopped/);
  assert.equal(button(view.container, "Restart"), undefined);
  await click(button(view.container, "Export Diagnostics"));
  assert.equal(view.diagnostics(), 1);
  await click(button(view.container, "Stop All"));
  assert.match(view.processButton("Fixture server").textContent, /Killed/);
  assert.match(view.processButton("Other server").textContent, /Lost/);
  assert.match(view.container.querySelector('[role="alert"]').textContent, /could not be safely confirmed as stopped/);
});
