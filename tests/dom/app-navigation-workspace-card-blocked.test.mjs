import assert from "node:assert/strict";
import test, { after } from "node:test";
import { click, control, startNavigation, waitFor, restoreGlobals } from "../support/app-navigation.mjs";
import {
  branchesPane,
  branchRow,
  card,
  installBrowserEvents,
  mentions,
  openCard,
  says,
  showBranches,
  triggerName,
} from "../support/app-navigation-workspace.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);
after(installBrowserEvents());

const blockedFromOtherProject = { openProjects: [P.personal, P.project, P.other], lastSpaceCwd: P.project };

test("a dirty folder blocks the switch in place, explains why and offers a worktree instead", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project],
    dirtyFolders: [P.project],
  });
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "feat/alpha"));
  await waitFor(() => assert.ok(mentions(card(scene), "This folder has uncommitted changes")));
  const menu = card(scene);
  says(menu, "Switching now would carry these changes to the other branch.");
  control(menu, "button", "Open in new worktree");
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main", "the space did not move");
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.project);

  await click(control(menu, "button", "Cancel"));
  await waitFor(() => assert.ok(!mentions(card(scene), "This folder has uncommitted changes")));
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main");
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.project);
  assert.deepEqual(scene.external.requests("worktrees.create"), [], "nothing was created by cancelling");
});

test("a folder with a conversation running in it blocks the switch and offers a worktree instead", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project],
    busyFolders: [P.project],
  });
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "feat/alpha"));
  await waitFor(() => assert.ok(mentions(card(scene), "A session or process is running in this folder")));
  says(card(scene), "Switching now would change the files it is reading.");
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main");
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.project);
});

test("opening the blocked branch in a new worktree creates it for the branch and moves the space there", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project],
    dirtyFolders: [P.project],
  });
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "feat/alpha"));
  await click(await waitFor(() => control(card(scene), "button", "Open in new worktree")));
  await waitFor(() => assert.equal(card(scene), undefined));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch feat/alpha"));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.alphaWorktree);
  assert.deepEqual(
    scene.external.requests("worktrees.create").map(({ projectRoot, branch }) => [projectRoot, branch]),
    [[P.project, "feat/alpha"]],
  );
});

test("a branch of another project is switched in that project's own folder, and the space only follows once the Host agrees", async (t) => {
  const scene = await startNavigation(t, blockedFromOtherProject);
  await openCard(scene);
  await showBranches(scene, "paper-notes");
  const pane = await waitFor(() => branchesPane(scene, "paper-notes"));
  const hold = scene.external.hold("worktrees.switchBranch");
  await click(branchRow(pane, "exp/retrieval"));
  await waitFor(() => assert.equal(hold.reached(), true, "the switch request reached the Host"));
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main", "the space waits for the answer");
  await scene.settled({ held: 1 });
  assert.equal(await scene.currentFolder(), P.project);
  hold.release();
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: paper-notes, branch exp/retrieval"));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.other);
  assert.deepEqual(scene.external.requests("worktrees.switchBranch"), [{ cwd: P.other, branch: "exp/retrieval" }]);
});

test("a dirty folder in another project stops the switch with that project's own wording", async (t) => {
  const scene = await startNavigation(t, { ...blockedFromOtherProject, dirtyFolders: [P.other] });
  await openCard(scene);
  await showBranches(scene, "paper-notes");
  const pane = await waitFor(() => branchesPane(scene, "paper-notes"));
  await click(branchRow(pane, "exp/retrieval"));
  await waitFor(() => assert.ok(mentions(card(scene), "paper-notes's main folder has uncommitted changes")));
  const menu = card(scene);
  says(menu, "Switching now would carry these changes to the other branch.");
  assert.ok(!mentions(menu, "This folder has uncommitted changes"), "the wording names the other project");
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main");
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.project);

  await click(control(menu, "button", "Open in new worktree"));
  await waitFor(() => assert.equal(card(scene), undefined));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: paper-notes, branch exp/retrieval"));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.otherWorktree);
  assert.deepEqual(
    scene.external.requests("worktrees.create").map(({ projectRoot, branch }) => [projectRoot, branch]),
    [[P.other, "exp/retrieval"]],
  );
});

test("a busy folder in another project stops the switch with that project's own wording", async (t) => {
  const scene = await startNavigation(t, { ...blockedFromOtherProject, busyFolders: [P.other] });
  await openCard(scene);
  await showBranches(scene, "paper-notes");
  const pane = await waitFor(() => branchesPane(scene, "paper-notes"));
  await click(branchRow(pane, "exp/retrieval"));
  await waitFor(() => assert.ok(mentions(card(scene), "A session or process is running in paper-notes's main folder")));
  const menu = card(scene);
  says(menu, "Switching now would change the files it is reading.");
  assert.ok(!mentions(menu, "A session or process is running in this folder"), "the wording names the other project");
  control(menu, "button", "Open in new worktree");
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main");
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.project);
});
