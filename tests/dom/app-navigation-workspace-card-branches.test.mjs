import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  click,
  control,
  dom,
  input,
  roles,
  startNavigation,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { historyRows } from "../support/app-navigation.mjs";
import {
  branchesPane,
  branchRow,
  branchRowNames,
  card,
  installBrowserEvents,
  isCurrent,
  isDisabled,
  openCard,
  pressInCard,
  projectsPane,
  says,
  trigger,
  triggerName,
} from "../support/app-navigation-workspace.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);
after(installBrowserEvents());

const orderedBranches = [
  "main",
  "review",
  "a3f9c21",
  "feat/alpha",
  "audit/cleanup",
  "feat/beta",
  "wip/idea",
  "chore/gamma",
];

async function filePanelShows(scene, name) {
  return waitFor(() => control(scene.container, "button", `Open file ${name}`));
}

async function openExplorer(scene) {
  await click(control(scene.container, "button", "Show file panel"));
  const explorer = await waitFor(() => roles(scene.container, "button", "Explorer")[0]);
  if (explorer.getAttribute("aria-pressed") !== "true") await click(explorer);
  await waitFor(() =>
    assert.equal(control(scene.container, "button", "Explorer").getAttribute("aria-pressed"), "true"),
  );
}

test("the branch list is ordered current first, then branches held by a folder, then the rest by recent commit, with stale registrations last", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  const menu = await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  assert.deepEqual(branchRowNames(pane, scene.labels), orderedBranches);
  says(menu, "Current", "In their own folders", "Other local branches", "By recent commit");

  assert.equal(isCurrent(branchRow(pane, "main")), true, "the branch the folder is on comes first and is marked");
  assert.ok(branchRow(pane, "main").textContent.includes("Main folder"));
  assert.ok(branchRow(pane, "main").textContent.includes(P.project));
  assert.equal(isCurrent(branchRow(pane, "review")), false);
  assert.ok(branchRow(pane, "review").textContent.includes(P.worktree), "the worktree row names its real folder");
  assert.ok(!branchRow(pane, "review").textContent.includes("Main folder"));
  assert.ok(branchRow(pane, "a3f9c21").textContent.includes("Not on any branch"));
  assert.ok(branchRow(pane, "a3f9c21").textContent.includes(P.bisect));
  assert.equal(isDisabled(branchRow(pane, "chore/gamma")), true, "a stale registration cannot be chosen");
  assert.ok(branchRow(pane, "chore/gamma").textContent.includes("Still registered to missing folder"));
  assert.ok(branchRow(pane, "chore/gamma").textContent.includes(P.staleCheckout));
});

test("typing in the filter narrows the list, and Enter picks the highlighted branch", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await input(control(pane, "textbox", "Filter branches…"), "feat");
  await waitFor(() =>
    assert.deepEqual(branchRowNames(branchesPane(scene, "navigation-project"), scene.labels), [
      "feat/alpha",
      "feat/beta",
    ]),
  );
  await pressInCard(scene, "ArrowDown");
  await pressInCard(scene, "Enter");
  await waitFor(() => assert.equal(scene.external.requests("worktrees.switchBranch").length, 1));
  const [{ cwd, branch }] = scene.external.requests("worktrees.switchBranch");
  assert.equal(cwd, P.project, "the branch is switched inside the folder the card is browsing");
  assert.ok(["feat/alpha", "feat/beta"].includes(branch), `picked one of the filtered branches, not ${branch}`);
  await waitFor(() => assert.equal(triggerName(scene), `Workspace: navigation-project, branch ${branch}`));
});

test("the arrow keys move between the two panes, and Escape steps back and then closes the card", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  await openCard(scene);
  await waitFor(() => branchesPane(scene, "navigation-project"));
  const active = () => dom.window.document.activeElement;

  await pressInCard(scene, "ArrowRight");
  await waitFor(() =>
    assert.ok(branchesPane(scene, "navigation-project").contains(active()), "the branches pane has the keyboard"),
  );
  await pressInCard(scene, "ArrowLeft");
  await waitFor(() => assert.ok(projectsPane(scene).contains(active()), "the projects pane has it back"));
  assert.equal(triggerName(scene), "Workspace: navigation-project, branch main");

  await pressInCard(scene, "ArrowRight");
  await waitFor(() => assert.ok(branchesPane(scene, "navigation-project").contains(active())));
  await pressInCard(scene, "Escape");
  await waitFor(() =>
    assert.ok(projectsPane(scene).contains(active()), "Escape in the branch list returns to the project list"),
  );
  assert.ok(card(scene), "the card is still open");

  await pressInCard(scene, "Escape");
  await waitFor(() => assert.equal(card(scene), undefined, "Escape in the project list closes the card"));
  assert.ok(active() === trigger(scene), "keyboard focus returns to the footer trigger");
  assert.deepEqual(scene.external.requests("worktrees.switchBranch"), [], "browsing never switched anything");
});

test("choosing a branch held by another folder jumps to that folder without asking Git to switch anything", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "review"));
  await waitFor(() => assert.equal(card(scene), undefined));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch review"));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.worktree);
  historyRows(scene, "Project release notes", "Review branch notes");
  assert.deepEqual(
    scene.external.requests("worktrees.switchBranch"),
    [],
    "moving to a checkout is not a branch switch",
  );
});

test("choosing an ordinary branch switches it in place, and both the file panel and the card show the new branch", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  await openExplorer(scene);
  await filePanelShows(scene, "main-plan.md");
  assert.equal(roles(scene.container, "button", "Open file alpha-report.md").length, 0);

  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "feat/alpha"));
  await waitFor(() => assert.equal(card(scene), undefined));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch feat/alpha"));
  await filePanelShows(scene, "alpha-report.md");
  assert.equal(roles(scene.container, "button", "Open file main-plan.md").length, 0, "the panel shows the new branch");
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.project, "the folder itself stays where it was");

  const reopened = await openCard(scene);
  const branches = await waitFor(() => branchesPane(scene, "navigation-project"));
  assert.equal(isCurrent(branchRow(branches, "feat/alpha")), true, "the card reads the branch back from the Host");
  assert.equal(isCurrent(branchRow(branches, "main")), false);
  assert.ok(branchRow(branches, "feat/alpha").textContent.includes("Main folder"));
  assert.ok(branchRow(branches, "review").textContent.includes(P.worktree));
  says(reopened, "feat/alpha");
});
