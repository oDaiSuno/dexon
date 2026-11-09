import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import path from "node:path";
import test from "node:test";
import { clearImmediate } from "node:timers";

const fixtureRoot = mkdtempSync(path.join(tmpdir(), "pi-session-index-"));
const sessionsRoot = path.join(fixtureRoot, "sessions");
const projectRoot = path.join(fixtureRoot, "project");
mkdirSync(path.join(sessionsRoot, "project"), { recursive: true });
mkdirSync(projectRoot, { recursive: true });
process.env.PI_CODING_AGENT_SESSION_DIR = sessionsRoot;
process.env.PI_CODING_AGENT_DIR = fixtureRoot;
test.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { SessionIndex, sessionIndex, listAllSessions, invalidateAllowedRootsCache, setAllowedRootsWatcherHealthy } =
  await importTestBundle("src/agent-host/session-index", {
    packages: "external",
    stdin: {
      contents:
        'export { SessionIndex, sessionIndex } from "./session-index"; export { listAllSessions } from "./session-reader"; export { invalidateAllowedRootsCache, setAllowedRootsWatcherHealthy } from "../shared/allowed-roots";',
      resolveDir: import.meta.dirname,
    },
  });
const cachePath = path.join(fixtureRoot, "desktop", "session-index-cache.json");
const journalPath = path.join(path.dirname(cachePath), "session-index.v2.jsonl");

test.beforeEach(() => {
  rmSync(sessionsRoot, { recursive: true, force: true });
  mkdirSync(path.join(sessionsRoot, "project"), { recursive: true });
  rmSync(cachePath, { force: true });
  rmSync(journalPath, { force: true });
  setAllowedRootsWatcherHealthy(false);
  invalidateAllowedRootsCache();
});

function writeSession(id, options = {}) {
  const filePath = path.join(sessionsRoot, "project", `${id}.jsonl`);
  const timestamp = options.timestamp ?? "2026-08-06T00:00:00.000Z";
  const entries = [
    {
      type: "session",
      version: 3,
      id,
      timestamp,
      cwd: projectRoot,
      ...(options.parentSession ? { parentSession: options.parentSession } : {}),
    },
    {
      type: "message",
      id: `${id}-user`,
      parentId: null,
      timestamp,
      message: { role: "user", content: options.message ?? id, timestamp: Date.parse(timestamp) },
    },
  ];
  writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  return filePath;
}

test("refreshAll reuses unchanged records and derives parent ids", async () => {
  const parentPath = writeSession("parent", { timestamp: "2026-08-01T00:00:00.000Z" });
  writeSession("child", { timestamp: "2026-08-02T00:00:00.000Z", parentSession: parentPath });
  const index = new SessionIndex();
  await Promise.all([index.refreshAll(), index.refreshAll()]);
  assert.equal(index.getMetrics().filesParsed, 2);
  const first = await index.getAll();
  assert.equal(first.find((session) => session.id === "child").parentSessionId, "parent");
  const piSessions = await SessionManager.listAll();
  for (const indexed of first) {
    const piSession = piSessions.find((session) => session.id === indexed.id);
    assert.ok(piSession);
    assert.equal(indexed.cwd, piSession.cwd);
    assert.equal(indexed.name, piSession.name);
    assert.equal(indexed.created, piSession.created.toISOString());
    assert.equal(indexed.modified, piSession.modified.toISOString());
    assert.equal(indexed.messageCount, piSession.messageCount);
    assert.equal(indexed.firstMessage, piSession.firstMessage);
  }

  await index.refreshAll();
  assert.deepEqual(index.getMetrics(), {
    filesDiscovered: 2,
    filesParsed: 0,
    filesReused: 2,
    invalidFiles: 0,
    totalMs: index.getMetrics().totalMs,
  });
});

test("refreshPath updates only one changed file and removePath deletes it", async () => {
  writeSession("parent");
  const index = new SessionIndex();
  await index.refreshAll();
  const parentPath = await index.resolvePath("parent");
  appendFileSync(
    parentPath,
    `${JSON.stringify({
      type: "session_info",
      id: "parent-name",
      parentId: "parent-user",
      timestamp: "2026-08-03T00:00:00.000Z",
      name: "renamed",
    })}\n`,
  );
  const updated = await index.refreshPath(parentPath);
  assert.equal(updated.name, "renamed");
  assert.equal(index.getMetrics().filesDiscovered, 1);
  assert.equal(index.getMetrics().filesParsed, 1);
  unlinkSync(parentPath);
  assert.equal(index.removePath(parentPath).id, "parent");
  assert.equal(await index.resolvePath("parent"), null);
});

