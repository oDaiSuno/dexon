import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import { act, dom, byRole, click, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { control } from "../support/app-navigation.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";

const api = await loadRenderer("host-retry-app", 'export {App} from "./src/renderer/App.tsx";');
after(restoreGlobals);

const CARD = "Cannot connect to Agent Host";
const RETRY = "Retry";
const BOOT_TIMEOUT = 10_000;

async function crashedApp(t, restart) {
  dom.window.localStorage.clear();
  dom.window.history.replaceState(null, "", "/");
  api.setAppLanguage("en-US");
  const host = { status: "crashed" };
  const external = navigationBoundary({ history: false });
  external.bridge.getHostStatus = async () => host.status;
  external.bridge.restartHost = () => restart(host);
  const boundary = installRendererApi(dom.window, api, () => external.host, { bridge: external.bridge });
  const view = await mount(t, api.App, {}, { release: boundary.close });
  t.after(() => external.releaseHolds());
  const card = () => byRole(view.container, "heading", CARD);
  await waitFor(() => assert.ok(card(), "the card says the Agent Host cannot be reached"));
  return { view, card, retry: () => click(byRole(view.container, "button", RETRY)) };
}

test("when the Agent Host has crashed, pressing Retry restarts it and opens the app", async (t) => {
  const scene = await crashedApp(t, async (host) => {
    host.status = "ready";
  });
  await scene.retry();
  await waitFor(() => assert.ok(byRole(scene.view.container, "button", "Show file panel"), "the app opened"), {
    timeout: BOOT_TIMEOUT,
  });
  assert.equal(scene.card(), undefined, "the connection card is gone");
});

test("when restarting the Agent Host is refused, Retry keeps the card and shows why", async (t) => {
  const reason = "Managed process cleanup blocked Host restart (JOURNAL_INVALID)";
  const scene = await crashedApp(t, async () => {
    throw new Error(reason);
  });
  await scene.retry();
  await waitFor(
    () => assert.ok(scene.view.container.textContent.includes(reason), "the card says why the restart was refused"),
    { timeout: BOOT_TIMEOUT },
  );
  assert.ok(scene.card(), "the card still says the Agent Host cannot be reached");
});

test("when the Agent Host restarts, the mounted app stays in place while RPC reconnects", async (t) => {
  dom.window.localStorage.clear();
  dom.window.history.replaceState(null, "", "/");
  api.setAppLanguage("en-US");
  const external = navigationBoundary({ history: false });
  t.after(() => external.releaseHolds());
  const restartHandlers = new Set();
  const reconnected = createDeferred();
  let reconnecting = false;
  external.bridge.getHostStatus = () => (reconnecting ? reconnected.promise : Promise.resolve("ready"));
  external.bridge.onHostRestarted = (handler) => {
    restartHandlers.add(handler);
    return () => restartHandlers.delete(handler);
  };
  const installBoundary = () => installRendererApi(dom.window, api, () => external.host, { bridge: external.bridge });
  let boundary = installBoundary();
  const view = await mount(t, api.App, {}, { release: () => boundary.close() });
  const filePanelButton = () => byRole(view.container, "button", "Show file panel");
  await waitFor(() => assert.ok(filePanelButton(), "the app has mounted"), { timeout: BOOT_TIMEOUT });
  const originalButton = filePanelButton();

  reconnecting = true;
  boundary.close();
  boundary = installBoundary();
  try {
    await act(async () => {
      for (const handler of [...restartHandlers]) handler({ reason: "crash-recovery" });
    });
    assert.ok(filePanelButton() === originalButton, "the existing app DOM remains mounted during reconnect");
    assert.equal(originalButton.isConnected, true);
    assert.equal(view.container.textContent.includes("reconnecting"), false, "no reconnect placeholder replaces it");
  } finally {
    await act(async () => reconnected.resolve("ready"));
  }
  await waitFor(() => assert.ok(filePanelButton() === originalButton, "reconnection keeps the same app DOM"), {
    timeout: BOOT_TIMEOUT,
  });
});

test("when the Agent Host crashes after boot, the conversation, draft and localized restart banner stay mounted", async (t) => {
  dom.window.localStorage.clear();
  dom.window.history.replaceState(null, "", "/?session=crash-session");
  api.setAppLanguage("zh-CN");
  const primary = navigationBoundary({ history: false, lastSpaceCwd: P.project, openProjects: [P.project] });
  primary.addConversation(startedConversation("crash-session", P.project, "Conversation before crash marker"));
  const statusListeners = new Set();
  const crashListeners = new Set();
  let hostStatus = "ready";
  const boundary = installRendererApi(dom.window, api, () => primary.host, {
    bridge: {
      ...primary.bridge,
      getHostStatus: async () => hostStatus,
      onHostStatus(listener) {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
      onHostCrashed(listener) {
        crashListeners.add(listener);
        return () => crashListeners.delete(listener);
      },
      restartHost: async () => {},
    },
  });
  t.after(() => primary.releaseHolds());
  const view = await mount(t, api.App, {}, { release: boundary.close });
  await waitFor(() => assert.match(view.container.textContent, /Conversation before crash marker/), {
    timeout: BOOT_TIMEOUT,
  });
  const editor = await waitFor(() => control(control(view.container, "group", "消息输入"), "textbox"));
  await act(async () => {
    editor.textContent = "unsent draft before crash";
    editor.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  hostStatus = "crashed";
  const detail = "Host exited (code 1) and restart budget exhausted";
  await act(async () => {
    for (const listener of [...statusListeners]) listener({ status: "crashed", detail });
    for (const listener of [...crashListeners]) listener({ detail });
  });
  assert.match(view.container.textContent, /Conversation before crash marker/);
  assert.ok(view.container.textContent.includes("unsent draft before crash"));
  assert.ok(view.container.textContent.includes("立即重启"));
  assert.equal(byRole(view.container, "heading", CARD), undefined);
});
