import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
  dom,
  historyRow,
  input,
  keyDown,
  restoreGlobals,
  roles,
  visibleText,
  waitFor,
} from "../support/app-navigation.mjs";
import { startSessionScene } from "../support/session-tree-scene.mjs";
import { minutesAgo, treeSession } from "../fixtures/session-tree-data.mjs";

after(restoreGlobals);

function oldChain() {
  return [
    treeSession("restore-root", { name: "Restored root" }),
    treeSession("restore-middle", { name: "Restored middle", parentSessionId: "restore-root" }),
    treeSession("restore-deep", { name: "Restored leaf", parentSessionId: "restore-middle" }),
  ];
}

function recentRoots() {
  return [1, 2, 3, 4, 5].map((index) =>
    treeSession(`new-root-${index}`, { name: `Recent root ${index}`, modified: minutesAgo(index) }),
  );
}

test("initial restoration reveals an old deep session without preventing a later manual collapse", async (t) => {
  const scene = await startSessionScene(t, [...recentRoots(), ...oldChain()], { initialSession: "restore-deep" });
  await waitFor(() => visibleText(scene.container, "restore-deep marker"));
  await waitFor(() => assert.equal(historyRow(scene, "Restored leaf").getAttribute("aria-current"), "page"));
  assert.equal(dom.window.location.search, "?session=restore-deep");
  const root = historyRow(scene, "Restored root").closest('[role="listitem"]');
  await click(control(root, "button", "Collapse forks"));
  await scene.settled();
  assert.equal(roles(scene.history(), "button", /^Restored leaf/).length, 0);
  assert.equal(roles(scene.history(), "button", /^Restored middle/).length, 0);
  assert.equal(dom.window.location.search, "?session=restore-deep");
});

test("outside navigation reveals a deep session after its catalog arrives and can reveal it again after leaving", async (t) => {
  const scene = await startSessionScene(t, recentRoots());
  await scene.settled();
  for (const conversation of oldChain()) scene.external.addConversation(conversation);
  let lists = 0;
  const catalog = scene.external.hold("sessions.list", () => ++lists === 2);
  await act(async () => scene.external.deepLink("restore-deep"));
  await waitFor(() => assert.equal(catalog.reached(), true));
  await waitFor(() => visibleText(scene.container, "restore-deep marker"));
  assert.equal(roles(scene.history(), "button", /^Restored leaf/).length, 0);
  await act(async () => catalog.release());
  await waitFor(() => assert.equal(historyRow(scene, "Restored leaf").getAttribute("aria-current"), "page"));
  const parent = historyRow(scene, "Restored root").closest('[role="listitem"]');
  await click(control(parent, "button", "Collapse forks"));
  await act(async () => scene.external.updateSession("restore-deep", { name: "Restored leaf updated" }));
  await scene.settled();
  assert.equal(
    roles(scene.history(), "button", /^Restored leaf/).length,
    0,
    "catalog updates do not undo manual collapse",
  );
  await click(control(scene.navigation(), "button", "New session"));
  await waitFor(() => assert.equal(dom.window.location.search, ""));
  await act(async () => scene.external.deepLink("restore-deep"));
  await waitFor(() => assert.equal(historyRow(scene, "Restored leaf updated").getAttribute("aria-current"), "page"));
});

test("returning from an uncatalogued outside target reveals the previous deep session before the catalog arrives", async (t) => {
  const scene = await startSessionScene(t, [...recentRoots(), ...oldChain()], { initialSession: "restore-deep" });
  await waitFor(() => assert.equal(historyRow(scene, "Restored leaf").getAttribute("aria-current"), "page"));
  const parent = () => historyRow(scene, "Restored root").closest('[role="listitem"]');
  await click(control(parent(), "button", "Collapse forks"));
  await scene.settled();
  assert.equal(roles(scene.history(), "button", /^Restored leaf/).length, 0);
  scene.external.addConversation(treeSession("outside-target", { name: "Outside target" }));
  let lists = 0;
  const catalog = scene.external.hold("sessions.list", () => ++lists === 2);
  await act(async () => scene.external.deepLink("outside-target"));
  await waitFor(() => assert.equal(catalog.reached(), true));
  await waitFor(() => visibleText(scene.container, "outside-target marker"));
  assert.equal(dom.window.location.search, "?session=outside-target");
  assert.equal(roles(scene.history(), "button", /^Outside target/).length, 0);
  await act(async () => scene.external.deepLink("restore-deep"));
  await waitFor(() => visibleText(scene.container, "restore-deep marker"));
  await waitFor(() => assert.equal(historyRow(scene, "Restored leaf").getAttribute("aria-current"), "page"));
  await click(control(parent(), "button", "Collapse forks"));
  await act(async () => catalog.release());
  await scene.settled();
  assert.equal(
    roles(scene.history(), "button", /^Restored leaf/).length,
    0,
    "late catalog arrival does not undo another manual collapse",
  );
});

