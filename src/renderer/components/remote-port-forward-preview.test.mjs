import {
  attributionFixture,
  harness,
  rootEl,
  restoreGlobals,
  createElement,
  act,
} from "./remote-attribution.harness.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { button, click, byRole, getByRole } from "../../../tests/support/dom-events.mjs";
import { browserState, browserTab } from "../../../tests/support/browser-state.mjs";

after(restoreGlobals);

const process = {
  processId: "dev-server",
  runId: "run-1",
  generation: 1,
  label: "Remote app",
  kind: "server",
  state: "ready",
  readiness: "ready",
  ownerSessionId: "remote-owner",
  cwdDisplay: "/srv/shared",
  commandDisplay: "npm run dev",
  createdAt: 1,
  startedAt: 1,
  stdinOpen: false,
  endpoints: [
    {
      id: "web",
      url: "http://localhost:3000/docs/start?mode=preview#intro",
      runId: "run-1",
      source: "stdout",
      firstSeenAt: 1,
      lastSeenAt: 1,
    },
  ],
  networkWarnings: [],
  restartCount: 0,
  output: { earliestCursor: "0", latestCursor: "0", retainedBytes: 0, droppedBytes: 0, droppedRecords: 0 },
};

function forward(overrides = {}) {
  return {
    id: "forward-a",
    environmentId: "remote-a",
    remotePort: 3000,
    localPort: 43000,
    localUrl: "http://127.0.0.1:43000",
    processId: process.processId,
    label: process.label,
    status: "active",
    ...overrides,
  };
}

async function fixture(t, { capable = true, items = [process] } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: harness.dom.window.CustomEvent });
  t.after(() =>
    descriptor ? Object.defineProperty(globalThis, "CustomEvent", descriptor) : delete globalThis.CustomEvent,
  );
  const f = await attributionFixture(
    t,
    'export { useProcessPanelState } from "./components/processes/use-process-panel-state.ts";' +
      'export { ProcessPanel } from "./components/ProcessPanel.tsx";' +
      'export { RightPanelDock } from "./components/app-shell/right-panel-dock.tsx";',
  );
  await f.push({
    environments: f.api.environmentRegistry.getSnapshot().environments.map((view) => ({
      ...view,
      descriptor: { capabilities: { portForwarding: capable }, platform: { os: "linux", pathStyle: "posix" } },
    })),
  });
  const list = () => ({ revision: 1, processes: items });
  const read = () => ({ records: [], nextCursor: "0", truncated: false });
  f.setPrimaryHost({
    call(method) {
      if (method === "processes.list") return list();
      if (method === "processes.read") return read();
      throw new Error(`Unexpected process request: ${method}`);
    },
  });
  for (const id of ["remote-a", "remote-b"]) f.serve(id, {}).handle({ "processes.list": list, "processes.read": read });
  const tabs = [];
  const bridge = harness.dom.window.piBridge;
  const createTab = Object.getOwnPropertyDescriptor(bridge, "browserCreateUserTab");
  bridge.browserCreateUserTab = async (input) => {
    tabs.push(input);
    return { id: "preview-tab" };
  };
  t.after(() =>
    createTab ? Object.defineProperty(bridge, "browserCreateUserTab", createTab) : delete bridge.browserCreateUserTab,
  );
  t.mock.method(harness.dom.window.piBridge, "environmentCommand", async (command) => {
    f.commands.push(command);
    return command.type === "close-port-forward"
      ? { closed: true }
      : forward({ environmentId: command.environmentId, remotePort: command.remotePort });
  });
  const events = [];
  const listener = (event) => events.push(event.detail);
  harness.dom.window.addEventListener("dexon:open-browser-tab", listener);
  t.after(() => harness.dom.window.removeEventListener("dexon:open-browser-tab", listener));
  const onOpenBrowser = t.mock.fn();
  let state;
  function Probe(props) {
    state = f.api.useProcessPanelState({ ...props, onOpenBrowser });
    return createElement("output", null, state.error);
  }
  return {
    ...f,
    tabs,
    events,
    onOpenBrowser,
    Probe,
    get state() {
      return state;
    },
    async mount(environmentId = "remote-a") {
      await f.render(Probe, { environmentId });
      await f.flush();
      await f.flush();
    },
  };
}

