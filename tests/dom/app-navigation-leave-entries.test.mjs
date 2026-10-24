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
  act,
  dom,
  waitFor,
  historyRow,
  currentPages,
  menuAction,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import {
  dirtySkill,
  answer,
  promptClosed,
  noPrompt,
  retainedEdit,
  chatRegion,
  skillListShows,
  openSwitchSpace,
  pickWithConsent,
} from "../support/app-navigation-leave.mjs";
import {
  createdWorktreeBranch,
  initialSkillContent,
  navigationPaths,
  savedSkillContent,
} from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

// Every entry below is a different way to leave a dirty skill editor. Each one
// must first ask; Cancel must leave the user exactly where they were, and
// Discard must then carry out the original request without writing the file.

async function personalEditor(t) {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await dirtySkill(scene);
  return scene;
}

async function cancelThenRetry(scene, depart, retained = {}) {
  await depart();
  await answer(scene, "Cancel");
  await promptClosed(scene);
  retainedEdit(scene, retained);
  await depart();
  await answer(scene, "Discard");
  await promptClosed(scene);
}

async function personalFileUnchanged(scene) {
  assert.equal((await scene.skills()).value, initialSkillContent, "discarding did not write the skill file");
}

test("choosing another conversation in history while a skill edit is unsaved asks first, and discarding opens that conversation", async (t) => {
  const scene = await personalEditor(t);
  await cancelThenRetry(scene, () => click(control(scene.history(), "button", "Another personal conversation")));
  await waitFor(() => visibleText(chatRegion(scene), "Other conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-other");
  assert.deepEqual(currentPages(scene), ["Another personal conversation"]);
  await personalFileUnchanged(scene);
});

test("choosing the already open conversation in history while a skill edit is unsaved asks first, and discarding returns to it", async (t) => {
  const scene = await personalEditor(t);
  await cancelThenRetry(scene, () => click(control(scene.history(), "button", "Personal release notes")));
  await waitFor(() => visibleText(chatRegion(scene), "Personal conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-history");
  assert.deepEqual(currentPages(scene), ["Personal release notes"]);
  await personalFileUnchanged(scene);
});

test("starting a new session from the main navigation while a skill edit is unsaved asks first, and discarding shows an empty chat", async (t) => {
  const scene = await personalEditor(t);
  await cancelThenRetry(scene, () => click(control(scene.navigation(), "button", scene.labels.newSession)));
  await waitFor(() => control(scene.container, "group", "Message input"));
  assert.doesNotMatch(chatRegion(scene).textContent, /Personal conversation marker/);
  assert.equal(dom.window.location.search, "");
  await personalFileUnchanged(scene);
});

test("collapsing the sidebar keeps the unsaved edit, and the rail's New session still asks before leaving", async (t) => {
  const scene = await personalEditor(t);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  noPrompt(scene);
  assert.equal(control(scene.resourcePanel(), "textbox", "Skill markdown content").value, savedSkillContent);
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await answer(scene, "Cancel");
  await promptClosed(scene);
  assert.equal(control(scene.resourcePanel(), "textbox", "Skill markdown content").value, savedSkillContent);
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await answer(scene, "Discard");
  await waitFor(() => control(scene.container, "group", "Message input"));
  assert.equal(dom.window.location.search, "");
  await click(control(scene.navigation(), "button", "Show sidebar"));
  await personalFileUnchanged(scene);
});

test("the desktop New Session command does not bypass the unsaved-changes prompt", async (t) => {
  const scene = await personalEditor(t);
  await cancelThenRetry(scene, () => act(async () => scene.external.menu("new-session")));
  await waitFor(() => control(scene.container, "group", "Message input"));
  assert.doesNotMatch(chatRegion(scene).textContent, /Personal conversation marker/);
  await personalFileUnchanged(scene);
});

test("a session link does not bypass the unsaved-changes prompt, and discarding opens the linked conversation", async (t) => {
  const scene = await personalEditor(t);
  await cancelThenRetry(scene, () => act(async () => scene.external.deepLink("personal-other")));
  await waitFor(() => visibleText(chatRegion(scene), "Other conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-other");
  await personalFileUnchanged(scene);
});

test("actions that stay on the resource page do not ask and keep the unsaved edit", async (t) => {
  const scene = await personalEditor(t);
  await click(control(scene.navigation(), "button", "Plugins & Skills"));
  noPrompt(scene);
  await click(control(await scene.menu(), "menuitem", "Open current folder"));
  await waitFor(() => assert.equal(scene.external.desktop.openedDirectory, navigationPaths.personal));
  noPrompt(scene);
  await act(async () => scene.external.menu("switch-session"));
  noPrompt(scene);
  const settings = await scene.settings();
  noPrompt(scene);
  await click(control(settings, "button", "Back to session"));
  await waitFor(() => assert.equal(roles(scene.container, "region", "Settings").length, 0));
  noPrompt(scene);
  retainedEdit(scene);
});

test("leaving an opened but unchanged skill, or one edited back to its saved text, does not ask", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await scene.skills();
  await click(historyRow(scene, "Personal release notes"));
  await waitFor(() => visibleText(chatRegion(scene), "Personal conversation marker"));
  noPrompt(scene);
  const editor = await dirtySkill(scene);
  await input(editor, initialSkillContent);
  await click(historyRow(scene, "Personal release notes"));
  await waitFor(() => visibleText(chatRegion(scene), "Personal conversation marker"));
  noPrompt(scene);
});

test("with an unsaved skill edit, reloading or closing the window is blocked; after saving it no longer is", async (t) => {
  const scene = await personalEditor(t);
  const unload = () => {
    const event = new dom.window.Event("beforeunload", { cancelable: true });
    dom.window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(unload(), true, "the unsaved edit protects against an accidental reload");
  await click(control(scene.resourcePanel(), "button", "Save changes"));
  await waitFor(() => assert.equal(unload(), false, "a saved editor no longer blocks reloading"));
});

test("switching space from the menu with an unsaved skill edit asks first; discarding moves resources to the chosen project", async (t) => {
  const scene = await personalEditor(t);
  await pickWithConsent(scene, openSwitchSpace(scene), navigationPaths.project, "Cancel");
  await promptClosed(scene);
  retainedEdit(scene);
  await pickWithConsent(scene, openSwitchSpace(scene), navigationPaths.project, "Discard");
  await skillListShows(scene, "project-checklist", ["personal-checklist"]);
  control(scene.workspace(), "button", "navigation-project");
});

test("choosing another folder with an unsaved skill edit asks first; discarding moves resources to that folder", async (t) => {
  const scene = await personalEditor(t);
  scene.external.desktop.selectedDirectory = navigationPaths.project;
  const choose = async () => click(control(await scene.menu(), "menuitem", "Choose another folder…"));
  await choose();
  await answer(scene, "Cancel");
  await promptClosed(scene);
  retainedEdit(scene);
  await skillListShows(scene, "personal-checklist", ["project-checklist"]);
  await choose();
  await answer(scene, "Discard");
  await skillListShows(scene, "project-checklist", ["personal-checklist"]);
  control(scene.workspace(), "button", "navigation-project");
});

test("returning to personal space with an unsaved project skill edit asks first; discarding restores personal resources", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await dirtySkill(scene, "project-checklist");
  const back = async () => click(control(await scene.menu("navigation-project"), "menuitem", "Back to personal space"));
  await back();
  await answer(scene, "Cancel");
  await promptClosed(scene);
  retainedEdit(scene, { space: "navigation-project", search: "" });
  await skillListShows(scene, "project-checklist", ["personal-checklist"]);
  await back();
  await answer(scene, "Discard");
  await skillListShows(scene, "personal-checklist", ["project-checklist"]);
  control(scene.workspace(), "button", "Personal space");
});

function worktreeSwitcher(scene) {
  const found = roles(scene.container, "button").filter((item) => item.title.startsWith("Switch worktree:"));
  assert.equal(found.length, 1);
  return found[0];
}

async function requestNewWorktree(scene) {
  await click(await waitFor(() => worktreeSwitcher(scene)));
  await click(await waitFor(() => menuAction(scene.container, "New worktree…")));
  const branch = await waitFor(() => {
    const fields = roles(scene.container, "textbox").filter((element) => element.placeholder === "branch name");
    assert.equal(fields.length, 1, "Expected one visible branch name field");
    return fields[0];
  });
  await input(branch, createdWorktreeBranch);
  await keyDown(branch, "Enter");
}

async function projectEditor(t) {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await dirtySkill(scene, "project-checklist");
  return scene;
}

test("after discarding an unsaved project skill edit, creating a worktree from the composer footer scopes resources to the new checkout and the file stays unwritten", async (t) => {
  const scene = await projectEditor(t);
  await click(control(scene.history(), "button", "Project release notes"));
  await answer(scene, "Discard");
  await promptClosed(scene);
  await waitFor(() => visibleText(chatRegion(scene), "Project conversation marker"));
  await requestNewWorktree(scene);
  await waitFor(() =>
    assert.equal(worktreeSwitcher(scene).title, `Switch worktree: ${navigationPaths.createdWorktree}`),
  );
  await scene.resources();
  await click(control(scene.container, "tab", "Skills"));
  await skillListShows(scene, "shared-checklist", ["project-checklist"]);
  assert.equal(scene.external.skillWrites(), 0, "discarding did not write the skill file");
});

test("opening a history conversation from another worktree with an unsaved edit asks first, and discarding aligns resources to it", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await dirtySkill(scene, "project-checklist");
  await click(control(scene.history(), "button", "Review branch notes"));
  await answer(scene, "Cancel");
  await promptClosed(scene);
  retainedEdit(scene, { space: "navigation-project", search: "" });
  await click(control(scene.history(), "button", "Review branch notes"));
  await answer(scene, "Discard");
  await waitFor(() => visibleText(chatRegion(scene), "Review conversation marker"));
  await scene.resources();
  await click(control(scene.container, "tab", "Skills"));
  await skillListShows(scene, "review-checklist", ["project-checklist"]);
});
