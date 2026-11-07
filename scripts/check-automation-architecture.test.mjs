import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), "dexon-automation-architecture-")));
test.after(() => rmSync(directory, { recursive: true, force: true }));
cpSync(path.join(root, "src"), path.join(directory, "src"), { recursive: true });
mkdirSync(path.join(directory, "scripts"));
mkdirSync(path.join(directory, "tests"));
for (const file of [
  "check-architecture.mjs",
  "css-sources.mjs",
  "capture-ui-previews.mjs",
  "check-desktop-security.mjs",
  "test-interactive-tools-electron.mjs",
])
  cpSync(path.join(root, "scripts", file), path.join(directory, "scripts", file));
cpSync(path.join(root, "scripts/desktop-security"), path.join(directory, "scripts/desktop-security"), {
  recursive: true,
});
const external = path.join(directory, "src/agent-host/external-automation-import.ts");
const sqlite = ["node", "sqlite"].join(":");
function check() {
  const result = spawnSync(process.execPath, [path.join(directory, "scripts/check-architecture.mjs"), "--strict"], {
    encoding: "utf8",
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

test("architecture CLI accepts public automation contracts and ignores test-only line budgets", () => {
  writeFileSync(external, 'import { createAutomationRuntime } from "./automation/index";\n');
  const testFile = path.join(directory, "src/agent-host/automation/long.test.ts");
  writeFileSync(testFile, "\n".repeat(501));
  const result = check();
  assert.equal(result.status, 0, result.output);
  rmSync(testFile);
  rmSync(external);
});

test("architecture CLI rejects every automation internal entry point outside its owner", () => {
  for (const module of [
    "core/run-machine",
    "store/index",
    "spec/normalize",
    "exec/executors",
    "scheduler",
    "runtime",
    "driver-pool",
  ]) {
    writeFileSync(external, `export * from "./automation/${module}";\n`);
    const result = check();
    assert.equal(result.status, 1, module);
    assert.match(result.output, /自动化公开入口/);
  }
  rmSync(external);
});

test("architecture CLI permits SQLite only in its designated database owner", () => {
  for (const source of [
    `import { DatabaseSync } from "${sqlite}";`,
    `import "${sqlite}";`,
    `const db = import("${sqlite}");`,
    `const db = require("${sqlite}");`,
  ]) {
    writeFileSync(external, source);
    const result = check();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /SQLite 唯一属主/);
  }
  rmSync(external);
});

test("architecture CLI enforces the automation implementation line budget in strict mode", () => {
  const file = path.join(directory, "src/agent-host/automation/oversized.ts");
  writeFileSync(file, "\n".repeat(501));
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.output, /自动化运行时与共享契约/);
  assert.match(result.output, /oversized.ts: 501 行/);
  rmSync(file);
});
