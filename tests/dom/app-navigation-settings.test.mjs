import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  textBlocks,
  click,
  act,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { remainingSettings } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

function expectSixTabs(dialog) {
  assert.deepEqual(
    roles(dialog, "tab")
      .map((element) => element.textContent.trim())
      .sort(),
    [...remainingSettings].sort(),
  );
}

test("Settings opened from the new navigation contains only the six non-resource categories", async (t) => {
  const scene = await startNavigation(t, { history: false });
  expectSixTabs(await scene.settings());
});

for (const [language, obsoleteGuidance] of [
  ["en-US", /\b(?:manage|configure)\b[^.!?]*\b(?:skills|plugins)\b/i],
  ["zh-CN", /管理[^。！？]*(?:技能|插件)/],
]) {
  test(`the ${language} Settings introduction no longer claims to manage plugins or skills`, async (t) => {
    const scene = await startNavigation(t, { history: false, language });
    const dialog = await scene.desktopMenu("settings");
    assert.deepEqual(
      textBlocks(dialog).filter((block) => obsoleteGuidance.test(block)),
      [],
    );
  });
}

for (const [command, selected] of [
  ["settings", "General"],
  ["check-for-updates", "About"],
  ["show-update", "About"],
]) {
  test(`the desktop ${command} entry opens ${selected} in the migrated six-category Settings`, async (t) => {
    const scene = await startNavigation(t, { history: false });
    const dialog = await scene.desktopMenu(command);
    assert.equal(control(dialog, "tab", selected).getAttribute("aria-selected"), "true");
    expectSixTabs(dialog);
  });
}

// These existing behaviors must stay green while the two resource tabs move.
// Distinct visible contents detect a tab that changes selection but not page.
for (const [tab, content] of [
  ["General", /Interface language/],
  ["Browser", /Enable built-in Browser/],
  ["Channels", /Messaging channels/],
  ["Models", /Add provider/],
  ["Developer Tools", /JavaScript/],
  ["About", /Application information/],
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
  await click(control(scene.container, "button", "Manage permanent permission…"));
  const dialog = await waitFor(() => control(scene.container, "dialog", "Settings"));
  assert.equal(control(dialog, "tab", "Browser").getAttribute("aria-selected"), "true");
  await waitFor(() => assert.match(control(dialog, "tabpanel").textContent, /Enable built-in Browser/));
  expectSixTabs(dialog);
});
