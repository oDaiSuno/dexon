import assert from "node:assert/strict";
import { control, roles, input, click, dom, waitFor, pathChoice } from "./app-navigation.mjs";
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

export const openSwitchSpace = (scene, from) => async () =>
  click(control(await scene.menu(from), "menuitem", "Switch space…"));

// A space change may ask before or after the user picks the folder. Both
// orders are acceptable; what matters is that nothing changes until consent.
// When the prompt comes first, the folder is picked only if the answer lets
// the departure go ahead: Cancel and a refused save keep the user in place.
export async function pickWithConsent(scene, openChoices, path, choice, { proceeds = choice !== "Cancel" } = {}) {
  await openChoices();
  const first = await waitFor(() => {
    if (roles(scene.container, "dialog", PROMPT).length) return "prompt";
    pathChoice(scene.container, path);
    return "choice";
  });
  if (first === "choice") {
    await click(pathChoice(scene.container, path));
    await answer(scene, choice);
    return;
  }
  await answer(scene, choice);
  if (proceeds) await click(await waitFor(() => pathChoice(scene.container, path)));
}

// Moves to another space without any unsaved work in the way.
export async function switchSpace(scene, path, from) {
  await openSwitchSpace(scene, from)();
  await click(await waitFor(() => pathChoice(scene.container, path)));
}
