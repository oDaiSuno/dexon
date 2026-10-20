import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName } from "../support/dom-queries.mjs";
import { act, click, control, historyRow, restoreGlobals, roles, waitFor } from "../support/app-navigation.mjs";
import { startSessionScene } from "../support/session-tree-scene.mjs";
import { minutesAgo, treeSession } from "../fixtures/session-tree-data.mjs";

after(restoreGlobals);

const AWAITING = "Waiting for your answer";
const FAILED = "Last turn failed";

function mixedTree() {
  return [
    treeSession("agg-parent", { name: "Aggregate parent", created: minutesAgo(30), modified: minutesAgo(30) }),
    treeSession("agg-wait", {
      name: "Waiting child",
      parentSessionId: "agg-parent",
      created: minutesAgo(29),
      modified: minutesAgo(5),
    }),
    treeSession("agg-run-1", {
      name: "Running child one",
      parentSessionId: "agg-parent",
      created: minutesAgo(28),
      modified: minutesAgo(4),
    }),
    treeSession("agg-run-2", {
      name: "Running child two",
      parentSessionId: "agg-parent",
      created: minutesAgo(27),
      modified: minutesAgo(3),
    }),
  ];
}

const MIXED_STATUSES = {
  "agg-wait": "awaiting_input",
  "agg-run-1": "running",
  "agg-run-2": "running",
};

async function openMixedTree(t) {
  const scene = await startSessionScene(t, mixedTree());
  await waitFor(() => historyRow(scene, "Aggregate parent"));
  await act(async () => scene.external.running(["agg-run-1", "agg-run-2"], MIXED_STATUSES));
  await waitFor(() =>
    assert.match(accessibleName(historyRow(scene, "Waiting child")), new RegExp(AWAITING), "the child shows it waits"),
  );
  return scene;
}

test("a collapsed parent shows the most urgent status inside it together with the counts", async (t) => {
  const scene = await openMixedTree(t);
  await click(control(scene.history(), "button", "Collapse forks"));
  await waitFor(() => assert.equal(roles(scene.history(), "button", /^Waiting child/).length, 0));
  const name = accessibleName(historyRow(scene, "Aggregate parent"));
  assert.match(name, new RegExp(AWAITING), "the most urgent descendant status is the one the row shows");
  assert.match(name, /1 waiting for your answer/, "the row counts the child that waits");
  assert.match(name, /2 running/, "the row counts the two children that run");
  assert.doesNotMatch(name, /1 running/, "children that run are not miscounted");
});

test("an expanded parent shows no descendant status and each child shows only its own", async (t) => {
  const scene = await openMixedTree(t);
  assert.equal(accessibleName(historyRow(scene, "Aggregate parent")), "Aggregate parent");
  assert.match(accessibleName(historyRow(scene, "Running child one")), /Agent running/);
  assert.doesNotMatch(accessibleName(historyRow(scene, "Running child one")), new RegExp(AWAITING));
  assert.match(accessibleName(historyRow(scene, "Waiting child")), new RegExp(AWAITING));
  assert.doesNotMatch(accessibleName(historyRow(scene, "Waiting child")), /Agent running/);
});

test("a collapsed parent whose only busy descendant waits for the user says so from outside", async (t) => {
  const scene = await startSessionScene(t, [
    treeSession("quiet-parent", { name: "Quiet parent", created: minutesAgo(30), modified: minutesAgo(30) }),
    treeSession("quiet-idle", {
      name: "Idle child",
      parentSessionId: "quiet-parent",
      created: minutesAgo(29),
      modified: minutesAgo(20),
    }),
    treeSession("quiet-wait", {
      name: "Asking child",
      parentSessionId: "quiet-parent",
      created: minutesAgo(28),
      modified: minutesAgo(6),
    }),
  ]);
  await waitFor(() => historyRow(scene, "Quiet parent"));
  await act(async () => scene.external.running([], { "quiet-wait": "awaiting_input" }));
  await waitFor(() => assert.match(accessibleName(historyRow(scene, "Asking child")), new RegExp(AWAITING)));
  await click(control(scene.history(), "button", "Collapse forks"));
  await waitFor(() => assert.equal(roles(scene.history(), "button", /^Asking child/).length, 0));
  const name = accessibleName(historyRow(scene, "Quiet parent"));
  assert.match(name, new RegExp(AWAITING));
  assert.match(name, /1 waiting for your answer/);
});

test("a live status frame shows the waiting indicator and the failure indicator on their own rows", async (t) => {
  const scene = await startSessionScene(t, [
    treeSession("status-waiting", { name: "Waiting root", created: minutesAgo(20), modified: minutesAgo(7) }),
    treeSession("status-failed", { name: "Failed root", created: minutesAgo(19), modified: minutesAgo(6) }),
  ]);
  await waitFor(() => historyRow(scene, "Waiting root"));
  await act(async () => scene.external.running([], { "status-waiting": "awaiting_input", "status-failed": "error" }));
  await waitFor(() => assert.match(accessibleName(historyRow(scene, "Waiting root")), new RegExp(AWAITING)));
  assert.match(accessibleName(historyRow(scene, "Failed root")), new RegExp(FAILED));
  assert.doesNotMatch(accessibleName(historyRow(scene, "Waiting root")), new RegExp(FAILED));
  assert.doesNotMatch(accessibleName(historyRow(scene, "Failed root")), new RegExp(AWAITING));
});
