import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  visibleText,
  click,
  act,
  dom,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

const ADD_FROM_FOLDER = "Add project space from folder…";

test("the desktop Toggle Sidebar command (⌘\\) collapses the sidebar and expands it again", async (t) => {
  const scene = await startNavigation(t);
  control(scene.navigation(), "button", "Hide sidebar");
  await act(async () => scene.external.menu("toggle-sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  await act(async () => scene.external.menu("toggle-sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Hide sidebar"));
});

test("the desktop Show Processes command (⌘J) opens the right panel on the Processes tab with the ⌘J hint", async (t) => {
  const scene = await startNavigation(t);
  await act(async () => scene.external.menu("open-processes"));
  await waitFor(() =>
    assert.equal(control(scene.container, "button", "Processes").getAttribute("aria-pressed"), "true"),
  );
  await waitFor(() => visibleText(scene.container, "No background processes"));
  const panel = visibleText(scene.container, "No background processes").parentElement;
  visibleText(panel, "⌘J");
  assert.match(panel.textContent, /Open this anytime/);
});

test("the desktop Switch Project command (⌘P) expands a collapsed sidebar and opens the project switcher card", async (t) => {
  const scene = await startNavigation(t);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  await act(async () => scene.external.menu("open-project-switcher"));
  const card = await waitFor(() => control(dom.window.document.body, "menu", "Default space"));
  control(card, "menuitem", ADD_FROM_FOLDER);
  control(scene.navigation(), "button", "Hide sidebar");
});

test("the project switcher card shows ⌘O next to adding a project from a folder", async (t) => {
  const scene = await startNavigation(t);
  const card = await scene.menu();
  const add = control(card, "menuitem", ADD_FROM_FOLDER);
  assert.equal(add.getAttribute("aria-keyshortcuts"), "Meta+O");
  assert.match(add.textContent, /⌘O/);
});

test("the desktop Add Project command (⌘O) asks for a folder and opens it as the current project", async (t) => {
  const scene = await startNavigation(t);
  scene.external.desktop.selectedDirectory = navigationPaths.project;
  await act(async () => scene.external.menu("add-project"));
  await waitFor(() => control(scene.workspace(), "button", "navigation-project"));
  assert.equal(scene.external.desktop.directoryRequests, 1);
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});