test("opening a remote loopback preview forwards the owning process and preserves its URL suffix and browser handoff", async (t) => {
  const f = await fixture(t);
  await f.mount();
  await act(async () => f.state.openEndpoint(process, process.endpoints[0].url));
  assert.deepEqual(f.commands, [
    {
      type: "open-port-forward",
      environmentId: "remote-a",
      remotePort: 3000,
      processId: "dev-server",
      label: "Remote app",
    },
  ]);
  assert.deepEqual(f.tabs, [
    { url: "http://127.0.0.1:43000/docs/start?mode=preview#intro", ownerSessionId: "remote-owner", activate: true },
  ]);
  assert.deepEqual(f.events, [{ tabId: "preview-tab" }]);
  assert.equal(f.onOpenBrowser.mock.callCount(), 1);
});

test("the process panel uses its own environment capability and shows only active scoped forwards with a stop action", async (t) => {
  const f = await fixture(t);
  await f.push({
    portForwards: [
      forward(),
      forward({ id: "other", environmentId: "remote-b", localPort: 44000 }),
      ...["reconnecting", "stopped", "error"].map((status, i) => forward({ id: status, status, localPort: 43001 + i })),
    ],
  });
  await f.render(f.api.ProcessPanel, { environmentId: "remote-a", onOpenBrowser: f.onOpenBrowser });
  await f.flush();
  await f.flush();
  assert.ok(
    button(rootEl, "Forward & preview"),
    "remote actions must not inherit the globally focused primary environment",
  );
  assert.match(rootEl.textContent, /:43000 previewing/);
  assert.doesNotMatch(rootEl.textContent, /44000|43001|43002|43003/);
  await click(button(rootEl, "Forward & preview"));
  assert.equal(f.tabs[0].url, "http://127.0.0.1:43000/docs/start?mode=preview#intro");
  await click(button(rootEl, "Stop forwarding"));
  assert.deepEqual(f.commands.at(-1), { type: "close-port-forward", environmentId: "remote-a", remotePort: 3000 });
  await f.push({ portForwards: [forward({ status: "stopped" })] });
  assert.doesNotMatch(rootEl.textContent, /previewing|Stop forwarding/);
});

test("primary process previews retain their existing browser action without a forwarding command", async (t) => {
  const f = await fixture(t);
  await f.focus();
  await f.render(f.api.ProcessPanel, { environmentId: "primary", onOpenBrowser: f.onOpenBrowser });
  await f.flush();
  await f.flush();
  assert.equal(button(rootEl, "Open in browser").disabled, false);
  assert.equal(button(rootEl, "Forward & preview"), undefined);
  await click(button(rootEl, "Open in browser"));
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.tabs, [
    { url: "http://localhost:3000/docs/start?mode=preview#intro", ownerSessionId: "remote-owner", activate: true },
  ]);
  assert.deepEqual(f.events, [{ tabId: "preview-tab" }]);
  assert.equal(f.onOpenBrowser.mock.callCount(), 1);
});

test("a remote without forwarding capability disables preview and cannot open or close a tunnel", async (t) => {
  const f = await fixture(t, { capable: false });
  await f.mount();
  await act(async () => {
    await f.state.openEndpoint(process, process.endpoints[0].url);
    await f.state.closeForward(3000);
  });
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.tabs, []);
  await f.render(f.api.ProcessPanel, { environmentId: "remote-a" });
  await f.flush();
  await f.flush();
  assert.equal(button(rootEl, "Forward & preview").disabled, true);
});

test("non-loopback hosts and malformed ports never reach the environment command boundary", async (t) => {
  const f = await fixture(t, {
    items: [{ ...process, endpoints: [{ ...process.endpoints[0], url: "http://example.com:3000" }] }],
  });
  await f.mount();
  for (const url of [
    "http://example.com:3000",
    "http://0.0.0.0:3000",
    "http://localhost.evil:3000",
    "http://127.0.0.2:3000",
    "http://127.1:3000",
    "http://2130706433:3000",
    "http://0x7f000001:3000",
    "http://user@localhost:3000",
    "http://localhost:0",
    "http://localhost:65536",
    "http://localhost:3000oops",
    "http://localhost:",
    "http://localhost:-1",
    "http://localhost:3.5",
    "ftp://localhost:3000",
    "file:///localhost:3000",
    "http://localhost:3000\\@example.com",
    " http://localhost:3000",
    "http://localhost:3000\n",
  ])
    await act(async () => f.state.openEndpoint(process, url));
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.tabs, []);
  await f.render(f.api.ProcessPanel, { environmentId: "remote-a" });
  await f.flush();
  await f.flush();
  assert.equal(button(rootEl, "Forward & preview").disabled, true);
});

