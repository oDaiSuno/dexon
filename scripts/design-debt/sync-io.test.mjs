import assert from "node:assert/strict";
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkSyncIo } from "./sync-io.mjs";

const file = "src/agent-host/handlers/example.ts";

function fixture(t, source, ledger = [], extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "pi-sync-io-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries({ [file]: source, ...extra })) {
    const destination = path.join(root, name);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, text);
  }
  return { root, ledger };
}

const allowance = (symbol, count) => ({ file, symbol, count, reason: "Fixture synchronous boundary" });

test("the live repository exactly matches its synchronous I/O ledger", () => {
  assert.deepEqual(checkSyncIo(), []);
});

for (const symbol of ["readFileSync", "realpathSync"]) {
  test(`a zero-allowance handler rejects ${symbol} with its exact location`, (t) => {
    const failures = checkSyncIo(fixture(t, `import { ${symbol} } from "node:fs";\n\n${symbol}("fixture");\n`));
    assert.equal(failures.length, 1);
    assert.match(failures[0], /src\/agent-host\/handlers\/example\.ts:3/);
    assert.ok(failures[0].includes(symbol));
    assert.match(failures[0], /node:fs\/promises/);
  });
}

test("increasing a registered count fails and reports both sites", (t) => {
  const source = 'import fs from "fs";\nfs.readFileSync("a");\nfs.readFileSync("b");';
  const failures = checkSyncIo(fixture(t, source, [allowance("readFileSync", 1)]));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /example\.ts:2,3/);
  assert.match(failures[0], /2.*1/);
});

test("decreasing a registered count requires lowering the ledger, including removal of the last site", (t) => {
  const source = 'import { statSync } from "node:fs";\nstatSync("a");';
  const failures = checkSyncIo(fixture(t, source, [allowance("statSync", 2)]));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /sync-io-ledger\.json/);
  assert.match(failures[0], /2.*1/);
  assert.deepEqual(checkSyncIo(fixture(t, source, [allowance("statSync", 1)])), []);
  assert.match(checkSyncIo(fixture(t, "", [allowance("statSync", 1)]))[0], /删/);
});

test("aliases and native realpaths count, while strings, foreign properties and shadowed imports do not", (t) => {
  const source = [
    'import { readFileSync as read, realpathSync } from "node:fs";',
    'import * as disk from "fs";',
    'import promises from "node:fs/promises";',
    "const unrelated = { readFileSync() {} };",
    "unrelated.readFileSync();",
    'const text = "readFileSync(file)";',
    'function local(read) { read("not fs"); }',
    'read("a");',
    'realpathSync.native("b");',
    'disk["statSync"]("c");',
    'promises.readFile("d");',
  ].join("\n");
  const failures = checkSyncIo(fixture(t, source));
  assert.equal(failures.length, 3);
  assert.match(
    failures.find((failure) => failure.includes("readFileSync")),
    /example\.ts:8/,
  );
  assert.match(
    failures.find((failure) => failure.includes("realpathSync")),
    /example\.ts:9/,
  );
  assert.match(
    failures.find((failure) => failure.includes("statSync")),
    /example\.ts:10/,
  );
});

test("tests and support fixtures are excluded but shared worktree and nested mjs files are checked", (t) => {
  const source = 'import fs from "node:fs"; fs.openSync("a");';
  const options = fixture(t, "", [], {
    "src/agent-host/example.test.ts": source,
    "src/agent-host/example-test-support.mjs": source,
    "src/agent-host/schema-cases.mjs": source,
    "src/agent-host/nested/task.mjs": source,
    "src/shared/worktree.ts": source,
    "src/shared/unrelated.ts": source,
  });
  const failures = checkSyncIo(options);
  assert.equal(failures.length, 2);
  assert.ok(failures.some((failure) => failure.startsWith("src/shared/worktree.ts:1")));
  assert.ok(failures.some((failure) => failure.startsWith("src/agent-host/nested/task.mjs:1")));
});

test("duplicate entries and allowances without reasons fail", (t) => {
  const entry = allowance("statSync", 1);
  const source = 'import { statSync } from "node:fs"; statSync("a");';
  assert.match(checkSyncIo(fixture(t, source, [entry, entry]))[0], /重复/);
  assert.match(checkSyncIo(fixture(t, source, [{ ...entry, reason: "" }]))[0], /原因/);
});

test("local filesystem aliases count each call exactly once without treating foreign require functions as fs", (t) => {
  const source = [
    'import fs from "node:fs";',
    "const read = fs.readFileSync;",
    'read("first");',
    'read("second");',
    'function foreign(require) { require("fs").readFileSync("not fs"); }',
  ].join("\n");
  assert.deepEqual(checkSyncIo(fixture(t, source, [allowance("readFileSync", 2)])), []);
  const failures = checkSyncIo(fixture(t, source));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /example\.ts:3,4/);
});

test("the scanner does not read ambient type packages outside its explicit source scope", (t) => {
  const options = fixture(t, 'import fs from "node:fs"; fs.statSync("file");', [allowance("statSync", 1)], {
    "node_modules/@types/irrelevant/package.json": JSON.stringify({ name: "@types/irrelevant", types: "index.d.ts" }),
    "node_modules/@types/irrelevant/index.d.ts": "declare const unrelated: unknown;",
  });
  const read = fs.readFileSync;
  const outsideReads = [];
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (String(file).includes("node_modules")) outsideReads.push(String(file));
    return read(file, ...args);
  });
  assert.deepEqual(checkSyncIo(options), []);
  assert.deepEqual(outsideReads, []);
});
