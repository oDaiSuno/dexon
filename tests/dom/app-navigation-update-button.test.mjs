import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  visibleText,
  click,
  act,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";

after(restoreGlobals);

const upToDate = {
  phase: "up-to-date",
  currentVersion: "0.1.0",
  automaticChecksEnabled: true,
  installBlockedByActiveSessions: false,
  canRetry: false,
};
const available = { ...upToDate, phase: "available", availableVersion: "0.2.0", total: 102_760_448 };

function desktopUpdates() {
  const external = navigationBoundary({ history: false });
  const listeners = new Set();
  external.bridge.getUpdateState = async () => ({ ...upToDate });
  external.bridge.onUpdateState = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const push = (state) => act(async () => listeners.forEach((listener) => listener({ ...state })));
  return { external, push };
}

const updateButtonCount = (scene) =>
  roles(scene.navigation(), "button", "Update available").length +
  roles(scene.navigation(), "button", "Check for updates").length;

test("the sidebar offers an update button only while an update is available, and it leads to About", async (t) => {
  const { external, push } = desktopUpdates();
  const scene = await startNavigation(t, { history: false }, external);
  await scene.settled();
  visibleText(scene.navigation(), "v0.1.0");
  assert.equal(updateButtonCount(scene), 0, "no update button while the app is up to date");

  await push(available);
  await waitFor(() => control(scene.navigation(), "button", "Update available"));
  visibleText(scene.navigation(), "v0.1.0");

  await push({ ...available, phase: "downloaded", percent: 100 });
  await waitFor(() => control(scene.navigation(), "button", "Update available"));

  await push(upToDate);
  await waitFor(() => assert.equal(updateButtonCount(scene), 0, "the button leaves once nothing is pending"));

  await push(available);
  await click(await waitFor(() => control(scene.navigation(), "button", "Update available")));
  const settings = await waitFor(() => control(scene.container, "region", "Settings"));
  assert.equal(control(settings, "tab", "About").getAttribute("aria-selected"), "true");
});
