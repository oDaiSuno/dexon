import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName, precedes } from "../support/dom-queries.mjs";
import { click, control, historyRow, restoreGlobals, roles, waitFor } from "../support/app-navigation.mjs";
import { startSessionScene } from "../support/session-tree-scene.mjs";
import { daysAgo, minutesAgo, treeSession } from "../fixtures/session-tree-data.mjs";

after(restoreGlobals);

const branchOf = (scene, title) => historyRow(scene, title).closest("[data-session-branch]");
const indentOf = (scene, title) => branchOf(scene, title).style.paddingLeft;

function depthChain() {
  const sessions = [];
  for (let level = 0; level < 6; level += 1) {
    sessions.push(
      treeSession(`depth-${level}`, {
        name: `Depth ${level}`,
        created: minutesAgo(30 - level),
        modified: minutesAgo(25 - level),
        ...(level === 0 ? {} : { parentSessionId: `depth-${level - 1}` }),
      }),
    );
  }
  return sessions;
}

test("a forked session and a session created by another session carry different relation markers", async (t) => {
  const scene = await startSessionScene(t, [
    treeSession("rel-root", { name: "Relation root", created: daysAgo(3), modified: daysAgo(3) }),
    treeSession("rel-fork", {
      name: "Forked child",
      parentSessionId: "rel-root",
      relation: "fork",
      created: daysAgo(2),
      modified: daysAgo(2),
    }),
    treeSession("rel-delegate", {
      name: "Delegated child",
      parentSessionId: "rel-root",
      relation: "delegate",
      createdBySessionId: "rel-root",
      created: daysAgo(1),
      modified: daysAgo(1),
    }),
  ]);
  await waitFor(() => historyRow(scene, "Relation root"));
  const fork = accessibleName(historyRow(scene, "Forked child"));
  const delegate = accessibleName(historyRow(scene, "Delegated child"));
  assert.match(fork, /Forked session/, "a copy of the conversation is announced as a fork");
  assert.match(delegate, /Created by session/, "a session opened by another session is announced as delegated");
  assert.doesNotMatch(fork, /Created by session/, "the two relations are never confused");
  assert.doesNotMatch(delegate, /Forked session/, "the two relations are never confused");
});

test("a chain six levels deep renders, and the indent stops growing after the third level", async (t) => {
  const scene = await startSessionScene(t, depthChain());
  await waitFor(() => historyRow(scene, "Depth 0"));
  const rows = [0, 1, 2, 3, 4, 5].map((level) => historyRow(scene, `Depth ${level}`));
  for (let level = 1; level < rows.length; level += 1)
    assert.ok(precedes(rows[level - 1], rows[level]), `Depth ${level} stays below Depth ${level - 1}`);
  assert.ok(indentOf(scene, "Depth 1") !== indentOf(scene, "Depth 0"), "depth still changes the indent at first");
  assert.ok(indentOf(scene, "Depth 3") !== indentOf(scene, "Depth 2"));
  assert.equal(indentOf(scene, "Depth 4"), indentOf(scene, "Depth 3"), "the fourth level stops indenting");
  assert.equal(indentOf(scene, "Depth 5"), indentOf(scene, "Depth 3"), "the fifth level keeps the same indent");
});

test("a tree of forks still nests and folds the way it did before", async (t) => {
  const scene = await startSessionScene(t, [
    treeSession("fork-root", { name: "Fork root", created: daysAgo(3), modified: daysAgo(3) }),
    treeSession("fork-child", {
      name: "Fork child",
      parentSessionId: "fork-root",
      relation: "fork",
      created: daysAgo(2),
      modified: daysAgo(2),
    }),
  ]);
  await waitFor(() => historyRow(scene, "Fork root"));
  assert.equal(accessibleName(historyRow(scene, "Fork root")), "Fork root", "a root shows no relation marker");
  assert.ok(precedes(historyRow(scene, "Fork root"), historyRow(scene, "Fork child")));
  await click(control(scene.history(), "button", "Collapse forks"));
  await waitFor(() => assert.equal(roles(scene.history(), "button", /^Fork child/).length, 0));
  await click(control(scene.history(), "button", "Expand forks"));
  await waitFor(() => historyRow(scene, "Fork child"));
});
