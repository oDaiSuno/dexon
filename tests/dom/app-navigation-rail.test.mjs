import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  visibleText,
  click,
  dom,
  waitFor,
  historyRows,
  currentPages,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { railEntries } from "../fixtures/app-navigation-data.mjs";
import { accessibleName } from "../support/dom-queries.mjs";

after(restoreGlobals);

async function collapsedNavigation(t, options = {}) {
  const scene = await startNavigation(t, options);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  return scene;
}

test("collapsing populated history leaves exactly the four approved actionable rail entries", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  assert.deepEqual(roles(scene.navigation(), "button").map(accessibleName), railEntries);
  assert.equal(roles(scene.navigation(), "navigation", "History").length, 0);
});

test("the collapsed Settings icon opens Settings", async (t) => {
  const scene = await collapsedNavigation(t, { history: false });
  await scene.settings();
  control(scene.navigation(), "button", "Show sidebar");
});

test("New session on the rail replaces the open conversation and expansion restores history and workspace controls", async (t) => {
  const scene = await collapsedNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await waitFor(() => control(scene.container, "group", "Message input"));
  assert.doesNotMatch(control(scene.container, "region", "Chat").textContent, /Personal conversation marker/);
  await click(control(scene.navigation(), "button", "Show sidebar"));
  control(scene.workspace(), "button", "Personal space");
  const history = await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  assert.equal(roles(history, "listitem").length, 2);
  assert.deepEqual(currentPages(scene), [], "an empty session is the current page nowhere in the navigation");
});

test("on a narrow window the navigation is a closed drawer that opens over chat and closes after choosing a conversation", async (t) => {
  const scene = await startNavigation(t, { viewport: "narrow" });
  await scene.settled();
  assert.equal(roles(scene.container, "navigation", "Main navigation").length, 0);
  await click(control(scene.container, "button", "Show sidebar"));
  await click(await waitFor(() => control(scene.history(), "button", "Another personal conversation")));
  await waitFor(() => visibleText(scene.container, "Other conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-other");
  await waitFor(() => assert.equal(roles(scene.container, "navigation", "Main navigation").length, 0));
});