test("unchanged invalid files are recorded without repeated parsing", async () => {
  const invalidPath = path.join(sessionsRoot, "project", "broken.jsonl");
  writeFileSync(invalidPath, "not json\n", "utf8");
  const index = new SessionIndex();
  await index.refreshAll();
  assert.equal(index.getMetrics().invalidFiles, 1);
  assert.equal(index.getMetrics().filesParsed >= 1, true);
  await index.refreshAll();
  assert.equal(index.getMetrics().filesParsed, 0);
  assert.equal(index.getMetrics().invalidFiles, 1);
});

test("a file appended during parsing is retried before its info is committed", async (t) => {
  const racingPath = writeSession("racing");
  const originalOpen = SessionManager.open;
  let appended = false;
  SessionManager.open = (filePath) => {
    const manager = originalOpen.call(SessionManager, filePath);
    if (filePath !== racingPath || appended) return manager;
    const originalGetEntries = manager.getEntries.bind(manager);
    manager.getEntries = () => {
      const result = originalGetEntries();
      if (!appended) {
        appended = true;
        appendFileSync(
          racingPath,
          `${JSON.stringify({
            type: "message",
            id: "racing-assistant",
            parentId: "racing-user",
            timestamp: "2026-08-06T00:00:01.000Z",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "finished" }],
              provider: "test",
              model: "test",
              timestamp: Date.parse("2026-08-06T00:00:01.000Z"),
            },
          })}\n`,
        );
      }
      return result;
    };
    return manager;
  };
  t.after(() => {
    SessionManager.open = originalOpen;
  });

  const index = new SessionIndex();
  const info = await index.refreshPath(racingPath);
  assert.equal(appended, true);
  assert.equal(info.messageCount, 2);
  assert.equal(index.getMetrics().invalidFiles, 0);
});

test("skill session previews match in the index and session listing", async () => {
  const expanded = '<skill name="fast-context" location="/x/SKILL.md">\nSkill body\n</skill>\n\n帮我梳理架构';
  writeSession("skill-preview", { message: expanded });
  const index = new SessionIndex();
  await index.refreshAll();
  assert.equal(
    (await index.getAll()).find((session) => session.id === "skill-preview").firstMessage,
    "/skill:fast-context 帮我梳理架构",
  );

  const sessions = await listAllSessions();
  assert.equal(
    sessions.find((session) => session.id === "skill-preview").firstMessage,
    "/skill:fast-context 帮我梳理架构",
  );
});

test("one changed session among 3463 cached records appends one journal line within its latency budget", async (t) => {
  const filePath = writeSession("incremental");
  const { statSync } = await import("node:fs");
  const stat = statSync(filePath);
  const records = {};
  for (let index = 0; index < 3463; index += 1) {
    const currentPath = index === 0 ? filePath : path.join(sessionsRoot, "project", `synthetic-${index}.jsonl`);
    records[currentPath] = {
      filePath: currentPath,
      fingerprint: { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino },
      info: {
        path: currentPath,
        id: index === 0 ? "incremental" : `synthetic-${index}`,
        cwd: projectRoot,
        created: "2026-08-06T00:00:00.000Z",
        modified: "2026-08-06T00:00:00.000Z",
        messageCount: 1,
        firstMessage: "cached",
      },
      valid: true,
    };
  }
  mkdirSync(path.dirname(cachePath), { recursive: true });
  const legacy = JSON.stringify({ version: 1, records });
  writeFileSync(cachePath, legacy);
  const index = new SessionIndex();
  await index.refreshPath(filePath);
  assert.equal(index.getById("synthetic-3462").firstMessage, "cached");
  const stringify = JSON.stringify;
  let serializationMs = 0;
  let serializedRecords = 0;
  t.mock.method(JSON, "stringify", (value, ...args) => {
    const started = performance.now();
    const result = stringify(value, ...args);
    if (value?.op === "put") {
      serializationMs += performance.now() - started;
      serializedRecords += 1;
    }
    return result;
  });
  const samples = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const before = readFileSync(journalPath, "utf8");
    const name = `changed-${sample}`;
    appendFileSync(
      filePath,
      `${JSON.stringify({ type: "session_info", id: name, parentId: "incremental-user", timestamp: "2026-08-07T00:00:00.000Z", name })}\n`,
    );
    serializationMs = 0;
    serializedRecords = 0;
    const started = performance.now();
    assert.equal((await index.refreshPath(filePath)).name, name);
    const elapsed = performance.now() - started;
    const after = readFileSync(journalPath, "utf8");
    assert.ok(after.startsWith(before));
    const appended = after.slice(before.length).trim().split("\n").map(JSON.parse);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].op, "put");
    assert.equal(appended[0].r.info.name, name);
    assert.equal(serializedRecords, 1);
    assert.ok(serializationMs < 1, `single-record serialization took ${serializationMs} ms`);
    assert.ok(elapsed < 10, `single-file refresh took ${elapsed} ms`);
    samples.push({ elapsed, serializationMs });
  }
  t.diagnostic(JSON.stringify(samples));
  assert.equal(readFileSync(cachePath, "utf8"), legacy);
});

