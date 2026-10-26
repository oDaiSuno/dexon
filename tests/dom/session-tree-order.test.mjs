import assert from "node:assert/strict";
import test, { after } from "node:test";
import { precedes } from "../support/dom-queries.mjs";
import { act, control, historyRow, restoreGlobals, waitFor } from "../support/app-navigation.mjs";
import { startSessionScene } from "../support/session-tree-scene.mjs";
import { daysAgo, minutesAgo, treeSession } from "../fixtures/session-tree-data.mjs";

after(restoreGlobals);

function siblingTree() {
  return [
    treeSession("order-parent", {
      name: "Order parent",
      created: daysAgo(5),
      modified: daysAgo(5),
    }),
    treeSession("order-first", {
      name: "First child",
      parentSessionId: "order-parent",
      created: daysAgo(4),
      modified: minutesAgo(1),
    }),
    treeSession("order-second", {
      name: "Second child",
      parentSessionId: "order-parent",
      created: daysAgo(3),
      modified: daysAgo(2),
    }),
    treeSession("order-third", {
      name: "Third child",
      parentSessionId: "order-parent",
      created: daysAgo(2),
      modified: daysAgo(1),
    }),
  ];
}

function childrenInDocumentOrder(scene) {
  return ["First child", "Second child", "Third child"].map((title) => historyRow(scene, title));
}

test("siblings keep the order they were created in even when a later one was modified last", async (t) => {
  const scene = await startSessionScene(t, siblingTree());
  await waitFor(() => historyRow(scene, "Order parent"));
  const [first, second, third] = childrenInDocumentOrder(scene);
  assert.ok(precedes(first, second), "the first child stays above the second");
  assert.ok(precedes(second, third), "the second child stays above the third");
});

test("a child the Host reports as freshly modified keeps its place among its siblings", async (t) => {
  const scene = await startSessionScene(t, siblingTree());
  await waitFor(() => historyRow(scene, "Order parent"));
  await waitFor(() =>
    assert.ok(scene.external.sessionChangedSubscribers() > 0, "the sidebar listens for session changes"),
  );
  const before = historyRow(scene, "Third child").textContent;
  await act(async () => scene.external.updateSession("order-third", { modified: minutesAgo(0) }));
  await waitFor(() => {
    const row = historyRow(scene, "Third child");
    assert.notEqual(row.textContent, before, "the row shows the new modification time");
    assert.match(row.textContent, /now$/);
  });
  const [first, second, third] = childrenInDocumentOrder(scene);
  assert.ok(precedes(first, second), "the first child is still above the second");
  assert.ok(precedes(second, third), "the newly modified child did not jump up the list");
});

test("a tree whose root is ten days old but whose child was modified now is listed above a root modified a minute ago", async (t) => {
  const scene = await startSessionScene(t, [
    treeSession("group-root", { name: "Old root", created: daysAgo(20), modified: daysAgo(10) }),
    treeSession("group-child", {
      name: "Fresh child",
      parentSessionId: "group-root",
      created: daysAgo(9),
      modified: minutesAgo(0),
    }),
    treeSession("group-control", { name: "Fresh root", created: minutesAgo(2), modified: minutesAgo(1) }),
  ]);
  await waitFor(() => historyRow(scene, "Old root"));
  const freshRoot = control(scene.container, "button", "Fresh root");
  assert.ok(precedes(historyRow(scene, "Old root"), freshRoot), "the old root is ranked by its active child");
  assert.ok(precedes(historyRow(scene, "Fresh child"), freshRoot), "the active child stays with its root");
});

test("trees are ordered by the newest activity anywhere inside them", async (t) => {
  const scene = await startSessionScene(t, [
    treeSession("quiet-root", { name: "Quiet root", created: minutesAgo(5), modified: minutesAgo(5) }),
    treeSession("busy-root", { name: "Busy root", created: minutesAgo(9), modified: minutesAgo(6) }),
    treeSession("busy-child", {
      name: "Busy child",
      parentSessionId: "busy-root",
      created: minutesAgo(8),
      modified: minutesAgo(1),
    }),
  ]);
  await waitFor(() => historyRow(scene, "Quiet root"));
  assert.ok(
    precedes(historyRow(scene, "Busy root"), historyRow(scene, "Quiet root")),
    "the tree with the newer activity inside it comes first, even though its own root is the older one",
  );
});
