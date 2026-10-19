import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  visibleText,
  click,
  waitFor,
  historyRow,
  currentPages,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import {
  dirtySkill,
  answer,
  promptClosed,
  retainedEdit,
  skillListShows,
  openSwitchSpace,
  pickWithConsent,
} from "../support/app-navigation-leave.mjs";
import { initialSkillContent, navigationPaths, savedSkillContent } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

// Three kinds of departure (tab, main page, space) × four answers (save,
// save that fails, cancel, discard). Main page × all four answers and tab ×
// cancel/discard live in app-navigation-resource-leave.test.mjs; this file
// covers the remaining seven combinations.

const refusal = "Fixture refused to save the skill file";

async function personalEditor(t) {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await dirtySkill(scene);
  return scene;
}

async function refusedSaveKeepsEverything(scene) {
  await waitFor(() => assert.match(scene.resourcePanel().textContent, new RegExp(refusal)));
  await promptClosed(scene);
  retainedEdit(scene);
}

test("saving from a dirty tab switch writes the skill, then shows the Plugins tab", async (t) => {
  const scene = await personalEditor(t);
  await click(control(scene.container, "tab", "Plugins"));
  await answer(scene, "Save");
  await waitFor(() => {
    assert.equal(control(scene.container, "tab", "Plugins").getAttribute("aria-selected"), "true");
    visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin");
  });
  assert.equal((await scene.skills()).value, savedSkillContent);
});

test("a failed save from a dirty tab switch keeps the Skills tab, the edit and the reason", async (t) => {
  const scene = await personalEditor(t);
  scene.external.failures.skillSave = refusal;
  await click(control(scene.container, "tab", "Plugins"));
  await answer(scene, "Save");
  await refusedSaveKeepsEverything(scene);
});

test("cancelling a dirty space switch keeps the personal space, its resources and the edit", async (t) => {
  const scene = await personalEditor(t);
  await pickWithConsent(scene, openSwitchSpace(scene), navigationPaths.project, "Cancel");
  await promptClosed(scene);
  retainedEdit(scene);
  await skillListShows(scene, "personal-checklist", ["project-checklist"]);
});

test("discarding a dirty space switch moves to the project without writing the personal skill", async (t) => {
  const scene = await personalEditor(t);
  await pickWithConsent(scene, openSwitchSpace(scene), navigationPaths.project, "Discard");
  await skillListShows(scene, "project-checklist", ["personal-checklist"]);
  control(scene.workspace(), "button", "navigation-project");
  await click(control(await scene.menu("navigation-project"), "menuitem", "Back to personal space"));
  await waitFor(() => control(scene.workspace(), "button", "Personal space"));
  assert.equal((await scene.skills()).value, initialSkillContent);
});

test("saving from a dirty space switch writes the skill of the space being left, then moves to the project", async (t) => {
  const scene = await personalEditor(t);
  await pickWithConsent(scene, openSwitchSpace(scene), navigationPaths.project, "Save");
  await skillListShows(scene, "project-checklist", ["personal-checklist"]);
  control(scene.workspace(), "button", "navigation-project");
  assert.equal((await scene.skills("project-checklist")).value, initialSkillContent, "the project skill is untouched");
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await click(control(await scene.menu("navigation-project"), "menuitem", "Back to personal space"));
  await waitFor(() => control(scene.workspace(), "button", "Personal space"));
  assert.equal((await scene.skills()).value, savedSkillContent, "the save went to the original personal file");
});

test("a failed save from a dirty space switch stays in the personal space with the edit and the reason", async (t) => {
  const scene = await personalEditor(t);
  scene.external.failures.skillSave = refusal;
  await pickWithConsent(scene, openSwitchSpace(scene), navigationPaths.project, "Save", { proceeds: false });
  await refusedSaveKeepsEverything(scene);
  await skillListShows(scene, "personal-checklist", ["project-checklist"]);
});

test("after a refused save, a second save that succeeds completes the originally requested switch", async (t) => {
  const scene = await personalEditor(t);
  scene.external.failures.skillSave = refusal;
  await click(historyRow(scene, "Personal release notes"));
  await answer(scene, "Save");
  await refusedSaveKeepsEverything(scene);
  scene.external.failures.skillSave = null;
  await click(historyRow(scene, "Personal release notes"));
  await answer(scene, "Save");
  await waitFor(() => visibleText(control(scene.container, "region", "Chat"), "Personal conversation marker"));
  assert.deepEqual(currentPages(scene), ["Personal release notes"]);
  assert.equal((await scene.skills()).value, savedSkillContent);
});
