import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, click, control, hover, startNavigation, waitFor, restoreGlobals } from "../support/app-navigation.mjs";
import {
  branchesPane,
  branchRow,
  browseUp,
  card,
  installBrowserEvents,
  mentions,
  openCard,
  projectRow,
  removeWorktreeButton,
  triggerName,
} from "../support/app-navigation-workspace.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);
after(installBrowserEvents());

test("a removal still in flight keeps its control disabled when the card is closed and opened again", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  await openCard(scene);
  await hover(branchRow(await waitFor(() => branchesPane(scene, "navigation-project")), "review"));
  const hold = scene.external.hold("worktrees.remove");
  await click(removeWorktreeButton(scene, P.worktree));
  await waitFor(() => assert.equal(hold.reached(), true, "the removal reached the Host"));

  await browseUp(scene, () => mentions(card(scene), "Default space is not a git repository"));
  await click(control(card(scene), "button", "Switch to Default space"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: Default space"));
  await openCard(scene);
  await click(projectRow(scene, "navigation-project"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch main"));

  await openCard(scene);
  await hover(branchRow(await waitFor(() => branchesPane(scene, "navigation-project")), "review"));
  const protectedControl = await waitFor(() => removeWorktreeButton(scene, P.worktree));
  assert.equal(protectedControl.disabled, true, "the returned card cannot submit another pending removal");
  await act(async () => protectedControl.click());
  await scene.settled({ held: 1 });
  assert.deepEqual(
    scene.external.requests("worktrees.remove").map((params) => params.path),
    [P.worktree],
    "the disabled interaction produced no duplicate removal",
  );

  hold.release();
  await waitFor(() => {
    const pane = branchesPane(scene, "navigation-project");
    assert.ok(!branchRow(pane, "review").textContent.includes(P.worktree), "the removal finished");
  });
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main");
});
