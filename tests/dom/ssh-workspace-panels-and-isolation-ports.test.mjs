import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
  roles,
  startNavigation,
  visibleText,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import { remoteHostBoundary } from "../support/api-host.mjs";

after(restoreGlobals);

const REMOTE = "ssh://ubuntu@prod-vps/home/ubuntu/work/app";
const SOURCE = "http://localhost:3000/";
const OPEN = "http://127.0.0.1:54321/";
const PREVIEW = "Remote :3000 ⇄ local 127.0.0.1:54321 · Preview ↗";
const MAPPING = "◌ Remote :3000 → opening local tunnel…";
const UNAVAILABLE = "! :3000 tunnel unavailable";

function endpoint(state, extra = {}) {
  return { id: "remote-http", state, sourceUrl: SOURCE, remoteHostLabel: "prod-vps", remotePort: 3000, ...extra };
}

function processInfo(endpointViews, extra = {}) {
  return {
    processId: "ssh-server",
    runId: "ssh-run",
    generation: 1,
    label: "Remote app server",
    kind: "server",
    state: "ready",
    readiness: "ready",
    ownerSessionId: "ssh-ports",
    cwdDisplay: REMOTE,
    workspaceKey: REMOTE,
    commandDisplay: "npm run dev",
    createdAt: 1,
    stdinOpen: false,
    endpoints: [{ id: "remote-http", url: SOURCE, source: "stdout", firstSeenAt: 1, lastSeenAt: 1, runId: "ssh-run" }],
    endpointViews,
    watchdogLeaseMs: 15000,
    networkWarnings: [],
    restartCount: 0,
    output: {
      earliestCursor: "ssh-run:0",
      latestCursor: "ssh-run:0",
      retainedBytes: 0,
      droppedBytes: 0,
      droppedRecords: 0,
    },
    ...extra,
  };
}

async function portScene(t, process) {
  const settings = { history: false, initialSession: "ssh-ports", openProjects: [P.personal, REMOTE] };
  const base = navigationBoundary(settings);
  base.addConversation(startedConversation("ssh-ports", REMOTE, "Preview the running server"));
  let current = process;
  let revision = 1;
  const external = remoteHostBoundary(base, {
    "remote.workspacesSnapshot": { states: {} },
    "skills.list": { skills: [] },
    "processes.list": () => ({ revision, processes: [current] }),
    "processes.read": {
      processId: "ssh-server",
      runId: "ssh-run",
      state: "ready",
      readiness: "ready",
      endpoints: [],
      fromCursor: "ssh-run:0",
      nextCursor: "ssh-run:0",
      earliestCursor: "ssh-run:0",
      records: [],
      truncated: false,
    },
  });
  const scene = await startNavigation(t, settings, external);
  await act(async () => external.menu("open-processes"));
  await waitFor(() => visibleText(scene.container, "Remote app server"));
  await scene.settled();
  return {
    ...scene,
    async replace(next) {
      current = next;
      revision++;
      await act(async () =>
        external.emitProcessesChanged({
          revision,
          processId: current.processId,
          runId: current.runId,
          reason: "state",
        }),
      );
      await scene.settled();
    },
  };
}

test("when a remote port is mapping it explains the handshake and neither the capsule nor process details can open the source URL", async (t) => {
  const scene = await portScene(t, processInfo([endpoint("mapping")]));
  visibleText(scene.container, MAPPING);
  visibleText(scene.container, "SSH tunnel handshake in progress; preview will be available once connected");
  assert.equal(roles(scene.container, "button", MAPPING).length, 0);
  assert.equal(roles(scene.container, "button", "Open in browser").length, 0);
  assert.deepEqual(scene.external.requests("desktop.browserCreateUserTab"), []);
  assert.equal(roles(scene.container, "button", /http:\/\/localhost:3000/).length, 0);
});

