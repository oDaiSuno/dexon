import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  visibleText,
  click,
  input,
  keyDown,
  dom,
  waitFor,
  historyRow,
  currentPages,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { initialSkillContent, savedSkillContent } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

async function dirtyResourceEditor(t) {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  const editor = await scene.skills();
  assert.equal(editor.value, initialSkillContent);
  await input(editor, savedSkillContent);
  return scene;
}

function retainedEdit(scene) {
  assert.equal(control(scene.resourcePanel(), "textbox", "Skill markdown content").value, savedSkillContent);
  assert.equal(control(scene.container, "tab", "Skills").getAttribute("aria-selected"), "true");
  assert.equal(control(scene.navigation(), "button", "Plugins & Skills").getAttribute("aria-current"), "page");
  assert.equal(dom.window.location.search, "?session=personal-history");
}

async function leavePrompt(scene) {
  return waitFor(() => control(scene.container, "dialog", "Unsaved skill changes"));
}

test("Escape cancels a dirty resource-page departure and retains the skill edit and selected conversation", async (t) => {
  const scene = await dirtyResourceEditor(t);
  await click(historyRow(scene, "Personal release notes"));
  const prompt = await leavePrompt(scene);
  await keyDown(control(prompt, "button", "Cancel"), "Escape");
  await waitFor(() => assert.equal(roles(scene.container, "dialog", "Unsaved skill changes").length, 0));
  retainedEdit(scene);
});

test("a dirty resource-tab switch waits for consent: cancel retains the edit and discard switches without saving", async (t) => {
  const scene = await dirtyResourceEditor(t);
  await click(control(scene.container, "tab", "Plugins"));
  await click(control(await leavePrompt(scene), "button", "Cancel"));
  await waitFor(() => assert.equal(roles(scene.container, "dialog", "Unsaved skill changes").length, 0));
  retainedEdit(scene);
  await click(control(scene.container, "tab", "Plugins"));
  await click(control(await leavePrompt(scene), "button", "Discard"));
  await waitFor(() => {
    assert.equal(control(scene.container, "tab", "Plugins").getAttribute("aria-selected"), "true");
    visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin");
  });
  assert.equal(roles(scene.container, "dialog", "Unsaved skill changes").length, 0);
  assert.equal(roles(scene.resourcePanel(), "textbox", "Skill markdown content").length, 0);
  assert.equal((await scene.skills()).value, initialSkillContent);
});

test("saving from the departure prompt writes the skill and then returns to the requested Chat", async (t) => {
  const scene = await dirtyResourceEditor(t);
  await click(historyRow(scene, "Personal release notes"));
  await click(control(await leavePrompt(scene), "button", "Save"));
  await waitFor(() => visibleText(control(scene.container, "region", "Chat"), "Personal conversation marker"));
  assert.deepEqual(currentPages(scene), ["Personal release notes"]);
  assert.equal(dom.window.location.search, "?session=personal-history");
  assert.equal((await scene.skills()).value, savedSkillContent);
});

test("a failed save from the departure prompt keeps the editor, its edit and the resource page", async (t) => {
  const scene = await dirtyResourceEditor(t);
  scene.external.failures.skillSave = "Fixture refused to save the skill file";
  await click(historyRow(scene, "Personal release notes"));
  await click(control(await leavePrompt(scene), "button", "Save"));
  await waitFor(() => assert.match(scene.resourcePanel().textContent, /Fixture refused to save the skill file/));
  retainedEdit(scene);
  assert.equal(roles(scene.container, "heading", "Plugins & Skills").length, 1);
});

test("cancelling a dirty resource departure stays put; discarding returns to the requested Chat without saving", async (t) => {
  const scene = await dirtyResourceEditor(t);
  await click(historyRow(scene, "Personal release notes"));
  await click(control(await leavePrompt(scene), "button", "Cancel"));
  await waitFor(() => assert.equal(roles(scene.container, "dialog", "Unsaved skill changes").length, 0));
  retainedEdit(scene);
  await click(historyRow(scene, "Personal release notes"));
  await click(control(await leavePrompt(scene), "button", "Discard"));
  await waitFor(() => visibleText(control(scene.container, "region", "Chat"), "Personal conversation marker"));
  assert.deepEqual(currentPages(scene), ["Personal release notes"]);
  assert.equal(dom.window.location.search, "?session=personal-history");
  assert.equal(roles(scene.container, "heading", "Plugins & Skills").length, 0);
  assert.equal(roles(scene.container, "dialog", "Unsaved skill changes").length, 0);
  assert.equal((await scene.skills()).value, initialSkillContent);
});
