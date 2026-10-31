import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, click, control, roles, startNavigation, waitFor, restoreGlobals } from "../support/app-navigation.mjs";
import { projectOrder } from "../support/app-navigation-projects.mjs";
import {
  browseDown,
  browseUp,
  branchesPane,
  branchRowNames,
  card,
  currentSidebarProject,
  installBrowserEvents,
  isCurrent,
  isDisabled,
  mentions,
  openCard,
  projectRow,
  projectRowNames,
  showBranches,
  triggerName,
} from "../support/app-navigation-workspace.mjs";
import { navigationPaths as P, removedSpaceReason } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);
after(installBrowserEvents());

test("the card lists every project the sidebar has open, default space first, with the current one marked", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project, P.terminalOnly, P.removed],
    unavailableSpaces: { [P.removed]: removedSpaceReason },
  });
  const menu = await openCard(scene);
  assert.deepEqual(projectRowNames(scene), [
    "Default space",
    "navigation-project",
    "terminal-only-project",
    "removed-project",
  ]);
  assert.deepEqual(projectRowNames(scene), projectOrder(scene), "the card lists the projects in the sidebar's order");
  assert.equal(isCurrent(projectRow(scene, "navigation-project")), true, "the current project is marked");
  assert.equal(isCurrent(projectRow(scene, "Default space")), false);
  assert.equal(isCurrent(projectRow(scene, "terminal-only-project")), false);
  assert.ok(projectRow(scene, "Default space").textContent.includes("Not in any repository"));
  assert.ok(projectRow(scene, "navigation-project").textContent.includes("main"));
  assert.ok(projectRow(scene, "terminal-only-project").textContent.includes("Not a git repository"));
  assert.ok(projectRow(scene, "removed-project").textContent.includes("Folder not found"));
  assert.equal(roles(scene.container, "button", "Switch project…").length, 0, "the card no longer offers that entry");
  assert.ok(!menu.textContent.includes("Switch project"), "and it is not worded anywhere else either");
});

test("choosing another project's row moves the space to its main folder and leaves the branch alone", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project, P.other] });
  await openCard(scene);
  await click(projectRow(scene, "paper-notes"));
  await waitFor(() => assert.equal(card(scene), undefined, "the card closes after the switch"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: paper-notes, branch main"));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.other);
  assert.equal(currentSidebarProject(scene), "paper-notes", "the sidebar follows the new current project");
  assert.deepEqual(scene.external.requests("worktrees.switchBranch"), [], "no Git branch was switched");
});

test("a project whose folder is gone is greyed out and cannot be chosen", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project, P.removed],
    unavailableSpaces: { [P.removed]: removedSpaceReason },
  });
  await openCard(scene);
  const row = projectRow(scene, "removed-project");
  assert.equal(isDisabled(row), true, "the missing project cannot be chosen");
  await act(async () => row.click());
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.project);
  assert.ok(card(scene), "the card stays open when nothing can be chosen");
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main");
});

test("browsing another project shows that project's branches while the space itself does not move", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project, P.other] });
  await openCard(scene);
  await waitFor(() =>
    assert.deepEqual(branchRowNames(branchesPane(scene, "navigation-project"), scene.labels), [
      "main",
      "review",
      "a3f9c21",
      "feat/alpha",
      "audit/cleanup",
      "feat/beta",
      "wip/idea",
      "chore/gamma",
    ]),
  );
  await showBranches(scene, "paper-notes");
  await waitFor(() =>
    assert.deepEqual(branchRowNames(branchesPane(scene, "paper-notes"), scene.labels), [
      "main",
      "exp/retrieval",
      "data/2026-q3",
    ]),
  );
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main");
  assert.deepEqual(scene.external.requests("worktrees.switchBranch"), []);
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.project);
  assert.ok(card(scene), "the card stays open while browsing");
});

test("a project that is not a Git repository browses to the empty state and can still be switched to", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project, P.terminalOnly],
  });
  await openCard(scene);
  await browseDown(scene, () => mentions(card(scene), "terminal-only-project is not a git repository"));
  const menu = card(scene);
  await waitFor(() =>
    assert.ok(
      menu.textContent.includes(
        "There are no branches here. Press Enter or click the row on the left to switch to this folder.",
      ),
    ),
  );
  await click(control(menu, "button", "Switch to terminal-only-project"));
  await waitFor(() => assert.equal(card(scene), undefined));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: terminal-only-project"));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.terminalOnly);
});

test("the default space browses to the empty state, and its own switch entry returns the space to it", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  await openCard(scene);
  await browseUp(scene, () => mentions(card(scene), "Default space is not a git repository"));
  const menu = card(scene);
  await click(control(menu, "button", "Switch to Default space"));
  await waitFor(() => assert.equal(card(scene), undefined));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: Default space"));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.personal);
});

test("a project that is a folder inside a Git repository browses to the empty state and offers no branch switching", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project, P.subfolder],
  });
  await openCard(scene);
  await browseDown(scene, () => mentions(card(scene), "app is not a git repository"));
  const menu = card(scene);
  await waitFor(() => assert.ok(menu.textContent.includes("There are no branches here.")));
  for (const name of ["main", "feat/alpha", "review"])
    assert.equal(roles(menu, "button", name).length, 0, `the enclosing repository's ${name} branch is not offered`);
  assert.equal(roles(menu, "button", "New worktree…").length, 0, "no worktree can be created from here");
});
