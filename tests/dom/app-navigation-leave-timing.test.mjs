import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  visibleText,
  click,
  keyDown,
  act,
  dom,
  waitFor,
  pathChoice,
  historyRow,
  onChatPage,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import {
  dirtySkill,
  answer,
  leavePrompt,
  promptClosed,
  retainedEdit,
  chatRegion,
  openSwitchSpace,
  switchSpace,
} from "../support/app-navigation-leave.mjs";
import { navigationPaths, savedSkillContent } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

// Requests that answer late. The Host fixture holds one chosen request until
// the test releases it, so ordering is explicit rather than timed.

const forCwd = (cwd) => (params) => params.cwd === cwd;
const personalSkillFile = "/Users/navigation-fixture/.dexon/.pi/skills/personal-checklist/SKILL.md";
const lateSkillContent = "# Personal checklist\n\nOnly the personal space has this text.\n";

async function personalEditor(t) {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await dirtySkill(scene);
  return scene;
}

test("while a departure save is still writing, its prompt cannot be answered a second time", async (t) => {
  const scene = await personalEditor(t);
  const save = scene.external.hold("skills.set");
  await click(historyRow(scene, "Personal release notes"));
  await answer(scene, "Save");
  await waitFor(() => assert.ok(save.reached(), "the save reached the Host"));
  const prompt = control(scene.container, "dialog", "Unsaved skill changes");
  for (const name of ["Discard", "Cancel", "Save"]) assert.equal(control(prompt, "button", name).disabled, true);
  await keyDown(prompt, "Escape");
  await scene.settled({ held: 1 });
  control(scene.container, "dialog", "Unsaved skill changes");
  control(scene.container, "heading", "Plugins & Skills");
  save.release();
  await waitFor(() => visibleText(chatRegion(scene), "Personal conversation marker"));
  assert.equal(scene.external.skillWrites(), 1, "the skill file was written exactly once");
});

test("a session link that arrives while a departure save is writing does not override the requested destination", async (t) => {
  const scene = await personalEditor(t);
  const save = scene.external.hold("skills.set");
  await click(historyRow(scene, "Personal release notes"));
  await answer(scene, "Save");
  await waitFor(() => assert.ok(save.reached()));
  await act(async () => scene.external.deepLink("personal-other"));
  await scene.settled({ held: 1 });
  control(scene.container, "heading", "Plugins & Skills");
  assert.equal(dom.window.location.search, "?session=personal-history");
  save.release();
  // Whether the link is dropped or opened once the requested departure has
  // completed is not yet a decided product rule; both are accepted, as long as
  // the shown conversation matches the address.
  await waitFor(() => onChatPage(scene));
  await scene.settled();
  const search = dom.window.location.search;
  assert.ok(["?session=personal-history", "?session=personal-other"].includes(search), `unexpected address ${search}`);
  const marker = search === "?session=personal-other" ? "Other conversation marker" : "Personal conversation marker";
  await waitFor(() => visibleText(chatRegion(scene), marker));
});

test("a session link that arrives while the unsaved-changes prompt is still unanswered does not bypass it", async (t) => {
  const scene = await personalEditor(t);
  await click(historyRow(scene, "Personal release notes"));
  await leavePrompt(scene);
  await act(async () => scene.external.deepLink("personal-other"));
  await scene.settled();
  assert.equal(roles(scene.container, "dialog", "Unsaved skill changes").length, 1, "still exactly one prompt");
  retainedEdit(scene);
  await answer(scene, "Cancel");
  await promptClosed(scene);
  await scene.settled();
  retainedEdit(scene);
  assert.equal(scene.external.skillWrites(), 0);
});

test("a history click made while a departure save is writing does not leave the resource page early", async (t) => {
  const scene = await personalEditor(t);
  const save = scene.external.hold("skills.set");
  await click(historyRow(scene, "Personal release notes"));
  await answer(scene, "Save");
  await waitFor(() => assert.ok(save.reached()));
  await click(control(scene.history(), "button", "Another personal conversation"));
  await scene.settled({ held: 1 });
  control(scene.container, "heading", "Plugins & Skills");
  assert.equal(control(scene.resourcePanel(), "textbox", "Skill markdown content").value, savedSkillContent);
  save.fail("Fixture refused to save the skill file");
  await waitFor(() => assert.match(scene.resourcePanel().textContent, /Fixture refused to save the skill file/));
  await scene.settled();
  control(scene.container, "heading", "Plugins & Skills");
  assert.equal(dom.window.location.search, "?session=personal-history");
});

