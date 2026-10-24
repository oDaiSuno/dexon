import assert from "node:assert/strict";
import { control, roles, input, click, dom, waitFor } from "./app-navigation.mjs";
import { savedSkillContent } from "../fixtures/app-navigation-data.mjs";

const PROMPT = "Unsaved skill changes";
const SKILL_CONTENT = "Skill markdown content";

// Opens a skill from the official resource page and types a hand-written edit
// into its visible editor, so every departure below starts from unsaved work.
export async function dirtySkill(scene, name = "personal-checklist") {
  const editor = await scene.skills(name);
  await input(editor, savedSkillContent);
  return editor;
}

export function leavePrompt(scene) {
  return waitFor(() => control(scene.container, "dialog", PROMPT));
}

export async function answer(scene, choice) {
  await click(control(await leavePrompt(scene), "button", choice));
}

export async function promptClosed(scene) {
  await waitFor(() => assert.equal(roles(scene.container, "dialog", PROMPT).length, 0));
}

export function noPrompt(scene) {
  assert.equal(roles(scene.container, "dialog", PROMPT).length, 0, "no unsaved-changes prompt is shown");
}

// The user is still exactly where the departure started: same edit, same
// tab, same main page, same space and same conversation address.
export function retainedEdit(scene, { space = "Personal space", search = "?session=personal-history" } = {}) {
  assert.equal(control(scene.resourcePanel(), "textbox", SKILL_CONTENT).value, savedSkillContent);
  assert.equal(control(scene.container, "tab", "Skills").getAttribute("aria-selected"), "true");
  assert.equal(control(scene.navigation(), "button", "Plugins & Skills").getAttribute("aria-current"), "page");
  control(scene.workspace(), "button", space);
  assert.equal(dom.window.location.search, search);
}

export const chatRegion = (scene) => control(scene.container, "region", "Chat");

export async function skillListShows(scene, name, absent = []) {
  await waitFor(() => assert.ok(scene.resourcePanel().textContent.includes(name), `${name} is listed`));
  for (const other of absent)
    assert.ok(!scene.resourcePanel().textContent.includes(other), `${other} is not in this space`);
}

export const ADD_FROM_FOLDER = "Add project space from folder…";

// A space change made from the project card: the user picks the folder in the
// desktop's folder dialog, then the App asks before leaving unsaved work.
export const openSwitchSpace = (scene, from) => async () =>
  click(control(await scene.menu(from), "menuitem", ADD_FROM_FOLDER));

export async function pickWithConsent(scene, openChoices, path, choice) {
  scene.external.desktop.selectedDirectory = path;
  await openChoices();
  await answer(scene, choice);
}

// Moves to another space without any unsaved work in the way.
export async function switchSpace(scene, path, from) {
  scene.external.desktop.selectedDirectory = path;
  await openSwitchSpace(scene, from)();
}
