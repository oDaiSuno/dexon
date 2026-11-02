import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName } from "../support/dom-queries.mjs";
import { act, click, control, historyRow, restoreGlobals, roles, waitFor } from "../support/app-navigation.mjs";
import { startSessionScene } from "../support/session-tree-scene.mjs";
import { minutesAgo, treeSession } from "../fixtures/session-tree-data.mjs";

after(restoreGlobals);

const AWAITING = "Waiting for your answer";
const FAILED = "Failed";

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

test("an unread parent shows its waiting child's indicator while the forks are collapsed", async (t) => {
  const scene = await openMixedTree(t);
  await act(async () =>
    scene.external.running(["agg-parent", "agg-run-1", "agg-run-2"], {
      ...MIXED_STATUSES,
      "agg-parent": "running",
    }),
  );
  await act(async () => scene.external.running(["agg-run-1", "agg-run-2"], MIXED_STATUSES));
  await waitFor(() => assert.match(accessibleName(historyRow(scene, "Aggregate parent")), /New activity/));
  await click(control(scene.history(), "button", "Collapse forks"));
  const parent = historyRow(scene, "Aggregate parent");
  assert.ok(
    parent.querySelector('[aria-label="Waiting for your answer"]'),
    "the waiting child owns the visible status",
  );
  assert.equal(parent.querySelector('[aria-label="New session activity"]'), null);
  assert.match(accessibleName(parent), /1 waiting for your answer/);
  assert.match(accessibleName(parent), /2 running/);
});

for (const [own, childStatus, label] of [
  ["unread", "error", "Failed"],
  ["running", "awaiting_input", "Waiting for your answer"],
  ["running", "error", "Failed"],
]) {
  test(`a collapsed parent in ${own} yields its visible indicator to child status ${childStatus}`, async (t) => {
    const scene = await startSessionScene(t, [
      treeSession("urgent-parent", { name: "Parent task", created: minutesAgo(30), modified: minutesAgo(30) }),
      treeSession("urgent-child", { name: "Child task", parentSessionId: "urgent-parent", created: minutesAgo(29) }),
    ]);
    await waitFor(() => historyRow(scene, "Parent task"));
    await act(async () =>
      scene.external.running(["urgent-parent"], {
        "urgent-parent": "running",
        "urgent-child": childStatus,
      }),
    );
    if (own === "unread") {
      await act(async () => scene.external.running([], { "urgent-child": childStatus }));
      assert.match(accessibleName(historyRow(scene, "Parent task")), /New activity/);
    }
    await click(control(scene.history(), "button", "Collapse forks"));
    const parent = historyRow(scene, "Parent task");
    assert.ok(parent.querySelector(`[aria-label="${label}"]`));
    assert.equal(parent.querySelector('[aria-label="New session activity"]'), null);
    assert.equal(parent.querySelector('[aria-label="Agent running"]'), null);
  });
}

test("unread descendants keep their dot on their own row instead of bubbling it to a collapsed parent", async (t) => {
  const scene = await startSessionScene(t, [
    treeSession("read-parent", { name: "Read parent", created: minutesAgo(30), modified: minutesAgo(30) }),
    treeSession("unread-child", { name: "Unread child", parentSessionId: "read-parent", created: minutesAgo(29) }),
  ]);
  await waitFor(() => historyRow(scene, "Read parent"));
  await act(async () => scene.external.running(["unread-child"]));
  await act(async () => scene.external.running([]));
  assert.ok(historyRow(scene, "Unread child").querySelector('[aria-label="New session activity"]'));
  await click(control(scene.history(), "button", "Collapse forks"));
  const parent = historyRow(scene, "Read parent");
  assert.equal(parent.querySelector('[aria-label="New session activity"]'), null);
  assert.equal(parent.querySelector('[aria-label="Agent running"]'), null);
});

test("clearing a background failure never exposes a false unread dot in the history", async (t) => {
  const scene = await startSessionScene(t, [treeSession("failed-background", { name: "Background failure" })]);
  await waitFor(() => historyRow(scene, "Background failure"));
  await act(async () => scene.external.running(["failed-background"]));
  await act(async () => scene.external.running([], { "failed-background": "error" }));
  assert.ok(historyRow(scene, "Background failure").querySelector('[aria-label="Failed"]'));
  await act(async () => scene.external.running([]));
  const row = historyRow(scene, "Background failure");
  assert.equal(row.querySelector('[aria-label="New session activity"]'), null);
  assert.equal(row.querySelector('[aria-label="Failed"]'), null);
  assert.equal(accessibleName(row), "Background failure");
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