test("a selected orphan stays visible when missing ancestors arrive and later catalog updates respect manual collapse", async (t) => {
  const chain = oldChain();
  const scene = await startSessionScene(t, [...recentRoots(), chain[2]], { initialSession: "restore-deep" });
  await waitFor(() => assert.equal(historyRow(scene, "Restored leaf").getAttribute("aria-current"), "page"));
  await waitFor(() => assert.ok(scene.external.sessionChangedSubscribers() > 0));
  for (const ancestor of chain.slice(0, 2)) scene.external.addConversation(ancestor);
  await act(async () => {
    scene.external.updateSession("restore-root", {});
    scene.external.updateSession("restore-middle", {});
  });
  await waitFor(() => historyRow(scene, "Restored root"));
  await waitFor(() => assert.equal(historyRow(scene, "Restored leaf").getAttribute("aria-current"), "page"));
  const parent = historyRow(scene, "Restored root").closest('[role="listitem"]');
  await click(control(parent, "button", "Collapse forks"));
  await act(async () => scene.external.updateSession("restore-middle", { name: "Restored middle updated" }));
  await scene.settled();
  assert.equal(roles(scene.history(), "button", /^Restored leaf/).length, 0);
  assert.equal(dom.window.location.search, "?session=restore-deep");
});

test("a newly arriving outer ancestor does not reopen a deliberately collapsed branch or project", async (t) => {
  const chain = oldChain();
  const scene = await startSessionScene(t, [...recentRoots(), ...chain.slice(1)], { initialSession: "restore-deep" });
  await waitFor(() => assert.equal(historyRow(scene, "Restored leaf").getAttribute("aria-current"), "page"));
  const middle = () => historyRow(scene, "Restored middle").closest('[role="listitem"]');
  await click(control(middle(), "button", "Collapse forks"));
  const project = () => control(scene.history(), "button", "Default space");
  await click(project());
  assert.equal(project().getAttribute("aria-expanded"), "false");
  scene.external.addConversation(chain[0]);
  await act(async () => scene.external.updateSession("restore-root", {}));
  await scene.settled();
  assert.equal(project().getAttribute("aria-expanded"), "false", "new ancestry respects the closed project");
  await click(project());
  const root = historyRow(scene, "Restored root").closest('[role="listitem"]');
  assert.ok(control(root, "button", "Collapse forks"), "only the new outer ancestor was expanded");
  assert.ok(control(middle(), "button", "Expand forks"), "the known inner ancestor stays manually collapsed");
  assert.equal(roles(scene.history(), "button", /^Restored leaf/).length, 0);
  assert.equal(dom.window.location.search, "?session=restore-deep");
});

test("search clearing preserves manual expansion, manual collapse and the project's Load more choice", async (t) => {
  const scene = await startSessionScene(t, [...recentRoots(), ...oldChain()]);
  await waitFor(() => control(scene.history(), "button", "Load more sessions"));
  await click(control(scene.history(), "button", "Load more sessions"));
  const parent = () => historyRow(scene, "Restored root").closest('[role="listitem"]');
  await click(control(parent(), "button", "Expand forks"));
  assert.ok(historyRow(scene, "Restored middle"));
  const search = control(scene.navigation(), "searchbox", "Search sessions");
  await input(search, "restore-deep");
  assert.ok(historyRow(scene, "Restored leaf"));
  await click(control(parent(), "button", "Collapse forks"));
  assert.ok(historyRow(scene, "Restored leaf"), "search disclosure does not change manual state");
  await keyDown(search, "Escape");
  assert.ok(historyRow(scene, "Restored middle"));
  assert.equal(roles(scene.history(), "button", /^Restored leaf/).length, 0);
  await click(control(parent(), "button", "Collapse forks"));
  await input(search, "restore-deep");
  assert.ok(historyRow(scene, "Restored leaf"));
  await click(control(scene.navigation(), "button", "Clear session search"));
  assert.ok(historyRow(scene, "Restored root"), "Load more remains in effect");
  assert.equal(roles(scene.history(), "button", /^Restored middle/).length, 0);
  assert.equal(roles(scene.history(), "button", "Load more sessions").length, 0);
});

test("the Chinese project footer offers the same Load more behavior", async (t) => {
  const scene = await startSessionScene(t, [...recentRoots(), ...oldChain()], { language: "zh-CN" });
  const more = await waitFor(() => control(scene.history(), "button", "加载更多会话"));
  assert.match(more.textContent, /加载更多会话/);
  assert.match(more.querySelector(".type-mono-meta").textContent, /^[1-9]\d*$/);
  await click(more);
  assert.ok(control(scene.history(), "button", "Restored root"));
  assert.equal(roles(scene.history(), "button", "加载更多会话").length, 0);
  assert.equal(roles(scene.history(), "button", /^Restored middle/).length, 0);
});
