import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const {
  getSessionContentSnapshot,
  invalidateSessionContent,
  buildSessionHistoryPage,
  buildHistoryRevision,
  decodeHistoryCursor,
} = await importTestBundle("src/agent-host/session-content-cache", {
  packages: "external",
  stdin: {
    contents:
      'export * from "./session-content-cache.ts"; export { buildSessionHistoryPage, buildHistoryRevision, decodeHistoryCursor } from "./session-history.ts";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
});

test("content snapshots reuse stable files and invalidate on append or explicit removal", async () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "pi-session-content-"));
  const filePath = path.join(fixtureRoot, "session.jsonl");
  test.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const header = {
    type: "session",
    version: 3,
    id: "content-session",
    timestamp: "2026-08-06T00:00:00.000Z",
    cwd: fixtureRoot,
  };
  const user = {
    type: "message",
    id: "user",
    parentId: null,
    timestamp: "2026-08-06T00:00:01.000Z",
    message: { role: "user", content: "hello", timestamp: Date.parse("2026-08-06T00:00:01.000Z") },
  };
  writeFileSync(filePath, `${JSON.stringify(header)}\n${JSON.stringify(user)}\n`, "utf8");

  const first = await getSessionContentSnapshot(filePath);
  const reused = await getSessionContentSnapshot(filePath);
  assert.equal(reused.manager, first.manager);
  assert.equal(reused.entries.length, 1);

  appendFileSync(
    filePath,
    `${JSON.stringify({
      type: "message",
      id: "assistant",
      parentId: "user",
      timestamp: "2026-08-06T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        provider: "test",
        model: "test",
        timestamp: Date.parse("2026-08-06T00:00:02.000Z"),
      },
    })}\n`,
  );
  const appended = await getSessionContentSnapshot(filePath);
  assert.notEqual(appended.manager, first.manager);
  assert.equal(appended.entries.length, 2);

  invalidateSessionContent(filePath);
  const invalidated = await getSessionContentSnapshot(filePath);
  assert.notEqual(invalidated.manager, appended.manager);
  assert.equal(invalidated.entries.length, 2);
});

test("explicit invalidation during a read prevents that pending snapshot from being reused", async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pi-session-content-pending-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "session.jsonl");
  await fs.writeFile(
    file,
    JSON.stringify({
      type: "session",
      version: 3,
      id: "pending",
      cwd: directory,
      timestamp: "2026-08-06T00:00:00.000Z",
    }) + "\n",
  );
  const open = fs.open.bind(fs);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  let opened = false;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    if (!opened) {
      opened = true;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        entered.resolve();
        await release.promise;
      };
    }
    return handle;
  });
  const first = getSessionContentSnapshot(file);
  await entered.promise;
  invalidateSessionContent(file);
  const second = getSessionContentSnapshot(file);
  release.resolve();
  const [oldSnapshot, newSnapshot] = await Promise.all([first, second]);
  assert.notEqual(newSnapshot.manager, oldSnapshot.manager);
  assert.equal((await getSessionContentSnapshot(file)).manager, newSnapshot.manager);
});

test("live appends preserve the initial snapshot and appear on the next read", async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pi-session-content-live-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "session.jsonl");
  const header = { type: "session", version: 3, id: "live", cwd: directory, timestamp: "2026-01-01" };
  const entry = (id, parentId) => ({ type: "message", id, parentId, message: { role: "user", content: id } });
  const first = entry("first", null);
  const second = entry("second", "first");
  const initial = `${JSON.stringify(header)}\n${JSON.stringify(first)}\n`;
  await fs.writeFile(file, initial);
  const open = fs.open.bind(fs);
  let appended = false;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    if (args[0] === file && !appended) {
      appended = true;
      await fs.appendFile(file, `${JSON.stringify(second)}\n`);
    }
    return handle;
  });
  const snapshot = await getSessionContentSnapshot(file);
  assert.deepEqual(snapshot.entries, [first]);
  assert.equal(snapshot.fingerprint.size, Buffer.byteLength(initial));
  assert.deepEqual((await getSessionContentSnapshot(file)).entries, [first, second]);
});

test("legacy history cursors survive eviction without rewriting the original file", async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pi-session-legacy-cursor-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "legacy.jsonl");
  const timestamp = "2026-01-01T00:00:00.000Z";
  const entries = [{ type: "session", version: 1, id: "legacy", cwd: directory, timestamp }];
  for (let index = 0; index < 3; index += 1)
    entries.push({
      type: "message",
      timestamp,
      message: { role: "user", content: `question ${index}`, timestamp: index },
    });
  const raw = entries.map(JSON.stringify).join("\n") + "\n";
  await fs.writeFile(file, raw);
  const first = await getSessionContentSnapshot(file);
  const historyRevision = buildHistoryRevision(first.fingerprint, "legacy");
  const page = buildSessionHistoryPage({ entries: first.entries, historyWindow: { maxTurns: 1 }, historyRevision });
  assert.ok(page.previousCursor);
  for (let index = 0; index < 2; index += 1) {
    const other = path.join(directory, `other-${index}.jsonl`);
    await fs.writeFile(other, JSON.stringify({ ...entries[0], version: 3, id: `other-${index}` }) + "\n");
    await getSessionContentSnapshot(other);
  }
  const second = await getSessionContentSnapshot(file);
  assert.equal(buildHistoryRevision(second.fingerprint, "legacy"), historyRevision);
  const older = buildSessionHistoryPage({
    entries: second.entries,
    historyWindow: { maxTurns: 1 },
    historyRevision,
    cursor: decodeHistoryCursor(page.previousCursor),
  });
  assert.deepEqual(
    older.messages.map((message) => message.content),
    ["question 1"],
  );
  assert.deepEqual(
    second.entries.map((entry) => entry.id),
    first.entries.map((entry) => entry.id),
  );
  assert.equal(await fs.readFile(file, "utf8"), raw);
});
