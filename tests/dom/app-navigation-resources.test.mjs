import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  visibleText,
  textBlocks,
  click,
  mouseDown,
  dom,
  waitFor,
  historyRow,
  currentPages,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { reloadedPluginStatus } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

test("the official Resources entry first shows one overview with skills, tool extensions and sources together", async (t) => {
  const scene = await startNavigation(t, { history: false });
  await scene.overview();
  await waitFor(() => visibleText(scene.container, "personal-checklist"));
  visibleText(scene.container, "shared-checklist");
  visibleText(scene.container, "These capabilities come from 2 installed packages");
  assert.equal(roles(scene.container, "tab").length, 0, "the overview is a single page, not tabs");
  assert.deepEqual(currentPages(scene), ["Plugins & Skills"]);
});

test("Manage sources keeps the full plugin manager reachable, and returning to the page shows the overview again", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  const panel = await scene.resources();
  await waitFor(() => visibleText(panel, "npm:personal-navigation-plugin"));
  await click(control(scene.container, "button", "Back to Plugins & Skills"));
  await waitFor(() => control(scene.container, "button", "Manage sources"));
  assert.equal(roles(scene.container, "tabpanel").length, 0);
  await scene.resources();
  await click(historyRow(scene, "Personal release notes"));
  await waitFor(() => visibleText(control(scene.container, "region", "Chat"), "Personal conversation marker"));
  await scene.overview();
  assert.equal(roles(scene.container, "tabpanel").length, 0, "re-entering the page starts from the overview");
});

test("with no history or selected session, the official Resources entry opens personal-space plugins as a main page", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const panel = await scene.resources();
  await waitFor(() => visibleText(panel, "npm:personal-navigation-plugin"));
  visibleText(panel, "npm:shared-navigation-plugin");
  assert.equal(roles(scene.container, "region", "Settings").length, 0);
  assert.deepEqual(
    roles(scene.container, "tab").map((element) => element.textContent.trim()),
    ["Plugins", "Skills"],
  );
  assert.equal(control(scene.container, "tab", "Plugins").getAttribute("aria-selected"), "true");
  assert.deepEqual(currentPages(scene), ["Plugins & Skills"]);
});

test("the Skills tab reached from the official entry reads a personal skill and its file without needing a session", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const preview = await scene.skills();
  await waitFor(() => assert.ok(preview.textContent.includes("Keep the review scoped to the current space.")));
  assert.equal(control(scene.container, "tab", "Skills").getAttribute("aria-selected"), "true");
  visibleText(scene.resourcePanel(), "shared-checklist");
});

test("disabling a plugin from the new resource page remains visible after reloading the application", async (t) => {
  const scene = await startNavigation(t, { history: false });
  await scene.resources();
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin"));
  await click(visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin"));
  await click(control(scene.resourcePanel(), "switch", "Disable package"));
  await waitFor(() => control(scene.resourcePanel(), "switch", "Enable package"));
  const reopened = await scene.reload();
  await reopened.resources();
  await waitFor(() => visibleText(reopened.resourcePanel(), "npm:personal-navigation-plugin"));
  await click(visibleText(reopened.resourcePanel(), "npm:personal-navigation-plugin"));
  assert.equal(control(reopened.resourcePanel(), "switch", "Enable package").getAttribute("aria-checked"), "false");
});

test("explicit plugin reload from Resources refreshes the same conversation when returning to Chat", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  assert.equal(control(scene.container, "region", "Chat").textContent.includes(reloadedPluginStatus), false);
  await scene.resources();
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin"));
  await click(visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin"));
  const reload = control(scene.resourcePanel(), "button", "Reload session");
  assert.equal(reload.disabled, false, "Resources retains the selected session as the reload target");
  await click(reload);
  await waitFor(() => visibleText(scene.resourcePanel(), "Session reloaded."));
  await click(historyRow(scene, "Personal release notes"));
  const chat = await waitFor(() => control(scene.container, "region", "Chat"));
  await waitFor(() => visibleText(chat, reloadedPluginStatus));
  visibleText(chat, "Personal conversation marker");
  assert.equal(dom.window.location.search, "?session=personal-history");
  assert.deepEqual(currentPages(scene), ["Personal release notes"]);
});

for (const [language, unsettled, obsoleteGuidance] of [
  [
    "en-US",
    /Loading skills|Failed to load skills/i,
    /\b(?:install|add|manage)\b[^.!?]*\bSettings\b|\bSettings\b[^.!?]*\b(?:install|add|manage)\b/i,
  ],
  ["zh-CN", /正在加载技能|技能列表加载失败/, /设置[^。！？]*(?:安装|添加|管理)|(?:安装|添加|管理)[^。！？]*设置/],
]) {
  test(`the ${language} empty skill picker no longer sends users to Settings to install skills`, async (t) => {
    const scene = await startNavigation(t, { language, emptySkills: true, initialSession: "personal-history" });
    await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
    await click(control(scene.container, "button", scene.labels.attach));
    await mouseDown(control(scene.container, "menuitem", scene.labels.skillAction));
    const picker = await waitFor(() => control(scene.container, "menu", scene.labels.skillPicker));
    await waitFor(() => {
      assert.ok(picker.textContent.trim(), "an empty skill list still provides visible guidance");
      assert.doesNotMatch(picker.textContent, unsettled);
    });
    assert.equal(roles(picker, "menuitem").length, 0);
    assert.deepEqual(
      textBlocks(picker).filter((block) => obsoleteGuidance.test(block)),
      [],
    );
  });
}

test("Open in editor from Manage sources hands the skill file to the desktop's default editor", async (t) => {
  const scene = await startNavigation(t, { history: false });
  await scene.skills();
  await click(control(scene.resourcePanel(), "button", "Open in editor"));
  assert.deepEqual(scene.external.desktop.openedFiles, [
    "/Users/navigation-fixture/.dexon/.pi/skills/personal-checklist/SKILL.md",
  ]);
  assert.equal(roles(scene.resourcePanel(), "button", "Save changes").length, 0);
});
