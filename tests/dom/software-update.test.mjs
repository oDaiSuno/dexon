import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import { dom, act, click, loadRenderer, mount, restoreGlobals, settle } from "../support/renderer.mjs";
const { AboutSettings } = await loadRenderer(
  "software-update-behavior",
  'export {AboutSettings} from "./src/renderer/components/settings/about-settings.tsx";',
);
after(restoreGlobals);
const state = { phase: "idle", currentVersion: "0.1.0", automaticChecksEnabled: false };

// Specification: the service's accepted setting, not the user's proposal,
// determines the checkbox. While saving it is unavailable; failure is visible.
test("an automatic-update change waits for and displays the accepted service setting", async (t) => {
  const pending = createDeferred();
  dom.window.piBridge = {
    onUpdateState: () => () => {},
    getUpdateState: async () => state,
    setAutomaticUpdateChecks: () => pending.promise,
  };
  const view = await mount(t, AboutSettings, { onClose() {} });
  const checkbox = view.container.querySelector('input[type="checkbox"]');
  assert.equal(checkbox.checked, false);
  await click(checkbox);
  assert.equal(checkbox.disabled, true);
  await act(async () => pending.resolve({ ...state, automaticChecksEnabled: false }));
  assert.equal(checkbox.checked, false, "the service rejected the proposed enabled value");
  assert.equal(checkbox.disabled, false);
});

test("a failed automatic-update change retains the previous value and offers retry feedback", async (t) => {
  dom.window.piBridge = {
    onUpdateState: () => () => {},
    getUpdateState: async () => state,
    setAutomaticUpdateChecks: async () => {
      throw new Error("disk unavailable");
    },
  };
  const view = await mount(t, AboutSettings, { onClose() {} });
  await click(view.container.querySelector('input[type="checkbox"]'));
  await settle();
  assert.equal(view.container.querySelector('input[type="checkbox"]').checked, false);
  assert.match(view.container.querySelector('[role="alert"]').textContent, /could not be completed/);
});
