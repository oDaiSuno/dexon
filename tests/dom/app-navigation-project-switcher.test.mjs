import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  input,
  keyDown,
  waitFor,
  dom,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { accessibleName } from "../support/dom-queries.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

test("typing a known project's name in the project switcher and pressing Enter makes it the current project", async (t) => {
  const scene = await startNavigation(t);
  const card = await scene.menu();
  const search = control(card, "searchbox", "Search or open a project…");
  assert.equal(dom.window.document.activeElement, search, "the card opens with the cursor in the search box");
  await input(search, "navigation-project");
  await waitFor(() => assert.equal(accessibleName(roles(card, "menuitem")[0]), "navigation-project"));
  await keyDown(search, "Enter");
  await waitFor(() => assert.equal(roles(dom.window.document.body, "menu").length, 0));
  await waitFor(() => control(scene.workspace(), "button", "navigation-project"));
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("typing an existing folder path in the project switcher offers to open it and Enter opens it as the current project", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const card = await scene.menu();
  const search = control(card, "searchbox", "Search or open a project…");
  await input(search, navigationPaths.project);
  await waitFor(() => assert.equal(accessibleName(roles(card, "menuitem")[0]), `Open ${navigationPaths.project}`));
  await keyDown(search, "Enter");
  await waitFor(() => control(scene.workspace(), "button", "navigation-project"));
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});
