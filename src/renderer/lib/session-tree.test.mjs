import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionTree, sessionAncestorIds } from "./session-tree.ts";

function session(id, overrides = {}) {
  return {
    id,
    name: "",
    firstMessage: "",
    cwd: "/workspace/dexon",
    created: "2026-07-15T12:00:00.000Z",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

function ids(nodes) {
  return nodes.map((node) => node.session.id);
}

test("revealing a session returns its loaded ancestors nearest first without including the session", () => {
  const sessions = Object.freeze([
    session("root"),
    session("parent", { parentSessionId: "root" }),
    session("target", { parentSessionId: "parent" }),
    session("sibling", { parentSessionId: "root" }),
  ]);
  assert.deepEqual(sessionAncestorIds(sessions, "target"), ["parent", "root"]);
  assert.deepEqual(sessionAncestorIds(sessions, "root"), []);
  assert.deepEqual(sessionAncestorIds(sessions, "not-loaded"), []);
});

test("ancestor traversal stops at missing parents, self-links, and repeated ancestors", () => {
  const sessions = Object.freeze([
    session("a", { parentSessionId: "b" }),
    session("b", { parentSessionId: "a" }),
    session("tail", { parentSessionId: "a" }),
    session("self", { parentSessionId: "self" }),
    session("orphan", { parentSessionId: "missing" }),
  ]);
  assert.deepEqual(sessionAncestorIds(sessions, "a"), ["b"]);
  assert.deepEqual(sessionAncestorIds(sessions, "tail"), ["a", "b"]);
  assert.deepEqual(sessionAncestorIds(sessions, "self"), []);
  assert.deepEqual(sessionAncestorIds(sessions, "orphan"), []);
});

test("tree building accepts a readonly session list without reordering its caller's data", () => {
  const sessions = Object.freeze([
    Object.freeze(session("old", { modified: "2026-07-10T12:00:00.000Z" })),
    Object.freeze(session("new", { modified: "2026-07-15T12:00:00.000Z" })),
  ]);
  assert.deepEqual(ids(buildSessionTree(sessions)), ["new", "old"]);
  assert.deepEqual(
    sessions.map((item) => item.id),
    ["old", "new"],
  );
});

test("builds a flat forest sorted by most recent modification", () => {
  const tree = buildSessionTree([
    session("a", { modified: "2026-07-15T12:00:00.000Z" }),
    session("b", { modified: "2026-07-16T12:00:00.000Z" }),
  ]);
  assert.deepEqual(ids(tree), ["b", "a"]);
  assert.deepEqual(tree[0].children, []);
  assert.deepEqual(tree[1].children, []);
});

test("nests children under their existing parent and keeps every level in creation order", () => {
  const tree = buildSessionTree([
    session("parent-a", { created: "2026-07-10T12:00:00.000Z", modified: "2026-07-10T12:00:00.000Z" }),
    session("parent-b", { created: "2026-07-09T12:00:00.000Z", modified: "2026-07-14T12:00:00.000Z" }),
    session("child-late", {
      parentSessionId: "parent-a",
      created: "2026-07-12T12:00:00.000Z",
      modified: "2026-07-13T12:00:00.000Z",
    }),
    session("child-early", {
      parentSessionId: "parent-a",
      created: "2026-07-11T12:00:00.000Z",
      modified: "2026-07-11T12:00:00.000Z",
    }),
    session("child-of-b", {
      parentSessionId: "parent-b",
      created: "2026-07-13T12:00:00.000Z",
      modified: "2026-07-13T12:00:00.000Z",
    }),
  ]);
  assert.deepEqual(ids(tree), ["parent-b", "parent-a"]);
  const parentA = tree.find((node) => node.session.id === "parent-a");
  const parentB = tree.find((node) => node.session.id === "parent-b");
  assert.deepEqual(ids(parentA.children), ["child-early", "child-late"]);
  assert.deepEqual(ids(parentB.children), ["child-of-b"]);
});

test("roots are ordered by the newest activity anywhere inside them", () => {
  const tree = buildSessionTree([
    session("quiet-root", { created: "2026-07-10T12:00:00.000Z", modified: "2026-07-10T12:00:00.000Z" }),
    session("busy-root", { created: "2026-07-09T12:00:00.000Z", modified: "2026-07-09T12:00:00.000Z" }),
    session("busy-child", {
      parentSessionId: "busy-root",
      created: "2026-07-09T13:00:00.000Z",
      modified: "2026-07-16T12:00:00.000Z",
    }),
  ]);
  assert.deepEqual(ids(tree), ["busy-root", "quiet-root"]);
  assert.equal(tree[0].activity, "2026-07-16T12:00:00.000Z");
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
  const tree = buildSessionTree([
    session("a", { parentSessionId: "b", modified: "2026-07-10T12:00:00.000Z" }),
    session("b", { parentSessionId: "a", modified: "2026-07-11T12:00:00.000Z" }),
  ]);
  assert.deepEqual(ids(tree), []);
});