test("a plugin list for the previous space that answers after a space switch does not replace the new space's plugins", async (t) => {
  const scene = await startNavigation(t);
  const late = scene.external.hold("plugins.list", forCwd(navigationPaths.personal));
  await scene.resources();
  await waitFor(() => assert.ok(late.reached(), "the personal list is still loading"));
  await switchSpace(scene, navigationPaths.project);
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:project-navigation-plugin"));
  late.release();
  await scene.settled();
  visibleText(scene.resourcePanel(), "npm:project-navigation-plugin");
  assert.ok(!scene.resourcePanel().textContent.includes("npm:personal-navigation-plugin"));
});

test("a plugin list failure for the previous space does not show an error in the new space", async (t) => {
  const scene = await startNavigation(t);
  const late = scene.external.hold("plugins.list", forCwd(navigationPaths.personal));
  await scene.resources();
  await waitFor(() => assert.ok(late.reached()));
  await switchSpace(scene, navigationPaths.project);
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:project-navigation-plugin"));
  late.fail("Fixture personal plugin list failed late");
  await scene.settled();
  assert.doesNotMatch(
    scene.resourcePanel().textContent,
    /Fixture personal plugin list failed late|Failed to load plugins/,
  );
  visibleText(scene.resourcePanel(), "npm:project-navigation-plugin");
});

test("the previous space's plugin list finishing late does not end the new space's loading with stale content", async (t) => {
  const scene = await startNavigation(t);
  const personal = scene.external.hold("plugins.list", forCwd(navigationPaths.personal));
  const project = scene.external.hold("plugins.list", forCwd(navigationPaths.project));
  await scene.resources();
  await waitFor(() => assert.ok(personal.reached()));
  await switchSpace(scene, navigationPaths.project);
  await waitFor(() => assert.ok(project.reached()));
  personal.release();
  await scene.settled({ held: 1 });
  assert.ok(!scene.resourcePanel().textContent.includes("npm:personal-navigation-plugin"));
  visibleText(scene.resourcePanel(), "Loading…");
  project.release();
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:project-navigation-plugin"));
});

