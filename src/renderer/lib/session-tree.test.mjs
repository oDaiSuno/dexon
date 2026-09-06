import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionTree } from "./session-tree.ts";

function session(id, overrides = {}) {
  return {
    id,
    name: "",
    firstMessage: "",
    cwd: "/workspace/dexon",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

function ids(nodes) {
  return nodes.map((node) => node.session.id);
}

test("builds a flat forest sorted by most recent modification", () => {
  const tree = buildSessionTree([
    session("a", { modified: "2026-07-15T12:00:00.000Z" }),
    session("b", { modified: "2026-07-16T12:00:00.000Z" }),
  ]);
  assert.deepEqual(ids(tree), ["b", "a"]);
  assert.deepEqual(tree[0].children, []);
  assert.deepEqual(tree[1].children, []);
});

test("nests children under their existing parent and sorts every level", () => {
  const tree = buildSessionTree([
    session("parent-a", { modified: "2026-07-10T12:00:00.000Z" }),
    session("parent-b", { modified: "2026-07-14T12:00:00.000Z" }),
    session("child-late", { parentSessionId: "parent-a", modified: "2026-07-12T12:00:00.000Z" }),
    session("child-early", { parentSessionId: "parent-a", modified: "2026-07-11T12:00:00.000Z" }),
    session("child-of-b", { parentSessionId: "parent-b", modified: "2026-07-13T12:00:00.000Z" }),
  ]);
  assert.deepEqual(ids(tree), ["parent-b", "parent-a"]);
  const parentA = tree.find((node) => node.session.id === "parent-a");
  const parentB = tree.find((node) => node.session.id === "parent-b");
  assert.deepEqual(ids(parentA.children), ["child-late", "child-early"]);
  assert.deepEqual(ids(parentB.children), ["child-of-b"]);
});

test("nests a multi-generation chain through each direct parent", () => {
  const tree = buildSessionTree([
    session("root", { modified: "2026-07-10T12:00:00.000Z" }),
    session("child", { parentSessionId: "root", modified: "2026-07-11T12:00:00.000Z" }),
    session("grandchild", { parentSessionId: "child", modified: "2026-07-12T12:00:00.000Z" }),
  ]);
  assert.deepEqual(ids(tree), ["root"]);
  const [root] = tree;
  assert.deepEqual(ids(root.children), ["child"]);
  assert.deepEqual(ids(root.children[0].children), ["grandchild"]);
});

test("a session whose direct parent is missing stays at root level", () => {
  const tree = buildSessionTree([
    session("root", { modified: "2026-07-10T12:00:00.000Z" }),
    session("orphan", { parentSessionId: "not-loaded", modified: "2026-07-11T12:00:00.000Z" }),
  ]);
  assert.deepEqual(ids(tree), ["orphan", "root"]);
  assert.deepEqual(tree[0].children, []);
  assert.deepEqual(tree[1].children, []);
});

test("sessions whose parents reference each other stay out of the root list", () => {
  // Documents current behavior: mutual parentSessionId references hide both
  // sessions from the rendered tree instead of surfacing them as roots.
  const tree = buildSessionTree([
    session("a", { parentSessionId: "b", modified: "2026-07-10T12:00:00.000Z" }),
    session("b", { parentSessionId: "a", modified: "2026-07-11T12:00:00.000Z" }),
  ]);
  assert.deepEqual(ids(tree), []);
});
