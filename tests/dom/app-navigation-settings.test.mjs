import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  textBlocks,
  click,
  keyDown,
  act,
  dom,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { accessibleName } from "../support/dom-queries.mjs";
import { navigationLabels, remainingSettings, remainingSettingsZhCN } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

function expectSettingsTabs(dialog, expected = remainingSettings) {
  assert.deepEqual(
    roles(dialog, "tab")
      .map((element) => element.textContent.trim())
      .sort(),
    [...expected].sort(),
  );
}

function selectedTab(dialog) {
  const selected = roles(dialog, "tab").filter((tab) => tab.getAttribute("aria-selected") === "true");
  assert.equal(selected.length, 1, "exactly one Settings category is selected");
  return selected[0];
}

// Presses a key where a keyboard user is: on the selected category. Focus must
// follow the new selection and the page shown must be the one it names.
async function pressOnSelected(dialog, key) {
  await keyDown(selectedTab(dialog), key);
  return waitFor(() => {
    const tab = selectedTab(dialog);
    assert.equal(dialog.ownerDocument.activeElement, tab, "focus follows the selected category");
    assert.equal(accessibleName(control(dialog, "tabpanel")), accessibleName(tab), "the page belongs to the category");
    return accessibleName(tab);
  });
}

test("Settings opened from the new navigation contains only the five design categories", async (t) => {
  const scene = await startNavigation(t, { history: false });
  expectSettingsTabs(await scene.settings());
});

test("the zh-CN Settings shows the same five categories under their Chinese names", async (t) => {
  const scene = await startNavigation(t, { history: false, language: "zh-CN" });
  expectSettingsTabs(await scene.settings(), remainingSettingsZhCN);
});

test("the collapsed navigation's Settings icon opens the same five categories", async (t) => {
  const scene = await startNavigation(t, { history: false });
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  expectSettingsTabs(await scene.settings());
});

test("pressing ArrowDown in Settings visits exactly the five categories and wraps back to the first", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const dialog = await scene.settings();
  const start = accessibleName(selectedTab(dialog));
  const visited = [start];
  for (let step = 0; step < remainingSettings.length; step++) visited.push(await pressOnSelected(dialog, "ArrowDown"));
  assert.equal(visited.at(-1), start, "the fifth press returns to where the cycle began");
  assert.deepEqual(visited.slice(0, -1).sort(), [...remainingSettings].sort());
});

test("from the first Settings category, four ArrowDown presses reach the category End jumps to, and ArrowUp wraps back to it", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const dialog = await scene.settings();
  const last = await pressOnSelected(dialog, "End");
  const first = await pressOnSelected(dialog, "Home");
  let reached = first;
  for (let step = 0; step < remainingSettings.length - 1; step++) reached = await pressOnSelected(dialog, "ArrowDown");
  assert.equal(reached, last, "the list between the two ends holds exactly five categories");
  await pressOnSelected(dialog, "Home");
  assert.equal(await pressOnSelected(dialog, "ArrowUp"), last, "moving before the first category wraps to the last");
});

test("Escape closes the five-category Settings without asking and returns focus to the Settings entry", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const entry = control(scene.navigation(), "button", "Settings");
  entry.focus();
  await click(entry);
  const dialog = await waitFor(() => control(scene.container, "region", "Settings"));
  await keyDown(selectedTab(dialog), "Escape");
  await waitFor(() => assert.equal(roles(scene.container, "region", "Settings").length, 0));
  assert.equal(roles(scene.container, "dialog", "Unsaved skill changes").length, 0);
  const focused = dom.window.document.activeElement;
  assert.ok(scene.navigation().contains(focused), "focus is back in the navigation");
  assert.equal(accessibleName(focused), "Settings");
});

// Any Settings text that still mentions plugins or skills must point to the
// new entry; dropping a verb from the old sentence is not enough to pass.
for (const [language, mentionsResources] of [
  ["en-US", /\b(?:skills?|plugins?)\b/i],
  ["zh-CN", /技能|插件/],
]) {
  test(`the ${language} Settings text no longer presents plugins or skills as managed here`, async (t) => {
    const scene = await startNavigation(t, { history: false, language });
    const dialog = await scene.desktopMenu("settings");
    const newEntry = navigationLabels[language].resources;
    assert.deepEqual(
      textBlocks(dialog).filter((block) => mentionsResources.test(block) && !block.includes(newEntry)),
      [],
    );
  });
}

for (const [command, selected] of [
  ["settings", "General"],
  ["check-for-updates", "About"],
  ["show-update", "About"],
]) {
  test(`the desktop ${command} entry opens ${selected} in the migrated five-category Settings`, async (t) => {
    const scene = await startNavigation(t, { history: false });
    const dialog = await scene.desktopMenu(command);
    assert.equal(control(dialog, "tab", selected).getAttribute("aria-selected"), "true");
    expectSettingsTabs(dialog);
  });
}

// These existing behaviors must stay green while the two resource tabs move.
// Distinct visible contents detect a tab that changes selection but not page.
for (const [tab, content] of [
  ["General", /Interface language/],
  ["Browser", /Enable built-in Browser/],
  ["Models", /Add provider/],
  ["Developer Tools", /JavaScript/],
  ["About", /Software update/],
]) {
  test(`the retained ${tab} category still opens its actual configuration through the real application`, async (t) => {
    const scene = await startNavigation(t, { history: false });
    const dialog = await scene.desktopMenu("settings");
    await click(control(dialog, "tab", tab));
    await waitFor(() => {
      assert.equal(control(dialog, "tab", tab).getAttribute("aria-selected"), "true");
      assert.match(control(dialog, "tabpanel").textContent, content);
    });
  });
}

test("Remote chat is not a Settings category and opens its real configuration from Plugins & Skills", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const settings = await scene.settings();
  assert.equal(roles(settings, "tab", "Remote chat").length, 0);
  await click(control(scene.navigation(), "button", "Plugins & Skills"));
  await click(await waitFor(() => control(scene.container, "button", "Remote chat")));
  const remote = await waitFor(() => control(scene.container, "region", "Remote chat"));
  await waitFor(() => assert.match(remote.textContent, /Messaging channels/));
  assert.equal(roles(scene.container, "region", "Settings").length, 0);
  await keyDown(remote, "Escape");
  await waitFor(() => assert.equal(roles(scene.container, "region", "Remote chat").length, 0));
});

test("Manage permanent permission from a browser authorization request still reaches Browser in migrated Settings", async (t) => {
  const scene = await startNavigation(t, { history: false });
  await act(async () =>
    scene.external.browserEvent({
      type: "agent-authorization-request",
      request: {
        id: "navigation-browser-permission",
        sessionId: "personal-history",
        source: "local",
        minimumPermission: "read",
        createdAt: 1,
        expiresAt: 30001,
      },
    }),
  );
  await click(control(scene.container, "button", "Manage permanent permissions"));
  const dialog = await waitFor(() => control(scene.container, "region", "Settings"));
  assert.equal(control(dialog, "tab", "Browser").getAttribute("aria-selected"), "true");
  await waitFor(() => assert.match(control(dialog, "tabpanel").textContent, /Enable built-in Browser/));
  expectSettingsTabs(dialog);
});
