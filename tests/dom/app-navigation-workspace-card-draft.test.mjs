import assert from "node:assert/strict";
import test, { after } from "node:test";
import { click, control, startNavigation, waitFor, restoreGlobals } from "../support/app-navigation.mjs";
import { historyRow } from "../support/app-navigation.mjs";
import {
  branchesPane,
  branchRow,
  card,
  draft,
  installBrowserEvents,
  isDisabled,
  openCard,
  projectRow,
  triggerName,
  type,
} from "../support/app-navigation-workspace.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);
after(installBrowserEvents());

const half = "half sentence";
const old = "old content";

test("a draft typed on the new-session page follows a move to another worktree and leaves the old folder empty", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  await type(scene, half);
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "review"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch review"));
  assert.equal(await draft(scene), half, "the draft moved to the worktree folder");

  await type(scene, "");
  await openCard(scene);
  const back = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(back, "main"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch main"));
  assert.equal(await draft(scene), "", "the half sentence is not left behind as a second copy");
});

test("a draft typed on the new-session page follows a project switch and leaves the old project empty", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project, P.other] });
  await type(scene, half);
  await openCard(scene);
  await click(projectRow(scene, "paper-notes"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: paper-notes, branch main"));
  assert.equal(await draft(scene), half, "the draft moved to the other project");

  await type(scene, "");
  await openCard(scene);
  await click(projectRow(scene, "navigation-project"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch main"));
  assert.equal(await draft(scene), "", "the half sentence is not left behind as a second copy");
});

test("a carried draft lands in front of a draft the target already held, with exactly one blank line between them", async (t) => {
  const scene = await startNavigation(t, {
    lastSpaceCwd: P.project,
    openProjects: [P.personal, P.project, P.other],
    notesHistory: true,
  });
  await openCard(scene);
  await click(projectRow(scene, "paper-notes"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: paper-notes, branch main"));
  await type(scene, old);
  await click(historyRow(scene, "Notes release plan"));
  await waitFor(() => assert.equal(card(scene), undefined));
  await click(control(scene.history(), "button", "navigation-project"));
  await click(historyRow(scene, "Project release notes"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch main"));
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch main"));
  assert.equal(await draft(scene), "", "the project this draft is about to come from starts empty");

  await type(scene, half);
  await openCard(scene);
  await click(projectRow(scene, "paper-notes"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: paper-notes, branch main"));
  assert.equal(await draft(scene), `${half}\n\n${old}`, "both drafts are kept, the carried one first");
});

test("switching a branch inside the same folder leaves the draft exactly where it was", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  await type(scene, half);
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "feat/alpha"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch feat/alpha"));
  assert.equal(await draft(scene), half, "the folder did not change, so the draft did not move");
});

test("when the folder cannot be opened, the draft stays where the user typed it", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project, P.other] });
  await type(scene, half);
  await openCard(scene);
  await scene.settled();
  const target = projectRow(scene, "paper-notes");
  assert.equal(isDisabled(target), false, "the target project can be clicked");
  const asked = scene.external.hold("system.validateCwd", ({ path }) => path === P.other);
  scene.external.removeFolder(P.other);
  await click(target);
  await waitFor(() => assert.equal(asked.reached(), true, "the App asked the Host whether that folder can be opened"));
  asked.release();
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.project, "the space did not move to a folder that is gone");
  assert.equal(await draft(scene), half, "the draft is still in the composer where it was typed");
});