test("when an available remote capsule is clicked the browser opens only its shifted local tunnel address and shows its SSH badge", async (t) => {
  const scene = await portScene(
    t,
    processInfo([endpoint("available", { openUrl: OPEN, localPort: 54321, portShifted: true })]),
  );
  visibleText(scene.container, "Local port 3000 was in use; shifted to 127.0.0.1:54321");
  visibleText(scene.container, "15s watchdog attached");
  const preview = control(scene.container, "button", PREVIEW);
  assert.equal(preview.parentElement.closest("button"), null);
  await click(preview);
  await waitFor(() =>
    assert.deepEqual(scene.external.requests("desktop.browserCreateUserTab"), [
      { url: OPEN, ownerSessionId: "ssh-ports", activate: true },
    ]),
  );
  visibleText(scene.container, "SSH tunnel · prod-vps:3000");
  assert.equal(control(scene.container, "textbox", "Browser address").value, OPEN);
  const browserState = await scene.external.bridge.browserGetState();
  const tab = browserState.tabs.find((candidate) => candidate.id === browserState.activeTabId);
  await act(async () => scene.external.browserEvent({ type: "tab-updated", tab: { ...tab, url: `${OPEN}health` } }));
  await scene.settled();
  visibleText(scene.container, "SSH tunnel · prod-vps:3000");
  await act(async () =>
    scene.external.browserEvent({ type: "tab-updated", tab: { ...tab, url: "https://example.com/" } }),
  );
  await scene.settled();
  assert.doesNotMatch(scene.container.textContent, /SSH tunnel · prod-vps:3000/);
});

test("when a remote tunnel is unavailable its reason is visible and the details cannot bypass that state", async (t) => {
  const scene = await portScene(t, processInfo([endpoint("unavailable", { reason: "Remote bind was denied" })]));
  visibleText(scene.container, UNAVAILABLE);
  visibleText(scene.container, "Remote bind was denied");
  assert.equal(roles(scene.container, "button", UNAVAILABLE).length, 0);
  assert.equal(roles(scene.container, "button", "Open in browser").length, 0);
  assert.deepEqual(scene.external.requests("desktop.browserCreateUserTab"), []);
});

test("when an available view has no local address it is not offered as a usable preview", async (t) => {
  const scene = await portScene(t, processInfo([endpoint("available")]));
  visibleText(scene.container, UNAVAILABLE);
  assert.equal(roles(scene.container, "button", /Preview ↗/).length, 0);
  assert.equal(roles(scene.container, "button", "Open in browser").length, 0);
});

test("when one process has several endpoint views every port has its own honest state and only available ports open", async (t) => {
  const scene = await portScene(
    t,
    processInfo([
      endpoint("mapping"),
      endpoint("available", {
        id: "health",
        remotePort: 3001,
        sourceUrl: "http://localhost:3001/",
        localPort: 54322,
        openUrl: "http://127.0.0.1:54322/",
      }),
      endpoint("unavailable", { id: "admin", remotePort: 3002, reason: "Admin listener is closed" }),
    ]),
  );
  visibleText(scene.container, MAPPING);
  visibleText(scene.container, "! :3002 tunnel unavailable");
  visibleText(scene.container, "Admin listener is closed");
  await click(control(scene.container, "button", "Remote :3001 ⇄ local 127.0.0.1:54322 · Preview ↗"));
  await waitFor(() =>
    assert.deepEqual(scene.external.requests("desktop.browserCreateUserTab"), [
      { url: "http://127.0.0.1:54322/", ownerSessionId: "ssh-ports", activate: true },
    ]),
  );
});

test("when process details open the preview they also use only the available local address", async (t) => {
  const scene = await portScene(t, processInfo([endpoint("available", { openUrl: OPEN, localPort: 54321 })]));
  await click(control(scene.container, "button", "Open in browser"));
  await waitFor(() =>
    assert.deepEqual(scene.external.requests("desktop.browserCreateUserTab"), [
      { url: OPEN, ownerSessionId: "ssh-ports", activate: true },
    ]),
  );
});

test("when an active tunnel becomes unavailable its browser badge disappears after the shared process update", async (t) => {
  const scene = await portScene(
    t,
    processInfo([endpoint("available", { remoteHostLabel: undefined, openUrl: OPEN, localPort: 54321 })]),
  );
  await click(control(scene.container, "button", PREVIEW));
  await waitFor(() => visibleText(scene.container, "SSH tunnel · prod-vps:3000"));
  await scene.replace(processInfo([endpoint("unavailable", { reason: "SSH connection closed" })]));
  await waitFor(() => assert.doesNotMatch(scene.container.textContent, /SSH tunnel · prod-vps:3000/));
});

test("when a local process has no endpoint views its original single port pill still opens the local endpoint without an SSH badge", async (t) => {
  const scene = await portScene(t, processInfo(undefined, { workspaceKey: undefined, cwdDisplay: P.project }));
  const ports = roles(scene.container, "button", "Open in browser");
  assert.equal(ports.length, 1);
  await click(ports[0]);
  await waitFor(() =>
    assert.deepEqual(scene.external.requests("desktop.browserCreateUserTab"), [
      { url: SOURCE, ownerSessionId: "ssh-ports", activate: true },
    ]),
  );
  assert.doesNotMatch(scene.container.textContent, /SSH tunnel ·/);
});
