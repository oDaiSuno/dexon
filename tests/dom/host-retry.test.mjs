import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, byRole, click, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";

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
