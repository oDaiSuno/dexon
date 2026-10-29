import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  visibleText,
  click,
  hover,
  input,
  act,
  keyDown,
  dom,
  waitFor,
  historyRow,
  historyRows,
  historyRowsWithStatus,
  currentPages,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { sessionItems } from "../support/app-navigation-projects.mjs";
import { laterConversation } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

test("selecting a history row shows that conversation and marks that row as the current page", async (t) => {
  const scene = await startNavigation(t);
  await click(await waitFor(() => control(scene.history(), "button", "Another personal conversation")));
  await waitFor(() => visibleText(scene.container, "Other conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-other");
  assert.deepEqual(currentPages(scene), ["Another personal conversation"]);
});

test("the history search in the production navigation selects the matching session rather than the first conversation", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  await input(control(scene.navigation(), "searchbox", "Search sessions"), "personal-other");
  assert.equal(roles(scene.navigation(), "button", "Personal release notes").length, 0);
  await click(control(scene.navigation(), "button", "Another personal conversation"));
  await waitFor(() => visibleText(scene.container, "Other conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-other");
});

test("New session on the main navigation replaces the open conversation with an empty chat and keeps the existing history rows", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await waitFor(() => control(scene.container, "group", "Message input"));
  assert.equal(dom.window.location.search, "");
  assert.doesNotMatch(control(scene.container, "region", "Chat").textContent, /Personal conversation marker/);
  assert.deepEqual(currentPages(scene), [], "an empty session is the current page nowhere in the navigation");
  await scene.settled();
  assert.equal(sessionItems(scene).length, 2);
  historyRows(scene, "Personal release notes", "Another personal conversation");
});

test("the navigation keeps a search box always visible and the project spaces header offers the switcher card without a separate new-session control", async (t) => {
  const scene = await startNavigation(t);
  const history = await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  control(scene.navigation(), "searchbox", "Search sessions");
  await click(control(history, "button", "Switch or add project"));
  const card = await waitFor(() => control(dom.window.document.body, "menu", "Default space"));
  control(card, "menuitem", "Add project space from folder…");
  assert.equal(roles(history, "button", /^new session$/i).length, 0, "history has no new-session entry of its own");
});

async function openRowActions(scene, title) {
  await hover(await waitFor(() => control(scene.history(), "button", title)));
  await click(control(scene.history(), "button", `Session actions for ${title}`));
  return waitFor(() => control(scene.history(), "menu", "Session actions"));
}

test("renaming a conversation from the production navigation shows the new name in history", async (t) => {
  const scene = await startNavigation(t);
  const menu = await openRowActions(scene, "Another personal conversation");
  await click(control(menu, "menuitem", "Rename"));
  const field = await waitFor(() => control(scene.history(), "textbox"));
  await input(field, "Renamed personal conversation");
  await keyDown(field, "Enter");
  await waitFor(() => control(scene.history(), "button", "Renamed personal conversation"));
  assert.equal(roles(scene.history(), "button", "Another personal conversation").length, 0);
  control(scene.history(), "button", "Personal release notes");
});

test("deleting the open conversation removes it from history and leaves an empty chat in the same space", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  const menu = await openRowActions(scene, "Personal release notes");
  await click(control(menu, "menuitem", "Delete session"));
  await click(await waitFor(() => control(scene.history(), "button", "Delete")));
  await waitFor(() => assert.equal(roles(scene.history(), "button", "Personal release notes").length, 0));
  control(scene.history(), "button", "Another personal conversation");
  await waitFor(() => control(scene.container, "group", "Message input"));
  assert.doesNotMatch(control(scene.container, "region", "Chat").textContent, /Personal conversation marker/);
  assert.equal(dom.window.location.search, "");
  control(scene.workspace(), "button", "Default space");
});

test("a conversation the Host reports as running is marked as running in the production history", async (t) => {
  const scene = await startNavigation(t, { runningSessionIds: ["personal-other"] });
  await waitFor(() =>
    assert.equal(historyRowsWithStatus(scene, "Another personal conversation", "Agent running").length, 1),
  );
  control(scene.history(), "button", "Personal release notes");
  assert.equal(historyRowsWithStatus(scene, "Personal release notes", "Agent running").length, 0);
});

test("a conversation that finishes in the background is marked as new activity until the user opens it", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  await waitFor(() => assert.ok(scene.external.runningSubscribers() > 0, "the history listens for running work"));
  await act(async () => scene.external.running(["personal-other"]));
  await waitFor(() =>
    assert.equal(historyRowsWithStatus(scene, "Another personal conversation", "Agent running").length, 1),
  );
  await act(async () => scene.external.running([]));
  const [unread] = await waitFor(() => {
    const rows = historyRowsWithStatus(scene, "Another personal conversation", "New activity");
    assert.equal(rows.length, 1);
    return rows;
  });
  assert.equal(historyRowsWithStatus(scene, "Personal release notes", "New activity").length, 0);
  await click(unread);
  await waitFor(() => visibleText(scene.container, "Other conversation marker"));
  await waitFor(() => control(scene.history(), "button", "Another personal conversation"));
  assert.equal(historyRowsWithStatus(scene, "Another personal conversation", "New activity").length, 0);
});

test("the Switch Session command reloads history and shows a conversation the Host recorded after the list was first loaded", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  await scene.settled();
  scene.external.addConversation(laterConversation());
  assert.equal(roles(scene.history(), "button", "Later personal conversation").length, 0);
  await act(async () => scene.external.menu("switch-session"));
  await waitFor(() => control(scene.history(), "button", "Later personal conversation"));
});

test("the Switch Session command puts the keyboard in the session search box", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, "Personal release notes"));
  await act(async () => scene.external.menu("switch-session"));
  await waitFor(() =>
    assert.equal(dom.window.document.activeElement, control(scene.navigation(), "searchbox", "Search sessions")),
  );
});

async function collapseAndExpand(scene) {
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  await click(control(scene.navigation(), "button", "Show sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Hide sidebar"));
}

test("folded forks stay folded after the navigation is collapsed and expanded again", async (t) => {
  const scene = await startNavigation(t, { forks: true });
  await waitFor(() => {
    historyRows(scene, "Another personal conversation");
    historyRow(scene, "Forked personal conversation");
  });
  await click(control(scene.history(), "button", "Collapse forks"));
  await waitFor(() => assert.equal(roles(scene.history(), "button", /^Forked personal conversation/).length, 0));
  await collapseAndExpand(scene);
  await waitFor(() => historyRows(scene, "Another personal conversation"));
  assert.equal(roles(scene.history(), "button", /^Forked personal conversation/).length, 0);
  control(scene.history(), "button", "Expand forks");
});

test("collapsing the navigation ends an active history search", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  await input(control(scene.navigation(), "searchbox", "Search sessions"), "personal-other");
  await waitFor(() => assert.equal(roles(scene.history(), "button", "Personal release notes").length, 0));
  await collapseAndExpand(scene);
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  assert.equal(control(scene.navigation(), "searchbox", "Search sessions").value, "");
});