test("loopback HTTP and HTTPS previews use strict explicit or default ports without rewriting the original suffix", async (t) => {
  const f = await fixture(t);
  await f.mount();
  for (const url of [
    "http://localhost",
    "https://127.0.0.1/a%2Fb?q=a%20b#c",
    "https://[::1]:8443/?x=1#end",
    "http://localhost:65535/a/../b?raw=%2f#part",
  ]) {
    await act(async () => f.state.openEndpoint(process, url));
  }
  assert.deepEqual(
    f.commands.map((command) => command.remotePort),
    [80, 443, 8443, 65535],
  );
  assert.deepEqual(
    f.tabs.map((tab) => tab.url),
    [
      "http://127.0.0.1:43000/",
      "https://127.0.0.1:43000/a%2Fb?q=a%20b#c",
      "https://127.0.0.1:43000/?x=1#end",
      "http://127.0.0.1:43000/a/../b?raw=%2f#part",
    ],
  );
});

test("the public process state exposes only genuinely active forwards in its current environment", async (t) => {
  const f = await fixture(t);
  await f.push({
    portForwards: [
      forward(),
      forward({ id: "other", environmentId: "remote-b", localPort: 44000 }),
      ...["reconnecting", "stopped", "error"].map((status) => forward({ id: status, status })),
    ],
  });
  await f.mount();
  assert.deepEqual(f.state.portForwards, [forward()]);
  await f.mount("remote-b");
  assert.deepEqual(f.state.portForwards, [forward({ id: "other", environmentId: "remote-b", localPort: 44000 })]);
  await f.push({ portForwards: undefined });
  assert.deepEqual(f.state.portForwards, []);
});

test("failed or inactive forwards never create a preview and retrying clears the old error immediately", async (t) => {
  const f = await fixture(t);
  await f.mount();
  const bridge = harness.dom.window.piBridge;
  for (const status of ["reconnecting", "stopped", "error"]) {
    bridge.environmentCommand = async () => forward({ status });
    await act(async () => f.state.openEndpoint(process, process.endpoints[0].url));
    assert.match(rootEl.textContent, /Could not open the forwarded preview\. Try again\./);
  }
  bridge.environmentCommand = async () => {
    throw new Error("SSH unavailable");
  };
  await act(async () => f.state.openEndpoint(process, process.endpoints[0].url));
  assert.match(rootEl.textContent, /Could not open the forwarded preview/);
  assert.deepEqual(f.tabs, []);
  assert.deepEqual(f.events, []);
  assert.equal(f.onOpenBrowser.mock.callCount(), 0);
  let resolve;
  bridge.environmentCommand = () =>
    new Promise((done) => {
      resolve = done;
    });
  let opening;
  await act(async () => {
    opening = f.state.openEndpoint(process, process.endpoints[0].url);
  });
  assert.equal(rootEl.textContent, "");
  assert.equal(f.state.busy, true);
  await act(async () => {
    resolve(forward());
    await opening;
  });
  assert.equal(f.tabs.length, 1);
  assert.equal(f.state.busy, false);
});

test("changing the panel environment while a forward opens prevents stale preview handoff even after switching back", async (t) => {
  const f = await fixture(t);
  await f.mount();
  let resolve;
  harness.dom.window.piBridge.environmentCommand = () =>
    new Promise((done) => {
      resolve = done;
    });
  let opening;
  await act(async () => {
    opening = f.state.openEndpoint(process, process.endpoints[0].url);
  });
  await f.mount("remote-b");
  assert.equal(f.state.busy, false);
  await f.mount("remote-a");
  await act(async () => {
    resolve(forward());
    await opening;
  });
  assert.deepEqual(f.tabs, []);
  assert.deepEqual(f.events, []);
  assert.equal(f.onOpenBrowser.mock.callCount(), 0);
  assert.equal(f.state.error, null);
});

test("a browser failure after forwarding reports a recoverable error without activating the preview panel", async (t) => {
  const f = await fixture(t);
  await f.mount();
  harness.dom.window.piBridge.browserCreateUserTab = async () => {
    throw new Error("Browser unavailable");
  };
  await act(async () => f.state.openEndpoint(process, process.endpoints[0].url));
  assert.match(rootEl.textContent, /Could not open the forwarded preview\. Try again\./);
  assert.deepEqual(f.events, []);
  assert.equal(f.onOpenBrowser.mock.callCount(), 0);
  assert.equal(f.state.busy, false);
});

