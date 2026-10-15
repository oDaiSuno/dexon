import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectTestHygiene, findTestHygieneViolations } from "./test-hygiene.mjs";

const replacement = [
  "build.onResolve({ filter: /^@\\/lib\\/api-client$/ }, () => ({",
  '  path: "api", namespace: "virtual-api",',
  "}));",
].join("\n");

test("replacing an application module is rejected even without 'stub' in its name", () => {
  assert.ok(findTestHygieneViolations(replacement).includes("own-module-replacement"));
});

test("test helpers cannot hide an application module replacement", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dexon-hygiene-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src/example.test.mjs"), 'import "./helper.mjs";');
  writeFileSync(path.join(root, "src/helper.mjs"), replacement);
  const result = collectTestHygiene(root);
  assert.deepEqual(
    result.blocking.map((entry) => entry.file),
    ["src/helper.mjs"],
  );
});

test("real package path normalization and network doubles are not application replacements", () => {
  const source = [
    "build.onResolve({filter: /react-syntax-highlighter/}, args => ({path: `${args.path}.js`, external: true}));",
    "globalThis.fetch = async () => ({ok: true});",
    'build.onResolve({filter: /^electron$/}, () => ({path: "electron", namespace: "platform"}));',
  ].join("\n");
  assert.deepEqual(findTestHygieneViolations(source), []);
});

test("test-only getters cannot replace observation through a public interface", () => {
  for (const source of ["getMarkdownComponentIdentityForTest();", "store.keysForTest();", "registry.sizeForTest();"]) {
    assert.ok(findTestHygieneViolations(source).includes("test-only-introspection"));
  }
});

test("a component's implementation marker is not a reader-visible behavior", () => {
  assert.ok(
    findTestHygieneViolations("assert.equal(MessageView.$$typeof, marker);").includes(
      "component-implementation-marker",
    ),
  );
});

test("a guard's example string is data, not an active module replacement", () => {
  assert.deepEqual(findTestHygieneViolations(`const example = ${JSON.stringify(replacement)};`), []);
});

test("private React event discovery is rejected instead of impersonating page input", () => {
  const source =
    'const key = Object.keys(element).find(name => name.startsWith("__reactProps$")); element[key].onChange(event);';
  assert.ok(findTestHygieneViolations(source).includes("react-private-event-access"));
});

test("exact active browser-resource counts cannot stand in for page behavior", () => {
  for (const source of [
    "assert.equal(h.env.resizeObservers.length, 1);",
    'assert.equal(env.windowListeners.get("resize").length, 2);',
    "assert.equal(harness.rafSize(), 1);",
    "assert.equal(timers.length, 3);",
  ])
    assert.ok(findTestHygieneViolations(source).includes("active-resource-count"), source);
  assert.deepEqual(findTestHygieneViolations("assert.equal(harness.rafSize(), 0);"), []);
  assert.deepEqual(findTestHygieneViolations("assert.equal(response.items.length, 3);"), []);
  assert.deepEqual(findTestHygieneViolations("assert.equal(tracker.listeners.size, 2);"), []);
});

test("counting a queried element's direct children is not a record-retention assertion", () => {
  assert.ok(
    findTestHygieneViolations(
      'const log = document.querySelector("[role=log]"); assert.equal(log.children.length, 2000);',
    ).includes("dom-structure-count"),
  );
  assert.deepEqual(
    findTestHygieneViolations("assert.equal(result.children.length, 3);"),
    [],
    "a public data tree is not a DOM wrapper",
  );
  assert.deepEqual(findTestHygieneViolations('const example = "assert.equal(log.children.length, 2000)";'), []);
});

test("direct React private property access is rejected without banning literal examples", () => {
  for (const source of ["element.__reactProps$hash.onClick(event);", 'element["__reactProps$hash"].onChange(event);'])
    assert.ok(findTestHygieneViolations(source).includes("react-private-event-access"));
  assert.deepEqual(findTestHygieneViolations('const example = "element.__reactProps$hash.onClick(event)";'), []);
  assert.deepEqual(findTestHygieneViolations('element.dispatchEvent(new Event("input", {bubbles: true}));'), []);
});
