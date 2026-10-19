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
  historyRow,
  currentPages,
  restoreGlobals,
} from "../support/app-navigation.mjs";

after(restoreGlobals);

function showsChat(scene) {
  control(scene.container, "region", "Chat");
  assert.equal(roles(scene.container, "heading", "Plugins & Skills").length, 0);
  const marked = currentPages(scene);
  for (const entry of ["Plugins & Skills", scene.labels.newSession])
    assert.equal(marked.includes(entry), false, `${entry} is not the current page`);
}

async function collapsedNavigation(t, options = {}) {
  const scene = await startNavigation(t, options);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  return scene;
}

test("selecting a history row while Resources is open shows that conversation and marks that row as the current page", async (t) => {
  const scene = await startNavigation(t);
  await scene.resources();
  await click(await waitFor(() => historyRow(scene, "Personal release notes")));
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-history");
  showsChat(scene);
  assert.deepEqual(currentPages(scene), ["Personal release notes"]);
});

// The Host fixture returns a fixed history: this checks visible rows, not persisted history creation.
test("New session on the main navigation leaves Resources for an empty chat and keeps only the two existing history rows visible", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await scene.resources();
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await waitFor(() => control(scene.container, "group", "Message input"));
  showsChat(scene);
  assert.deepEqual(currentPages(scene), [], "an empty session is the current page nowhere in the navigation");
  assert.equal(dom.window.location.search, "");
  assert.doesNotMatch(control(scene.container, "region", "Chat").textContent, /Personal conversation marker/);
  await scene.settled();
  assert.equal(roles(scene.history(), "listitem").length, 2);
  historyRows(scene, "Personal release notes", "Another personal conversation");
});

test("clicking the open conversation in history returns from Resources to it with its scene kept", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await scene.resources();
  await scene.settled();
  const reads = scene.external.sessionReads("personal-history");
  await click(historyRow(scene, "Personal release notes"));
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-history");
  await scene.settled();
  assert.equal(scene.external.sessionReads("personal-history"), reads, "returning did not load the conversation again");
  showsChat(scene);
  assert.deepEqual(currentPages(scene), ["Personal release notes"]);
});

test("on Resources the only current page is the resource entry, not the open conversation in history", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await scene.resources();
  await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  assert.deepEqual(currentPages(scene), ["Plugins & Skills"]);
});

test("the desktop New Session command issued from Resources shows an empty chat instead of staying on Resources", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await scene.resources();
  await act(async () => scene.external.menu("new-session"));
  await waitFor(() => control(scene.container, "group", "Message input"));
  showsChat(scene);
  assert.deepEqual(currentPages(scene), []);
  assert.doesNotMatch(control(scene.container, "region", "Chat").textContent, /Personal conversation marker/);
});

test("a session link opened while Resources is shown displays that conversation as the current page", async (t) => {
  const scene = await startNavigation(t);
  await scene.resources();
  await act(async () => scene.external.deepLink("personal-other"));
  await waitFor(() => visibleText(scene.container, "Other conversation marker"));
  showsChat(scene);
  assert.equal(dom.window.location.search, "?session=personal-other");
  assert.deepEqual(currentPages(scene), ["Another personal conversation"]);
});

test("the collapsed Resources icon opens real personal-space resources without expanding navigation", async (t) => {
  const scene = await collapsedNavigation(t, { history: false });
  await scene.resources();
  await waitFor(() => visibleText(scene.resourcePanel(), "npm:personal-navigation-plugin"));
  control(scene.navigation(), "button", "Show sidebar");
  assert.equal(control(scene.navigation(), "button", "Plugins & Skills").getAttribute("aria-current"), "page");
});

test("New session on the rail returns from Resources to chat and expansion restores history and workspace controls", async (t) => {
  const scene = await collapsedNavigation(t);
  await scene.resources();
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await waitFor(() => control(scene.container, "group", "Message input"));
  assert.equal(roles(scene.container, "heading", "Plugins & Skills").length, 0);
  await click(control(scene.navigation(), "button", "Show sidebar"));
  control(scene.workspace(), "button", "Personal space");
  const history = await waitFor(() => historyRows(scene, "Personal release notes", "Another personal conversation"));
  assert.equal(roles(history, "listitem").length, 2);
  showsChat(scene);
  assert.deepEqual(currentPages(scene), []);
});

test("in Chinese the navigation's first entry reads 新建会话 instead of 聊天", async (t) => {
  const scene = await startNavigation(t, { language: "zh-CN", initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  const navigation = scene.navigation();
  assert.equal(roles(navigation, "button", "聊天").length, 0, "the chat entry is gone");
  assert.equal(
    roles(navigation, "button", "新建会话").length,
    1,
    "the new session entry is named as the rest of the app names it",
  );
});
