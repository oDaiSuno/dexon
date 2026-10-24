import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  textBlocks,
  click,
  keyDown,
  input,
  waitFor,
  pathChoice,
  menuAction,
  historyRows,
  noHistoryRows,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import {
  createdWorktreeBranch,
  navigationPaths,
  personalPrepareReason,
  removedSpaceReason,
} from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

const projectRows = ["Project release notes", "Review branch notes"];
const personalRows = ["Personal release notes", "Another personal conversation"];

async function expectProjectSpace(scene) {
  await waitFor(() => historyRows(scene, ...projectRows));
  noHistoryRows(scene, ...personalRows);
  control(scene.workspace(), "button", "navigation-project");
}

function worktreeSwitcher(scene) {
  const matches = roles(scene.container, "button").filter((element) => element.title.startsWith("Switch worktree:"));
  assert.equal(matches.length, 1);
  return matches[0];
}

test("the production sidebar shows a friendly personal-space name without a resident path or worktree hint, and keeps the path and space actions in its menu", async (t) => {
  const scene = await startNavigation(t, { history: false });
  control(scene.workspace(), "button", "Personal space");
  const menu = await scene.menu();
  assert.ok(menu.textContent.includes(navigationPaths.personal), "the menu shows the full personal folder path");
  assert.deepEqual(
    roles(menu, "menuitem")
      .map((item) => item.textContent.trim())
      .sort(),
    ["Open current folder", "Choose another folder…", "Switch space…", "Back to personal space"].sort(),
  );
  await keyDown(menu, "Escape");
  await waitFor(() => assert.equal(roles(scene.navigation(), "menu").length, 0));
  await scene.settled();
  assert.ok(!scene.navigation().textContent.includes(navigationPaths.personal));
  assert.doesNotMatch(scene.navigation().textContent, /worktree|repo root/i);
});

test("Open current folder asks the operating-system boundary to open the active personal directory", async (t) => {
  const scene = await startNavigation(t, { history: false });
  const menu = await scene.menu();
  await click(control(menu, "menuitem", "Open current folder"));
  await waitFor(() => assert.equal(scene.external.desktop.openedDirectory, navigationPaths.personal));
});

test("choosing another folder moves the sidebar to that project and shows all of its worktree histories", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, ...personalRows));
  scene.external.desktop.selectedDirectory = navigationPaths.project;
  await click(control(await scene.menu(), "menuitem", "Choose another folder…"));
  await expectProjectSpace(scene);
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("cancelling the native directory picker keeps the personal space and its history", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, ...personalRows));
  scene.external.desktop.selectedDirectory = null;
  await click(control(await scene.menu(), "menuitem", "Choose another folder…"));
  await waitFor(() => assert.equal(scene.external.desktop.directoryRequests, 1));
  await scene.settled();
  control(scene.workspace(), "button", "Personal space");
  historyRows(scene, ...personalRows);
  noHistoryRows(scene, ...projectRows);
  assert.equal(await scene.currentFolder(), navigationPaths.personal);
});

test("Switch space exposes a recent project whose selection moves the sidebar to that project", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, ...personalRows));
  await click(control(await scene.menu(), "menuitem", "Switch space…"));
  await click(await waitFor(() => pathChoice(scene.container, navigationPaths.project)));
  await expectProjectSpace(scene);
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("a space chosen from the sidebar is still the current space after reloading the application", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, ...personalRows));
  scene.external.desktop.selectedDirectory = navigationPaths.project;
  await click(control(await scene.menu(), "menuitem", "Choose another folder…"));
  await expectProjectSpace(scene);
  await scene.settled();
  const reopened = await scene.reload();
  await expectProjectSpace(reopened);
  assert.equal(await reopened.currentFolder(), navigationPaths.project);
});

test("returning from a project to personal space restores the personal history", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await expectProjectSpace(scene);
  await click(control(await scene.menu("navigation-project"), "menuitem", "Back to personal space"));
  await waitFor(() => historyRows(scene, ...personalRows));
  noHistoryRows(scene, ...projectRows);
  control(scene.workspace(), "button", "Personal space");
  assert.equal(await scene.currentFolder(), navigationPaths.personal);
});

test("switching a Git worktree moves to that checkout while keeping both histories in the same project", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await expectProjectSpace(scene);
  await click(await waitFor(() => worktreeSwitcher(scene)));
  await click(await waitFor(() => pathChoice(scene.container, navigationPaths.worktree)));
  await waitFor(() => assert.equal(worktreeSwitcher(scene).title, `Switch worktree: ${navigationPaths.worktree}`));
  historyRows(scene, ...projectRows);
  assert.equal(await scene.currentFolder(), navigationPaths.worktree);
});

