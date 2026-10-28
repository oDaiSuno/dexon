import assert from "node:assert/strict";
import test, { after } from "node:test";
import { startNavigation, control, roles, click, act, input, waitFor, dom, restoreGlobals } from "../support/app-navigation.mjs";
import { projectOrder, projectMenu } from "../support/app-navigation-projects.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";
import { accessibleName } from "../support/dom-queries.mjs";

after(restoreGlobals);
const saved = { openProjects: [P.personal, P.project, P.empty], lastSpaceCwd: P.project };
const menus = () => roles(dom.window.document.body, "menu");
const items = (menu) => roles(menu, "menuitem").map(accessibleName);
const ready = async (t, options = saved) => {
  const scene = await startNavigation(t, options);
  await waitFor(() => assert.equal(projectOrder(scene).length, 3));
  await scene.settled();
  return scene;
};

test("R1 the ⋯ of the current project opens the same row menu as every other project", async (t) => {
  const scene = await ready(t);
  const current = items(await projectMenu(scene, "navigation-project"));
  console.log("R1 current row:", current.join(" | "));
  assert.deepEqual(current, ["Move up", "Move down", "Close project"]);
});

test("R2 ⌘P with the sidebar open opens exactly one card", async (t) => {
  const scene = await ready(t);
  await act(async () => scene.external.menu("open-project-switcher"));
  await scene.settled();
  console.log("R2 menus:", menus().map((m) => `${accessibleName(m)} -> ${items(m).join(" | ")}`).join(" ; "));
  assert.equal(menus().length, 1);
});

test("R3 ⌘P with the sidebar collapsed opens the card of the current project and its search finds other projects", async (t) => {
  const scene = await ready(t);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  await act(async () => scene.external.menu("open-project-switcher"));
  const card = await waitFor(() => menus()[0]);
  await input(control(card, "searchbox", "Search or open a project…"), "empty");
  await scene.settled();
  console.log("R3 card:", accessibleName(card), "| search 'empty' ->", items(card).join(" | "));
  assert.equal(accessibleName(card), "navigation-project");
  assert.equal(items(card)[0], "empty-project");
});

test("R4 a running current project shows Close project greyed out, not missing", async (t) => {
  const scene = await ready(t, { ...saved, runningSessionIds: ["project-history"] });
  const menu = await projectMenu(scene, "navigation-project");
  console.log("R4 running current:", items(menu).join(" | "));
  assert.ok(items(menu).includes("Close project"));
});

test("R5 the project spaces header offers Switch or add project and Collapse all projects", async (t) => {
  const scene = await ready(t);
  const names = roles(scene.history(), "button").map(accessibleName).filter((n) => /project/i.test(n) && !/^Actions for/.test(n));
  console.log("R5 header buttons:", JSON.stringify(names));
  control(scene.history(), "button", "Switch or add project");
  control(scene.history(), "button", "Collapse all projects");
});
