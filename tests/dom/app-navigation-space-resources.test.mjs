import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  visibleText,
  click,
  waitFor,
  pathChoice,
  expectScope,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

test("choosing another folder from Resources rescopes plugins to that project without hiding global resources", async (t) => {
  const scene = await startNavigation(t);
  await scene.resources();
  scene.external.desktop.selectedDirectory = navigationPaths.project;
  await click(control(await scene.menu(), "menuitem", "Add project space from folder…"));
  await expectScope(scene, "npm:project-navigation-plugin", { absent: ["npm:personal-navigation-plugin"] });
  control(scene.container, "heading", "Plugins & Skills");
});

test("cancelling the native directory picker keeps the current resource page and personal-space contents", async (t) => {
  const scene = await startNavigation(t);
  await scene.resources();
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin"));
  scene.external.desktop.selectedDirectory = null;
  await click(control(await scene.menu(), "menuitem", "Add project space from folder…"));
  await waitFor(() => assert.equal(scene.external.desktop.directoryRequests, 1));
  await scene.settled();
  await expectScope(scene, "npm:personal-navigation-plugin", { absent: ["npm:project-navigation-plugin"] });
  control(scene.workspace(), "button", "Default space");
  control(scene.container, "heading", "Plugins & Skills");
});

test("opening another project's conversation from the sidebar tree while on Resources rescopes plugins to that project", async (t) => {
  const scene = await startNavigation(t, { openProjects: [navigationPaths.personal, navigationPaths.project] });
  await scene.resources();
  await click(control(scene.navigation(), "button", "navigation-project"));
  await click(await waitFor(() => control(scene.navigation(), "button", "Project release notes")));
  await waitFor(() => visibleText(scene.container, "Project conversation marker"));
  await scene.resources();
  await expectScope(scene, "npm:project-navigation-plugin", { absent: ["npm:personal-navigation-plugin"] });
});

test("returning from a project to personal space restores personal resources while retaining shared resources", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await scene.resources();
  await expectScope(scene, "npm:project-navigation-plugin");
  await click(control(await scene.menu("navigation-project"), "menuitem", "Back to default space"));
  await expectScope(scene, "npm:personal-navigation-plugin", { absent: ["npm:project-navigation-plugin"] });
  await click(control(scene.container, "tab", "Skills"));
  await waitFor(() => visibleText(scene.resourcePanel(), "personal-checklist"));
  visibleText(scene.resourcePanel(), "shared-checklist");
  assert.ok(!scene.resourcePanel().textContent.includes("project-checklist"));
});

test("switching a Git worktree from the composer footer scopes resources to the checkout", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  const switcher = await waitFor(() => {
    const matches = roles(scene.container, "button").filter((element) => element.title.startsWith("Switch worktree:"));
    assert.equal(matches.length, 1);
    return matches[0];
  });
  await click(switcher);
  await click(await waitFor(() => pathChoice(scene.container, navigationPaths.worktree)));
  await scene.resources();
  await expectScope(scene, "npm:review-navigation-plugin", { absent: ["npm:project-navigation-plugin"] });
});

test("choosing a history item from another worktree aligns the subsequent resource page to that conversation directory", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await scene.resources();
  await click(await waitFor(() => control(scene.navigation(), "button", "Review branch notes")));
  await waitFor(() => visibleText(scene.container, "Review conversation marker"));
  await scene.resources();
  await expectScope(scene, "npm:review-navigation-plugin", { absent: ["npm:project-navigation-plugin"] });
  await click(control(scene.container, "tab", "Skills"));
  await waitFor(() => visibleText(scene.resourcePanel(), "review-checklist"));
  visibleText(scene.resourcePanel(), "shared-checklist");
});
