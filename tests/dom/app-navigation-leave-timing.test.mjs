import assert from "node:assert/strict";
import test, { after } from "node:test";
import { startNavigation, control, visibleText, click, waitFor, restoreGlobals } from "../support/app-navigation.mjs";
import { switchSpace } from "../support/app-navigation-leave.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

// Requests that answer late. The Host fixture holds one chosen request until
// the test releases it, so ordering is explicit rather than timed.

const forCwd = (cwd) => (params) => params.cwd === cwd;
const personalSkillFile = "/Users/navigation-fixture/.dexon/.pi/skills/personal-checklist/SKILL.md";
const lateSkillContent = "# Personal checklist\n\nOnly the personal space has this text.\n";

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
  await click(control(scene.resourcePanel(), "switch", "Disable package"));
  await waitFor(() => assert.ok(disable.reached()));
  await switchSpace(scene, navigationPaths.project);
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:project-navigation-plugin"));
  disable.release();
  await scene.settled();
  assert.doesNotMatch(scene.resourcePanel().textContent, /Package disabled\.|npm:personal-navigation-plugin/);
  await click(control(await scene.menu("navigation-project"), "menuitem", "Back to default space"));
  await click(await waitFor(() => visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin")));
  await waitFor(() => control(scene.resourcePanel(), "switch", "Enable package"));
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
  assert.ok(!scene.resourcePanel().textContent.includes("Only the personal space has this text."));
});
