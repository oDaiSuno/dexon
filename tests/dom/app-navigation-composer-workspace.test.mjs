import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  click,
  keyDown,
  waitFor,
  pathChoice,
  menuAction,
  menuActions,
  textBlocks,
  dom,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { chatRegion } from "../support/app-navigation-leave.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

const openFailure = "Fixture could not open the folder";

function footerTrigger(scene, name) {
  return waitFor(() => control(chatRegion(scene), "button", name));
}

function switcher(scene) {
  return waitFor(() => {
    const matches = roles(chatRegion(scene), "button").filter((element) =>
      element.title.startsWith("Switch worktree:"),
    );
    assert.equal(matches.length, 1);
    return matches[0];
  });
}

function menuGone(scene, name) {
  return waitFor(() => assert.equal(menuActions(scene.container, name).length, 0));
}

function alertSays(scene, message) {
  return waitFor(() =>
    assert.ok(
      roles(scene.container, "alert").some((element) => element.textContent.includes(message)),
      `Expected a visible alert saying ${message}`,
    ),
  );
}

function useClipboard(t, writeText) {
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: { writeText } });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
}

test("in personal space the composer footer is named “Workspace: Default space”, shows no branch, and its menu shows the home-relative path", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const trigger = await footerTrigger(scene, "Workspace: Default space");
  assert.doesNotMatch(trigger.textContent, /main|review/);
  await click(trigger);
  await waitFor(() => assert.ok(textBlocks(scene.container).includes("~/.dexon")));
});

test("in a project's main checkout the composer footer is named by the project and its branch", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await footerTrigger(scene, "Workspace: navigation-project, branch main");
});

test("after switching to another worktree the footer names that branch and its menu marks that checkout as current", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await click(await switcher(scene));
  await click(await waitFor(() => pathChoice(scene.container, navigationPaths.worktree)));
  const trigger = await footerTrigger(scene, "Workspace: navigation-project, branch review");
  await click(trigger);
  await waitFor(() =>
    assert.equal(pathChoice(chatRegion(scene), navigationPaths.worktree).getAttribute("aria-current"), "true"),
  );
  assert.equal(pathChoice(chatRegion(scene), navigationPaths.project).hasAttribute("aria-current"), false);
});

test("Escape closes the footer workspace menu and puts keyboard focus back on its trigger", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  const trigger = await switcher(scene);
  await click(trigger);
  await keyDown(await waitFor(() => pathChoice(scene.container, navigationPaths.worktree)), "Escape");
  await menuGone(scene, "Open in Finder");
  assert.ok(dom.window.document.activeElement === trigger, "keyboard focus is back on the footer trigger");
});

test("Open in Finder from the footer hands the current folder to the system and closes the menu", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await click(await switcher(scene));
  await click(await waitFor(() => menuAction(scene.container, "Open in Finder")));
  await waitFor(() => assert.equal(scene.external.desktop.openedDirectory, navigationPaths.project));
  await menuGone(scene, "Open in Finder");
});

test("Copy project path puts the project path on the clipboard and closes the menu", async (t) => {
  const written = [];
  useClipboard(t, async (value) => {
    written.push(value);
  });
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await click(await switcher(scene));
  await click(await waitFor(() => menuAction(scene.container, "Copy project path")));
  await waitFor(() => assert.deepEqual(written, [navigationPaths.project]));
  await menuGone(scene, "Copy project path");
});

test("when the clipboard refuses the project path, the footer menu stays open and says the copy failed", async (t) => {
  useClipboard(t, async () => {
    throw new Error("Fixture clipboard is locked");
  });
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await click(await switcher(scene));
  await click(await waitFor(() => menuAction(scene.container, "Copy project path")));
  await alertSays(scene, "Copy failed");
  menuAction(scene.container, "Copy project path");
});

test("when the system cannot open the folder, the footer menu stays open and says why", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  scene.external.failures.openDirectory = openFailure;
  await click(await switcher(scene));
  await click(await waitFor(() => menuAction(scene.container, "Open in Finder")));
  await alertSays(scene, openFailure);
  menuAction(scene.container, "Open in Finder");
});
