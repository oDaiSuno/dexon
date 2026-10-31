import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  textBlocks,
  click,
  hover,
  keyDown,
  input,
  waitFor,
  menuAction,
  historyRows,
  noHistoryRows,
  dom,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { accessibleName } from "../support/dom-queries.mjs";
import {
  branchesPane,
  branchRow,
  branchRowNames,
  card,
  installBrowserEvents,
  isDisabled,
  openCard,
  projectsPane,
  triggerName,
} from "../support/app-navigation-workspace.mjs";
import {
  createdWorktreeBranch,
  navigationPaths,
  personalPrepareReason,
  removedSpaceReason,
} from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);
after(installBrowserEvents());

const projectRows = ["Project release notes", "Review branch notes"];
const personalRows = ["Personal release notes", "Another personal conversation"];
const removeHint = (folder) => `Remove worktree checkout ${folder}; the branch is kept`;

async function expectProjectSpace(scene) {
  await waitFor(() => historyRows(scene, ...projectRows));
  noHistoryRows(scene, ...personalRows);
  control(scene.workspace(), "button", "navigation-project");
}

async function openProjectCard(scene) {
  const menu = await openCard(scene);
  await waitFor(() => branchesPane(scene, "navigation-project"));
  return menu;
}

const removeControls = (scene, folder) =>
  roles(card(scene), "button").filter((element) => element.title === removeHint(folder));

async function removeControl(scene, folder) {
  return waitFor(() => removeControls(scene, folder)[0] ?? null);
}

test("the production sidebar shows a friendly personal-space name without a resident path or worktree hint, and its project card shows the current project, where it lives and the two space actions", async (t) => {
  const scene = await startNavigation(t, { history: false });
  control(scene.workspace(), "button", "Default space");
  const menu = await scene.menu();
  const blocks = textBlocks(menu);
  assert.ok(blocks.includes("Current project"), "the card labels the current project group");
  assert.ok(blocks.includes("Default space"), "the card names the current project");
  assert.ok(blocks.includes("~"), "the personal folder lives in the home folder, shown as ~");
  assert.ok(!menu.textContent.includes(navigationPaths.home), "the card does not spell out the home folder");
  assert.deepEqual(
    roles(menu, "menuitem").map((item) => accessibleName(item)),
    ["Add project space from folder…", "Back to default space"],
  );
  await keyDown(menu, "Escape");
  await waitFor(() => assert.equal(roles(scene.navigation(), "menu").length, 0));
  await scene.settled();
  assert.ok(!scene.navigation().textContent.includes(navigationPaths.personal));
  assert.doesNotMatch(scene.navigation().textContent, /worktree|repo root/i);
});

test("Open in Finder in the composer's workspace card asks the operating-system boundary to open the active personal directory", async (t) => {
  const scene = await startNavigation(t, { history: false });
  await openCard(scene);
  await click(await waitFor(() => control(scene.container, "button", "Open in Finder")));
  await waitFor(() => assert.equal(scene.external.desktop.openedDirectory, navigationPaths.personal));
});

test("choosing another project in the composer card switches the space and leaves the sidebar exactly as it was", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: navigationPaths.project,
    openProjects: [navigationPaths.personal, navigationPaths.project, navigationPaths.empty],
  });
  await expectProjectSpace(scene);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  await openCard(scene);
  await click(control(projectsPane(scene), "button", "empty-project"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: empty-project"));
  control(scene.navigation(), "button", "Show sidebar");
  await scene.settled();
  assert.equal(await scene.currentFolder(), navigationPaths.empty);
  assert.equal(
    roles(dom.window.document.body, "menu", "Switch space").length,
    0,
    "no separate list of spaces is opened",
  );
});

test("choosing another folder moves the sidebar to that project and shows all of its worktree histories", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, ...personalRows));
  scene.external.desktop.selectedDirectory = navigationPaths.project;
  await click(control(await scene.menu(), "menuitem", "Add project space from folder…"));
  await expectProjectSpace(scene);
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("cancelling the native directory picker keeps the personal space and its history", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, ...personalRows));
  scene.external.desktop.selectedDirectory = null;
  await click(control(await scene.menu(), "menuitem", "Add project space from folder…"));
  await waitFor(() => assert.equal(scene.external.desktop.directoryRequests, 1));
  await scene.settled();
  control(scene.workspace(), "button", "Default space");
  historyRows(scene, ...personalRows);
  noHistoryRows(scene, ...projectRows);
  assert.equal(await scene.currentFolder(), navigationPaths.personal);
});

test("another project in the sidebar tree is reached by expanding it and opening one of its conversations, which moves the sidebar to that project", async (t) => {
  const scene = await startNavigation(t, { openProjects: [navigationPaths.personal, navigationPaths.project] });
  await waitFor(() => historyRows(scene, ...personalRows));
  await click(control(scene.history(), "button", "navigation-project"));
  await click(await waitFor(() => control(scene.history(), "button", "Project release notes")));
  await expectProjectSpace(scene);
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("a space chosen from the sidebar is still the current space after reloading the application", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, ...personalRows));
  scene.external.desktop.selectedDirectory = navigationPaths.project;
  await click(control(await scene.menu(), "menuitem", "Add project space from folder…"));
  await expectProjectSpace(scene);
  await scene.settled();
  const reopened = await scene.reload();
  await expectProjectSpace(reopened);
  assert.equal(await reopened.currentFolder(), navigationPaths.project);
});

