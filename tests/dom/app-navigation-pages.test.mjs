import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  visibleText,
  click,
  act,
  dom,
  waitFor,
  historyRows,
  restoreGlobals,
} from "../support/app-navigation.mjs";

after(restoreGlobals);

function showsChat(scene) {
  assert.equal(control(scene.navigation(), "button", "Chat").getAttribute("aria-current"), "page");
  assert.notEqual(control(scene.navigation(), "button", "Plugins & Skills").getAttribute("aria-current"), "page");
  assert.equal(roles(scene.container, "heading", "Plugins & Skills").length, 0);
}

async function collapsedNavigation(t, options = {}) {
  const scene = await startNavigation(t, options);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  return scene;
}

test("selecting history while Resources is open shows that conversation and makes Chat the current page", async (t) => {
  const scene = await startNavigation(t);
  await scene.resources();
  await click(await waitFor(() => control(scene.navigation(), "button", "Personal release notes")));
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-history");
  showsChat(scene);
});

// The Host fixture returns a fixed history: this checks visible rows, not persisted history creation.
test("new session from Resources enters an empty chat and keeps only the two existing history rows visible", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await scene.resources();
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  await click(control(scene.navigation(), "button", /^new session$/i));
  await waitFor(() => control(scene.container, "group", "Message input"));
  showsChat(scene);
  assert.equal(dom.window.location.search, "");
  assert.doesNotMatch(control(scene.container, "region", "Chat").textContent, /Personal conversation marker/);
  await scene.settled();
  assert.equal(roles(scene.history(), "listitem").length, 2);
  historyRows(scene, "Personal release notes", "Another personal conversation");
});

test("the Chat entry returns from Resources to the already selected conversation", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await scene.resources();
  assert.equal(roles(scene.container, "button", "Personal release notes").length, 1);
  await click(control(scene.navigation(), "button", "Chat"));
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-history");
  showsChat(scene);
});

test("the desktop New Session command issued from Resources shows an empty chat instead of staying on Resources", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await scene.resources();
  await act(async () => scene.external.menu("new-session"));
  await waitFor(() => control(scene.container, "group", "Message input"));
  showsChat(scene);
  assert.doesNotMatch(control(scene.container, "region", "Chat").textContent, /Personal conversation marker/);
});

test("a session link opened while Resources is shown displays that conversation as the current page", async (t) => {
  const scene = await startNavigation(t);
  await scene.resources();
  await act(async () => scene.external.deepLink("personal-other"));
  await waitFor(() => visibleText(scene.container, "Other conversation marker"));
  showsChat(scene);
  assert.equal(dom.window.location.search, "?session=personal-other");
});

test("the collapsed Resources icon opens real personal-space resources without expanding navigation", async (t) => {
  const scene = await collapsedNavigation(t, { history: false });
  await scene.resources();
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin"));
  control(scene.navigation(), "button", "Show sidebar");
  assert.equal(control(scene.navigation(), "button", "Plugins & Skills").getAttribute("aria-current"), "page");
});

test("new session on the rail returns from Resources to chat and expansion restores history and workspace controls", async (t) => {
  const scene = await collapsedNavigation(t);
  await scene.resources();
  await click(control(scene.navigation(), "button", /^new session$/i));
  await waitFor(() => control(scene.container, "group", "Message input"));
  assert.equal(roles(scene.container, "heading", "Plugins & Skills").length, 0);
  await click(control(scene.navigation(), "button", "Show sidebar"));
  control(scene.workspace(), "button", "Personal space");
  const history = await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  assert.equal(roles(history, "listitem").length, 2);
  showsChat(scene);
});
