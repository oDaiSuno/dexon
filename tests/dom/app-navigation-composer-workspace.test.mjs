import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  roles,
  click,
  waitFor,
  menuAction,
  textBlocks,
  dom,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import {
  branchRow,
  branchesPane,
  card,
  installBrowserEvents,
  isCurrent,
  openCard,
  pressInCard,
  projectsPane,
  trigger,
  triggerName,
} from "../support/app-navigation-workspace.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);
after(installBrowserEvents());

const openFailure = "Fixture could not open the folder";

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

test("in personal space the composer footer is named “Workspace: Default space”, shows no branch, and its card offers no branches", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const footer = trigger(scene);
  assert.equal(triggerName(scene), "Workspace: Default space");
  assert.doesNotMatch(footer.textContent, /main|review/);
  const menu = await openCard(scene);
  await waitFor(() => assert.ok(menu.textContent.includes("Default space is not a git repository")));
  assert.ok(textBlocks(menu).includes("Not in any repository"));
});

test("in a project's main checkout the composer footer is named by the project and its branch", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch main"));
});

test("after moving to another worktree the footer names that branch and its card marks that checkout as the current one", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "review"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch review"));
  await openCard(scene);
  const again = await waitFor(() => branchesPane(scene, "navigation-project"));
  assert.equal(isCurrent(branchRow(again, "review")), true, "the worktree is the current checkout");
  assert.equal(isCurrent(branchRow(again, "main")), false);
  assert.ok(branchRow(again, "main").textContent.includes("Main folder"), "the main folder is labelled as such");
});

test("Escape in the branch list steps back to the project list, and Escape there closes the card with focus on its trigger", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  const footer = trigger(scene);
  await openCard(scene);
  await waitFor(() => branchesPane(scene, "navigation-project"));
  await pressInCard(scene, "ArrowRight");
  await waitFor(() => assert.ok(branchesPane(scene, "navigation-project").contains(dom.window.document.activeElement)));
  await pressInCard(scene, "Escape");
  await waitFor(() => assert.ok(projectsPane(scene).contains(dom.window.document.activeElement)));
  assert.ok(card(scene), "the card is still open after the first Escape");
  await pressInCard(scene, "Escape");
  await waitFor(() => assert.equal(card(scene), undefined, "the card closes"));
  assert.ok(dom.window.document.activeElement === footer, "keyboard focus is back on the footer trigger");
});

test("Open in Finder from the footer hands the current folder to the system and closes the card", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await openCard(scene);
  await click(await waitFor(() => menuAction(scene.container, "Open in Finder")));
  await waitFor(() => assert.equal(scene.external.desktop.openedDirectory, navigationPaths.project));
  await waitFor(() => assert.equal(card(scene), undefined));
});

test("Copy path puts the current folder on the clipboard and closes the card", async (t) => {
  const written = [];
  useClipboard(t, async (value) => {
    written.push(value);
  });
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await openCard(scene);
  await click(await waitFor(() => menuAction(scene.container, "Copy path")));
  await waitFor(() => assert.deepEqual(written, [navigationPaths.project]));
  await waitFor(() => assert.equal(card(scene), undefined));
});

test("when the clipboard refuses the path, the card stays open and says the copy failed", async (t) => {
  useClipboard(t, async () => {
    throw new Error("Fixture clipboard is locked");
  });
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await openCard(scene);
  await click(await waitFor(() => menuAction(scene.container, "Copy path")));
  await alertSays(scene, "Copy failed");
  menuAction(scene.container, "Copy path");
});

test("when the system cannot open the folder, the card stays open and says why", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  scene.external.failures.openDirectory = openFailure;
  await openCard(scene);
  await click(await waitFor(() => menuAction(scene.container, "Open in Finder")));
  await alertSays(scene, openFailure);
  menuAction(scene.container, "Open in Finder");
});