test("returning from a project to personal space restores the personal history", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await expectProjectSpace(scene);
  await click(control(await scene.menu("navigation-project"), "menuitem", "Back to default space"));
  await waitFor(() => historyRows(scene, ...personalRows));
  noHistoryRows(scene, ...projectRows);
  control(scene.workspace(), "button", "Default space");
  assert.equal(await scene.currentFolder(), navigationPaths.personal);
});

test("switching a Git worktree moves to that checkout while keeping both histories in the same project", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await expectProjectSpace(scene);
  await openProjectCard(scene);
  await click(branchRow(branchesPane(scene, "navigation-project"), "review"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch review"));
  historyRows(scene, ...projectRows);
  assert.equal(await scene.currentFolder(), navigationPaths.worktree);
});

test("creating a worktree from the card moves to the new checkout and keeps the project history", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await expectProjectSpace(scene);
  await openProjectCard(scene);
  await click(await waitFor(() => menuAction(scene.container, "New worktree…")));
  const branch = await waitFor(() => {
    const fields = roles(scene.container, "textbox").filter((element) => element.placeholder === "branch name");
    assert.equal(fields.length, 1, "Expected one visible branch name field");
    return fields[0];
  });
  await input(branch, createdWorktreeBranch);
  await keyDown(branch, "Enter");
  await waitFor(() =>
    assert.equal(triggerName(scene), `Workspace: navigation-project, branch ${createdWorktreeBranch}`),
  );
  historyRows(scene, ...projectRows);
  assert.equal(await scene.currentFolder(), navigationPaths.createdWorktree);
});

test("removing another worktree drops its folder from the list but keeps the branch itself", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: navigationPaths.project });
  await expectProjectSpace(scene);
  await openProjectCard(scene);
  await hover(branchRow(branchesPane(scene, "navigation-project"), "review"));
  await click(await waitFor(() => removeControl(scene, navigationPaths.worktree)));
  await waitFor(() =>
    assert.equal(removeControls(scene, navigationPaths.worktree).length, 0, "the worktree's remove control is gone"),
  );
  const after = branchesPane(scene, "navigation-project");
  assert.deepEqual(branchRowNames(after, scene.labels), [
    "main",
    "a3f9c21",
    "review",
    "feat/alpha",
    "audit/cleanup",
    "feat/beta",
    "wip/idea",
    "chore/gamma",
  ]);
  assert.equal(isDisabled(branchRow(after, "review")), false, "the branch is an ordinary local branch now");
  assert.ok(!branchRow(after, "review").textContent.includes(navigationPaths.worktree));
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

test("removing a worktree with uncommitted changes asks first and keeps it when the user cancels", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: navigationPaths.project,
    dirtyWorktrees: [navigationPaths.worktree],
  });
  await expectProjectSpace(scene);
  await openProjectCard(scene);
  await hover(branchRow(branchesPane(scene, "navigation-project"), "review"));
  await click(await waitFor(() => removeControl(scene, navigationPaths.worktree)));
  await waitFor(() => control(card(scene), "button", "Force"));
  await click(control(card(scene), "button", "Cancel"));
  await waitFor(() => assert.equal(roles(card(scene), "button", "Force").length, 0));
  await scene.settled();
  assert.ok(
    branchRow(branchesPane(scene, "navigation-project"), "review").textContent.includes(navigationPaths.worktree),
  );
  assert.equal(await scene.currentFolder(), navigationPaths.project);
});

test("removing a worktree with uncommitted changes removes it after the user confirms Force", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: navigationPaths.project,
    dirtyWorktrees: [navigationPaths.worktree],
  });
  await expectProjectSpace(scene);
  await openProjectCard(scene);
  await hover(branchRow(branchesPane(scene, "navigation-project"), "review"));
  await click(await waitFor(() => removeControl(scene, navigationPaths.worktree)));
  await click(await waitFor(() => control(card(scene), "button", "Force")));
  await waitFor(() => {
    const pane = branchesPane(scene, "navigation-project");
    const review = roles(pane, "button", "review");
    assert.equal(review.length, 1, "the branch itself is still listed");
    assert.ok(!review[0].textContent.includes(navigationPaths.worktree), "its folder is gone");
  });
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
  await click(control(await scene.menu("removed-project"), "menuitem", "Back to default space"));
  await waitFor(() => historyRows(scene, ...personalRows));
  control(scene.workspace(), "button", "Default space");
  assert.ok(!textBlocks(scene.container).some((block) => block.includes(removedSpaceReason)));
  assert.equal(await scene.currentFolder(), navigationPaths.personal);
});

test("a personal folder that cannot be prepared shows its reason and Retry prepares it again", async (t) => {
  const scene = await startNavigation(t, { personalPrepareFailures: 1 });
  await waitFor(() => assert.ok(textBlocks(scene.container).some((block) => block.includes(personalPrepareReason))));
  await scene.settled();
  await click(control(scene.container, "button", "Retry"));
  await waitFor(() => historyRows(scene, ...personalRows));
  control(scene.workspace(), "button", "Default space");
  assert.ok(!textBlocks(scene.container).some((block) => block.includes(personalPrepareReason)));
  assert.equal(await scene.currentFolder(), navigationPaths.personal);
});
