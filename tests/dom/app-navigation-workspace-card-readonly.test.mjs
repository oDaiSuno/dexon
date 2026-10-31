import assert from "node:assert/strict";
import test, { after } from "node:test";
import { click, control, dom, roles, startNavigation, waitFor, restoreGlobals } from "../support/app-navigation.mjs";
import { chatRegion } from "../support/app-navigation-leave.mjs";
import { accessibleName } from "../support/dom-queries.mjs";
import {
  branchesPane,
  branchRow,
  card,
  installBrowserEvents,
  openCard,
  says,
  saysNot,
  triggerName,
  type,
} from "../support/app-navigation-workspace.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);
after(installBrowserEvents());

function useClipboard(t, writeText) {
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: { writeText } });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
}

test("an open conversation's card only shows where that conversation lives, and offers no switching at all", async (t) => {
  const written = [];
  useClipboard(t, async (value) => {
    written.push(value);
  });
  const scene = await startNavigation(t, { initialSession: "project-history" });
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch main"));
  const menu = await openCard(scene);
  says(
    menu,
    "navigation-project",
    "main",
    P.project,
    "This session was created here. To work elsewhere, start a new session.",
  );
  saysNot(menu, "worktree");
  assert.deepEqual(
    roles(menu, "button").map(accessibleName).sort(),
    ["Copy path", "Open in Finder"],
    "no project row, branch row or worktree control is offered",
  );
  assert.equal(roles(menu, "textbox", "Filter branches…").length, 0, "there is nothing to filter");

  await click(control(menu, "button", "Copy path"));
  await waitFor(() => assert.deepEqual(written, [P.project]));
  await openCard(scene);
  await click(control(card(scene), "button", "Open in Finder"));
  await waitFor(() => assert.equal(scene.external.desktop.openedDirectory, P.project));
});

test("a conversation started in a worktree shows that worktree's own folder, and copying takes that folder", async (t) => {
  const written = [];
  useClipboard(t, async (value) => {
    written.push(value);
  });
  const scene = await startNavigation(t, { initialSession: "review-history" });
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch review"));
  const menu = await openCard(scene);
  says(menu, "navigation-project", "review", P.worktree, "worktree");
  await click(control(menu, "button", "Copy path"));
  await waitFor(() => assert.deepEqual(written, [P.worktree]));
});

test("the card of a conversation that lives in the main folder offers no worktree to move to", async (t) => {
  const scene = await startNavigation(t, { initialSession: "project-history" });
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch main"));
  const menu = await openCard(scene);
  assert.deepEqual(
    roles(menu, "button").map(accessibleName).sort(),
    ["Copy path", "Open in Finder"],
    "the only actions a conversation's card offers are opening and copying",
  );
  assert.equal(roles(menu, "group", "navigation-project branches").length, 0);
  assert.equal(roles(menu, "button", "Show branches of navigation-project").length, 0);
});

test("a conversation keeps naming its own folder even after the space is moved to another worktree", async (t) => {
  const scene = await startNavigation(t, { initialSession: "project-history" });
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch main"));
  scene.external.desktop.selectedDirectory = P.worktree;
  await click(control(await scene.menu("navigation-project"), "menuitem", "Add project space from folder…"));
  await scene.settled();
  assert.equal(await scene.currentFolder(), P.worktree, "the space itself did move");
  assert.equal(
    triggerName(scene),
    "Workspace: navigation-project, branch main",
    "the card and its trigger keep naming the folder this conversation was created in",
  );
  const menu = await openCard(scene);
  says(menu, P.project, "This session was created here. To work elsewhere, start a new session.");
  saysNot(menu, "Open in new worktree");
});

test("a new session started after picking a worktree is created in that worktree", async (t) => {
  const scene = await startNavigation(t, { lastSpaceCwd: P.project, openProjects: [P.personal, P.project] });
  await openCard(scene);
  const pane = await waitFor(() => branchesPane(scene, "navigation-project"));
  await click(branchRow(pane, "review"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: navigation-project, branch review"));
  await type(scene, "hello");
  await click(control(chatRegion(scene), "button", "Send"));
  await waitFor(() => assert.equal(scene.external.requests("agent.new").length, 1));
  assert.equal(scene.external.requests("agent.new")[0].cwd, P.worktree);
});