test("a plugin action that completes after a space switch reports nothing in the new space, while the change itself is kept", async (t) => {
  const scene = await startNavigation(t);
  await scene.resources();
  await click(await waitFor(() => visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin")));
  const disable = scene.external.hold("plugins.set", forCwd(navigationPaths.personal));
  await click(control(scene.resourcePanel(), "button", "Disable package"));
  await waitFor(() => assert.ok(disable.reached()));
  await switchSpace(scene, navigationPaths.project);
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:project-navigation-plugin"));
  disable.release();
  await scene.settled();
  assert.doesNotMatch(scene.resourcePanel().textContent, /Package disabled\.|npm:personal-navigation-plugin/);
  await click(control(await scene.menu("navigation-project"), "menuitem", "Back to personal space"));
  await click(await waitFor(() => visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin")));
  await waitFor(() => control(scene.resourcePanel(), "button", "Enable package"));
});

test("a skill list for the previous space that answers after a space switch does not replace the new space's skills", async (t) => {
  const scene = await startNavigation(t);
  const late = scene.external.hold("skills.list", forCwd(navigationPaths.personal));
  await scene.resources();
  await click(control(scene.container, "tab", "Skills"));
  await waitFor(() => assert.ok(late.reached()));
  await switchSpace(scene, navigationPaths.project);
  await waitFor(() => visibleText(scene.resourcePanel(), "project-checklist"));
  late.release();
  await scene.settled();
  visibleText(scene.resourcePanel(), "project-checklist");
  assert.ok(!scene.resourcePanel().textContent.includes("personal-checklist"));
  assert.equal(roles(scene.container, "dialog", "Unsaved skill changes").length, 0);
  await promptClosed(scene);
});

test("a skill list failure for the previous space does not show an error in the new space", async (t) => {
  const scene = await startNavigation(t);
  const late = scene.external.hold("skills.list", forCwd(navigationPaths.personal));
  await scene.resources();
  await click(control(scene.container, "tab", "Skills"));
  await waitFor(() => assert.ok(late.reached()));
  await switchSpace(scene, navigationPaths.project);
  await waitFor(() => visibleText(scene.resourcePanel(), "project-checklist"));
  late.fail("Fixture personal skill list failed late");
  await scene.settled();
  assert.doesNotMatch(
    scene.resourcePanel().textContent,
    /Fixture personal skill list failed late|Failed to load skills/,
  );
  visibleText(scene.resourcePanel(), "project-checklist");
});

test("the previous space's skill list finishing late does not end the new space's loading with stale content", async (t) => {
  const scene = await startNavigation(t);
  const personal = scene.external.hold("skills.list", forCwd(navigationPaths.personal));
  const project = scene.external.hold("skills.list", forCwd(navigationPaths.project));
  await scene.resources();
  await click(control(scene.container, "tab", "Skills"));
  await waitFor(() => assert.ok(personal.reached()));
  await switchSpace(scene, navigationPaths.project);
  await waitFor(() => assert.ok(project.reached()));
  personal.release();
  await scene.settled({ held: 1 });
  assert.ok(!scene.resourcePanel().textContent.includes("personal-checklist"));
  visibleText(scene.resourcePanel(), "Loading…");
  project.release();
  await waitFor(() => visibleText(scene.resourcePanel(), "project-checklist"));
});

test("a skill file that finishes loading after a space switch is not shown in the new space", async (t) => {
  const scene = await startNavigation(t);
  scene.external.writeSkillFile(personalSkillFile, lateSkillContent);
  await scene.resources();
  // The Skills tab opens its first skill on its own, so the hold comes first.
  const content = scene.external.hold("skills.getContent", forCwd(navigationPaths.personal));
  await click(control(scene.container, "tab", "Skills"));
  await waitFor(() => assert.ok(content.reached(), "the personal skill file is still loading"));
  await switchSpace(scene, navigationPaths.project);
  await waitFor(() => visibleText(scene.resourcePanel(), "project-checklist"));
  content.release();
  await scene.settled();
  assert.ok(!scene.resourcePanel().textContent.includes("personal-checklist"));
  for (const editor of roles(scene.resourcePanel(), "textbox", "Skill markdown content"))
    assert.notEqual(editor.value, lateSkillContent, "the personal file is not shown in the project");
});

// "Save changes" pressed directly, then a space switch before the write ends.
// The switch may wait or ask; either way the save belongs to the old space.
test("a direct save still writing when the space switches lands in the original file and leaves nothing in the new space", async (t) => {
  const scene = await startNavigation(t);
  await dirtySkill(scene);
  const save = scene.external.hold("skills.set");
  await click(control(scene.resourcePanel(), "button", "Save changes"));
  await waitFor(() => assert.ok(save.reached()));
  await openSwitchSpace(scene)();
  const first = await waitFor(() => {
    if (roles(scene.container, "dialog", "Unsaved skill changes").length) return "prompt";
    pathChoice(scene.container, navigationPaths.project);
    return "choice";
  });
  if (first === "choice") await click(pathChoice(scene.container, navigationPaths.project));
  save.release();
  await scene.settled();
  if (roles(scene.container, "dialog", "Unsaved skill changes").length) await answer(scene, "Discard");
  if (first === "prompt") await click(await waitFor(() => pathChoice(scene.container, navigationPaths.project)));
  await waitFor(() => visibleText(scene.resourcePanel(), "project-checklist"));
  await scene.settled();
  assert.ok(!scene.resourcePanel().textContent.includes("personal-checklist"));
  for (const editor of roles(scene.resourcePanel(), "textbox", "Skill markdown content"))
    assert.notEqual(editor.value, savedSkillContent, "the personal edit is not shown in the project");
  assert.doesNotMatch(scene.resourcePanel().textContent, /Failed to save skill file/);
  await click(control(await scene.menu("navigation-project"), "menuitem", "Back to personal space"));
  await waitFor(() => control(scene.workspace(), "button", "Personal space"));
  assert.equal((await scene.skills()).value, savedSkillContent, "the save went to the original personal file");
});