test("unmounting a process panel while forwarding prevents an abandoned preview from opening", async (t) => {
  const f = await fixture(t);
  await f.mount();
  let resolve;
  harness.dom.window.piBridge.environmentCommand = () =>
    new Promise((done) => {
      resolve = done;
    });
  let opening;
  await act(async () => {
    opening = f.state.openEndpoint(process, process.endpoints[0].url);
  });
  await f.unmount();
  await act(async () => {
    resolve(forward());
    await opening;
  });
  assert.deepEqual(f.tabs, []);
  assert.deepEqual(f.events, []);
  assert.equal(f.onOpenBrowser.mock.callCount(), 0);
});

function previewForwards() {
  return [
    forward({ remotePort: 5173, localPort: 45173, localUrl: "http://127.0.0.1:45173" }),
    forward({ id: "other", environmentId: "remote-b", remotePort: 6006, localPort: 46006 }),
    forward({ id: "stopped", remotePort: 7007, localPort: 47007, status: "stopped" }),
    forward({ id: "reconnecting", remotePort: 8008, localPort: 48008, status: "reconnecting" }),
  ];
}

test("the composer shows clickable active previews only for its current remote environment", async (t) => {
  const f = await fixture(t);
  await f.push({ portForwards: previewForwards() });
  await f.focus();
  await f.render(f.api.ComposerEnvironmentStrip);
  const preview = button(rootEl, ":5173 previewing");
  assert.ok(preview, "the current remote forward must be exposed as a clickable preview pill");
  assert.doesNotMatch(rootEl.textContent, /6006|7007|8008/);
  await click(preview);
  assert.deepEqual(f.tabs, [{ url: "http://127.0.0.1:45173", activate: true }]);
  assert.deepEqual(f.events, [{ tabId: "preview-tab" }]);
  assert.deepEqual(f.commands, []);
  await f.focus("remote-b");
  assert.ok(button(rootEl, ":6006 previewing"));
  assert.doesNotMatch(rootEl.textContent, /5173|7007|8008/);
  await f.focus("primary");
  assert.doesNotMatch(rootEl.textContent, /previewing/);
});

test("the remote browser dock stays enabled and attributes only active forwards to their server and loopback destination", async (t) => {
  const f = await fixture(t);
  await f.push({ portForwards: previewForwards() });
  const state = browserState([{ ...browserTab("preview-tab"), url: "http://127.0.0.1:45173" }]);
  Object.assign(harness.dom.window.piBridge, {
    browserGetState: async () => structuredClone(state),
    onBrowserEvent: () => () => {},
    browserSetSurfaceVisible: async () => {},
    browserSetBounds: async () => {},
  });
  const noop = () => {};
  const props = {
    activeFileTabId: "browser",
    fileTabs: [],
    dispatchFileTab: noop,
    rightPanelOpen: true,
    rightPanelWidth: 520,
    rightPanelBounds: { minWidth: 300, maxWidth: 1000 },
    rightPanelResizing: false,
    onResizeStart: noop,
    onResizeKeyDown: noop,
    managedProcessCount: 0,
    onManagedProcessCountChange: noop,
    managedProcessAttention: false,
    selectedSessionId: null,
    settingsOpen: false,
    browserAuthorizationOpen: false,
    isMobile: false,
    environmentId: "remote-a",
    location: null,
    explorerRefreshKey: 0,
    onRefreshExplorer: noop,
    onOpenFile: noop,
    onAtMention: noop,
    personalCwd: null,
    homeDir: "/home/ubuntu",
  };
  await f.render(f.api.RightPanelDock, props);
  const browser = button(rootEl, "Local preview");
  assert.ok(browser, "a capable remote must expose its local browser preview tab");
  assert.equal(browser.disabled, false);
  assert.equal(browser.getAttribute("aria-pressed"), "true");
  const attribution = getByRole(rootEl, "status", "Forwarded preview");
  assert.match(attribution.textContent, /gpu-a100\s+:5173\s+→\s+127\.0\.0\.1:45173/);
  assert.doesNotMatch(attribution.textContent, /gpu-b200|6006|7007|8008|46006|47007|48008/);
  await f.push({
    portForwards: previewForwards().map((entry) =>
      entry.environmentId === "remote-a" ? { ...entry, status: "stopped" } : entry,
    ),
  });
  assert.equal(byRole(rootEl, "status", "Forwarded preview"), undefined);
  assert.doesNotMatch(rootEl.textContent, /gpu-a100|gpu-b200|46006|47007|48008/);
  await f.render(f.api.RightPanelDock, { ...props, environmentId: "remote-b" });
  const other = getByRole(rootEl, "status", "Forwarded preview");
  assert.match(other.textContent, /gpu-b200\s+:6006\s+→\s+127\.0\.0\.1:46006/);
  assert.doesNotMatch(other.textContent, /gpu-a100|5173|45173|7007|8008/);
});
