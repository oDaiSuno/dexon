import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("./test-global-guard.mjs", import.meta.url));

function runWithGuard(t, source) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "dexon-global-guard-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "example.test.mjs");
  writeFileSync(file, source);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--import", guard, "--test", file], {
    cwd: directory,
    env: environment,
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("a test that leaves a borrowed global behind fails and names the test and the global", (t) => {
  const { status, output } = runWithGuard(
    t,
    [
      'import test from "node:test";',
      'test("borrows fetch and forgets it", () => {',
      "  globalThis.fetch = async () => 'replacement';",
      "});",
      'test("a later test", () => {});',
    ].join("\n"),
  );
  assert.notEqual(status, 0, output);
  assert.match(output, /GLOBAL_LEAK test "borrows fetch and forgets it" left: fetch/);
});

test("a test that removes an existing global and never puts it back fails", (t) => {
  const { status, output } = runWithGuard(
    t,
    [
      'import test from "node:test";',
      'test("removes fetch to simulate an old runtime", () => {',
      "  delete globalThis.fetch;",
      "});",
      'test("a later test", () => {});',
    ].join("\n"),
  );
  assert.notEqual(status, 0, output);
  assert.match(output, /GLOBAL_LEAK test "removes fetch to simulate an old runtime" left: fetch/);
});

test("setup outside any test that leaves a global behind fails at the end of the file", (t) => {
  const { status, output } = runWithGuard(
    t,
    [
      'import test from "node:test";',
      "const originalWindow = globalThis.window;",
      "globalThis.window = { matchMedia: () => ({ matches: true }) };",
      "globalThis.window = originalWindow;",
      'test("uses the module set up above", () => {});',
    ].join("\n"),
  );
  assert.notEqual(status, 0, output);
  assert.match(output, /GLOBAL_LEAK file setup or teardown left: window/);
});

test("a test that puts back what it borrowed, including a global that did not exist, passes", (t) => {
  const { status, output } = runWithGuard(
    t,
    [
      'import test from "node:test";',
      'test("borrows fetch and window, then restores both", (context) => {',
      "  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');",
      "  globalThis.fetch = async () => 'replacement';",
      "  globalThis.window = { location: { pathname: '/' } };",
      "  context.after(() => {",
      "    Object.defineProperty(globalThis, 'fetch', originalFetch);",
      "    delete globalThis.window;",
      "  });",
      "});",
      'test("a later test", () => {});',
    ].join("\n"),
  );
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /GLOBAL_LEAK/);
});