test("creating a worktree from the composer footer moves to the new checkout and keeps the project history", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await expectProjectSpace(scene);
  await click(await waitFor(() => worktreeSwitcher(scene)));
  await click(await waitFor(() => menuAction(scene.container, "New worktree…")));
  const branch = await waitFor(() => {
    const fields = roles(scene.container, "textbox").filter((element) => element.placeholder === "branch name");
    assert.equal(fields.length, 1, "Expected one visible branch name field");
    return fields[0];
  });
  await input(branch, createdWorktreeBranch);
  await keyDown(branch, "Enter");
  await waitFor(() =>
    assert.equal(worktreeSwitcher(scene).title, `Switch worktree: ${navigationPaths.createdWorktree}`),
  );
  historyRows(scene, ...projectRows);
  assert.equal(await scene.currentFolder(), navigationPaths.createdWorktree);
});

test("removing another worktree from the composer footer drops it from the choices and keeps the current checkout", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await expectProjectSpace(scene);
  await click(await openRemoveControl(scene, navigationPaths.worktree));
  await waitFor(() => assert.equal(worktreeChoices(scene, navigationPaths.worktree).length, 0));
  await scene.settled();
  historyRows(scene, ...projectRows);
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("opening a conversation from another worktree of the project moves the current folder to that checkout", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await expectProjectSpace(scene);
  await click(control(scene.history(), "button", "Review branch notes"));
  await waitFor(() => assert.ok(textBlocks(scene.container).includes("Review conversation marker")));
  historyRows(scene, ...projectRows);
  assert.equal(await scene.currentFolder(), navigationPaths.worktree);
});

async function openRemoveControl(scene, path) {
  await click(await waitFor(() => worktreeSwitcher(scene)));
  const remove = `Remove worktree checkout ${path}; the branch is kept`;
  return waitFor(() => {
    const matches = roles(scene.container, "button").filter((element) => element.title === remove);
    assert.equal(matches.length, 1, "Expected one remove control for the review worktree");
    return matches[0];
  });
}

function worktreeChoices(scene, path) {
  return [...roles(scene.container, "button"), ...roles(scene.container, "menuitemradio")].filter(
    (element) => element.title === path,
  );
}

test("removing a worktree with uncommitted changes asks first and keeps it when the user cancels", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: navigationPaths.project,
    dirtyWorktrees: [navigationPaths.worktree],
  });
  await expectProjectSpace(scene);
  await click(await openRemoveControl(scene, navigationPaths.worktree));
  await waitFor(() => control(scene.container, "button", "Force"));
  await click(control(scene.container, "button", "Cancel"));
  await waitFor(() => assert.equal(roles(scene.container, "button", "Force").length, 0));
  await scene.settled();
  assert.equal(worktreeChoices(scene, navigationPaths.worktree).length, 1, "the review worktree is kept");
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("removing a worktree with uncommitted changes removes it after the user confirms Force", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: navigationPaths.project,
    dirtyWorktrees: [navigationPaths.worktree],
  });
  await expectProjectSpace(scene);
  await click(await openRemoveControl(scene, navigationPaths.worktree));
  await click(await waitFor(() => control(scene.container, "button", "Force")));
  await waitFor(() => assert.equal(worktreeChoices(scene, navigationPaths.worktree).length, 0));
  await scene.settled();
  historyRows(scene, ...projectRows);
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("an unavailable remembered space shows its reason and is not silently replaced until the user returns to personal space", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: navigationPaths.removed,
    unavailableSpaces: { [navigationPaths.removed]: removedSpaceReason },
  });
  await waitFor(() => assert.ok(textBlocks(scene.container).some((block) => block.includes(removedSpaceReason))));
  await scene.settled();
  for (const title of [...personalRows, ...projectRows])
    assert.equal(roles(scene.navigation(), "button", title).length, 0, `${title} is not shown`);
  await click(control(await scene.menu("removed-project"), "menuitem", "Back to personal space"));
  await waitFor(() => historyRows(scene, ...personalRows));
  control(scene.workspace(), "button", "Personal space");
  assert.ok(!textBlocks(scene.container).some((block) => block.includes(removedSpaceReason)));
  assert.equal(await scene.currentFolder(), navigationPaths.personal);
});

test("a personal folder that cannot be prepared shows its reason and Retry prepares it again", async (t) => {
  const scene = await startNavigation(t, { personalPrepareFailures: 1 });
  await waitFor(() => assert.ok(textBlocks(scene.container).some((block) => block.includes(personalPrepareReason))));
  await scene.settled();
  await click(control(scene.container, "button", "Retry"));
  await waitFor(() => historyRows(scene, ...personalRows));
  control(scene.workspace(), "button", "Personal space");
  assert.ok(!textBlocks(scene.container).some((block) => block.includes(personalPrepareReason)));
  assert.equal(await scene.currentFolder(), navigationPaths.personal);
});
