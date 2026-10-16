import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  visibleText,
  click,
  act,
  dom,
  waitFor,
  historyRows,
  noHistoryRows,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

const projectRows = ["Project release notes", "Review branch notes"];
const personalRows = ["Personal release notes", "Another personal conversation"];

async function expectProjectConversation(scene) {
  await waitFor(() => visibleText(scene.container, "Project conversation marker"));
  assert.equal(dom.window.location.search, "?session=project-history");
  await waitFor(() => historyRows(scene, ...projectRows));
  noHistoryRows(scene, ...personalRows);
  control(scene.workspace(), "button", "navigation-project");
  assert.equal(await scene.currentFolder(), navigationPaths.project);
}

// Existing defect, independent of the sidebar replacement: the menu path skips
// the address update that the sidebar's New Session performs, so reloading
// after a menu-created chat reopens the previous conversation.
test("[existing defect] after the desktop New Session command, reloading does not reopen the previous conversation", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await act(async () => scene.external.menu("new-session"));
  await waitFor(() => control(scene.container, "group", "Message input"));
  assert.doesNotMatch(control(scene.container, "region", "Chat").textContent, /Personal conversation marker/);
  await scene.settled();
  const reopened = await scene.reload();
  await waitFor(() => control(reopened.container, "group", "Message input"));
  await reopened.settled();
  assert.doesNotMatch(control(reopened.container, "region", "Chat").textContent, /Personal conversation marker/);
});

test("a session link in the current space displays that conversation", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, ...personalRows));
  await act(async () => scene.external.deepLink("personal-other"));
  await waitFor(() => visibleText(scene.container, "Other conversation marker"));
  assert.equal(dom.window.location.search, "?session=personal-other");
  control(scene.workspace(), "button", "Personal space");
  assert.equal(await scene.currentFolder(), navigationPaths.personal);
});

test("a session link to another space moves the sidebar to that conversation's project", async (t) => {
  const scene = await startNavigation(t);
  await waitFor(() => historyRows(scene, ...personalRows));
  await act(async () => scene.external.deepLink("project-history"));
  await expectProjectConversation(scene);
});

test("an explicit startup session wins over the remembered space and opens in its own project", async (t) => {
  const scene = await startNavigation(t, {
    initialSession: "project-history",
    lastSpaceCwd: navigationPaths.personal,
  });
  await expectProjectConversation(scene);
});

test("the desktop Switch Session command expands the collapsed navigation to reveal history", async (t) => {
  const scene = await startNavigation(t);
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  await act(async () => scene.external.menu("switch-session"));
  await waitFor(() => historyRows(scene, "Personal release notes"));
  control(scene.navigation(), "button", "Hide sidebar");
});