test("a restarted index reuses persisted summaries and removes externally deleted sessions from its cache", async () => {
  const parentPath = writeSession("cached-parent", { timestamp: "2026-08-01T00:00:00.000Z" });
  const childPath = writeSession("cached-child", {
    timestamp: "2026-08-02T00:00:00.000Z",
    parentSession: parentPath,
  });
  const original = new SessionIndex();
  await original.refreshAll();
  assert.equal(original.getMetrics().filesParsed, 2);

  const restored = new SessionIndex();
  await restored.refreshAll();
  assert.equal(restored.getMetrics().filesParsed, 0, "unchanged histories are not parsed after restart");
  assert.equal(restored.getMetrics().filesReused, 2, "both persisted fingerprints are reused");
  const rows = await restored.getAll();
  assert.deepEqual(
    rows.map(({ id, path, parentSessionId }) => [id, path, parentSessionId]),
    [
      ["cached-child", childPath, "cached-parent"],
      ["cached-parent", parentPath, undefined],
    ],
  );
  for (const row of rows) {
    assert.equal(row.cwd, projectRoot);
    assert.equal(row.projectRoot, projectRoot);
    assert.equal(row.messageCount, 1);
    assert.equal(row.firstMessage, row.id);
  }
  const persisted = readFileSync(journalPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(persisted[0].v, 2);
  assert.deepEqual(
    persisted
      .slice(1)
      .map(({ r }) => r.filePath)
      .sort(),
    [parentPath, childPath].sort(),
  );
  const child = persisted.find(({ r }) => r?.filePath === childPath).r;
  assert.equal(Object.hasOwn(child.info, "parentSessionId"), false);
  assert.equal(Object.hasOwn(child.info, "projectRoot"), false);

  unlinkSync(parentPath);
  await restored.refreshAll();
  assert.equal(restored.getByPath(parentPath), null);
  const remaining = await restored.getAll();
  assert.deepEqual(
    remaining.map((session) => session.id),
    ["cached-child"],
  );
  assert.equal(remaining[0].parentSessionId, undefined);
  assert.deepEqual(JSON.parse(readFileSync(journalPath, "utf8").trim().split("\n").at(-1)), {
    op: "del",
    p: parentPath,
  });
});

test("cold and cached history scans let queued event-loop callbacks run before the scan finishes", async () => {
  const files = Array.from({ length: 40 }, (_, index) => writeSession(`yield-${index}`));
  for (const cold of [true, false]) {
    const index = new SessionIndex();
    const progress = [];
    let finished = false;
    let pending;
    const observe = () => {
      if (finished) return;
      progress.push(files.filter((filePath) => index.getByPath(filePath)).length);
      pending = setImmediate(observe);
    };
    pending = setImmediate(observe);
    try {
      await index.refreshAll();
    } finally {
      finished = true;
      clearImmediate(pending);
    }
    assert.ok(progress.length >= 2, "queued callbacks run during both cold and cached scans");
    if (cold) {
      assert.ok(
        progress.every((count) => count === 0 || count === 40),
        "only complete snapshots are published",
      );
    } else {
      assert.equal(index.getMetrics().filesParsed, 0);
      assert.equal(index.getMetrics().filesReused, 40);
    }
  }
});

test("a healthy watcher lets session listing reuse a recent scan until roots or the file set change", async (t) => {
  writeSession("recent");
  setAllowedRootsWatcherHealthy(true);
  t.after(() => setAllowedRootsWatcherHealthy(false));
  await sessionIndex.refreshAll();

  assert.deepEqual(
    (await listAllSessions()).map((session) => session.id),
    ["recent"],
  );
  assert.equal(sessionIndex.getMetrics().filesParsed, 0);
  assert.equal(sessionIndex.getMetrics().filesReused, 0, "the recent scan is reused without file fingerprint checks");

  invalidateAllowedRootsCache();
  await listAllSessions();
  assert.equal(sessionIndex.getMetrics().filesParsed, 0);
  assert.equal(sessionIndex.getMetrics().filesReused, 1, "root invalidation forces a fingerprint scan");

  writeSession("new-session", { timestamp: "2026-08-07T00:00:00.000Z" });
  assert.deepEqual(
    (await listAllSessions()).map((session) => session.id),
    ["new-session", "recent"],
  );
  assert.equal(sessionIndex.getMetrics().filesParsed, 1);
  assert.equal(sessionIndex.getMetrics().filesReused, 1);

  setAllowedRootsWatcherHealthy(false);
  appendFileSync(
    path.join(sessionsRoot, "project", "recent.jsonl"),
    `${JSON.stringify({
      type: "session_info",
      id: "recent-name",
      parentId: "recent-user",
      timestamp: "2026-08-08T00:00:00.000Z",
      name: "updated without a watcher",
    })}\n`,
  );
  const withoutWatcher = await listAllSessions();
  assert.equal(withoutWatcher.find((session) => session.id === "recent").name, "updated without a watcher");
  assert.equal(sessionIndex.getMetrics().filesParsed, 1);
  assert.equal(sessionIndex.getMetrics().filesReused, 1);
});

test("a cold synchronous removal returns the persisted session and survives restart", async () => {
  const filePath = writeSession("cold-remove");
  const original = new SessionIndex();
  await original.refreshAll();
  const restarted = new SessionIndex();
  unlinkSync(filePath);
  assert.equal(restarted.removePath(filePath)?.id, "cold-remove");
  await restarted.flush();
  const restored = new SessionIndex();
  await restored.refreshAll();
  assert.equal(restored.getById("cold-remove"), null);
});

test("an unreadable reconcile serves the last complete snapshot but a cold failure propagates", async (t) => {
  writeSession("retained");
  const index = new SessionIndex();
  await index.refreshAll();
  const snapshot = await index.getAll();
  const fs = (await import("node:fs/promises")).default;
  t.mock.method(fs, "readdir", async () => {
    throw Object.assign(new Error("denied"), { code: "EACCES" });
  });
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  await index.refreshAll();
  assert.deepEqual(await index.getAll(), snapshot);
  assert.ok(errors.length > 0);
  rmSync(journalPath);
  await assert.rejects(new SessionIndex().refreshAll(), { code: "EACCES" });
});

test("restart repairs a torn trailing journal line before appending the next mutation", async () => {
  const filePath = writeSession("torn");
  const original = new SessionIndex();
  await original.refreshAll();
  appendFileSync(journalPath, '{"op":"put","r":');
  const restored = new SessionIndex();
  await restored.refreshAll();
  assert.equal(restored.getById("torn").messageCount, 1);
  unlinkSync(filePath);
  assert.equal(restored.removePath(filePath).id, "torn");
  await restored.flush();
  const lines = readFileSync(journalPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.at(-1), { op: "del", p: filePath });
  assert.deepEqual(await new SessionIndex().getAll(), []);
});

test("journal compaction runs only beyond twice the live records plus 1024 and preserves every summary", async () => {
  for (let index = 0; index < 260; index += 1) writeSession(`compact-${index}`);
  const original = new SessionIndex();
  await original.refreshAll();
  const [header, ...records] = readFileSync(journalPath, "utf8").trim().split("\n");
  const threshold = [...records, ...Array.from({ length: 1284 }, () => records[0])];
  writeFileSync(journalPath, `${[header, ...threshold].join("\n")}\n`);
  const boundary = new SessionIndex();
  await boundary.refreshAll();
  await boundary.flush();
  assert.equal(readFileSync(journalPath, "utf8").trim().split("\n").length, 1545);
  appendFileSync(journalPath, `${records[0]}\n`);
  const compacted = new SessionIndex();
  await compacted.refreshAll();
  await compacted.flush();
  assert.equal(readFileSync(journalPath, "utf8").trim().split("\n").length, 261);
  assert.deepEqual(await new SessionIndex().getAll(), await compacted.getAll());
});

test("a deletion during an asynchronous journal append cannot publish a resurrected session", async (t) => {
  const filePath = writeSession("concurrent-delete");
  const index = new SessionIndex();
  await index.refreshAll();
  appendFileSync(
    filePath,
    `${JSON.stringify({ type: "session_info", id: "updated", parentId: "concurrent-delete-user", timestamp: "2026-08-07T00:00:00.000Z", name: "updated" })}\n`,
  );
  const fs = (await import("node:fs/promises")).default;
  const append = fs.appendFile.bind(fs);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  t.mock.method(fs, "appendFile", async (...args) => {
    if (args[0] === journalPath) {
      entered.resolve();
      await release.promise;
    }
    return append(...args);
  });
  const refreshing = index.apply([{ kind: "file", path: filePath }]);
  await entered.promise;
  unlinkSync(filePath);
  assert.equal(index.removePath(filePath).id, "concurrent-delete");
  release.resolve();
  const delta = await refreshing;
  assert.equal(delta.changes[0].before.id, "concurrent-delete");
  assert.equal(delta.changes[0].after, null);
  await index.flush();
  assert.deepEqual(await new SessionIndex().getAll(), []);
});

test("a single cold path is not mistaken for a complete history snapshot", async (t) => {
  const index = new SessionIndex();
  await index.refreshPath(writeSession("partial"));
  const fs = (await import("node:fs/promises")).default;
  t.mock.method(fs, "readdir", async () => {
    throw Object.assign(new Error("denied"), { code: "EACCES" });
  });
  await assert.rejects(index.getAll(), { code: "EACCES" });
});
