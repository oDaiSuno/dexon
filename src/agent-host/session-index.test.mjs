import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

test.beforeEach(() => {
  rmSync(sessionsRoot, { recursive: true, force: true });
  mkdirSync(path.join(sessionsRoot, "project"), { recursive: true });
  rmSync(cachePath, { force: true });
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

test("skill session previews match in the index and when the index is unavailable", async (t) => {
  const expanded = '<skill name="fast-context" location="/x/SKILL.md">\nSkill body\n</skill>\n\n帮我梳理架构';
  writeSession("skill-preview", { message: expanded });
  const index = new SessionIndex();
  await index.refreshAll();
  assert.equal(
    (await index.getAll()).find((session) => session.id === "skill-preview").firstMessage,
    "/skill:fast-context 帮我梳理架构",
  );

  t.mock.method(SessionIndex.prototype, "refreshAll", async () => {
    throw new Error("Index unavailable");
  });
  t.mock.method(console, "error", () => {});
  const fallback = await listAllSessions();
  assert.equal(
    fallback.find((session) => session.id === "skill-preview").firstMessage,
    "/skill:fast-context 帮我梳理架构",
  );
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
  assert.deepEqual(
    (await restored.getAll()).map(({ id, path, cwd, firstMessage, messageCount, parentSessionId, projectRoot }) => ({
      id,
      path,
      cwd,
      firstMessage,
      messageCount,
      parentSessionId,
      projectRoot,
    })),
    [
      {
        id: "cached-child",
        path: childPath,
        cwd: projectRoot,
        firstMessage: "cached-child",
        messageCount: 1,
        parentSessionId: "cached-parent",
        projectRoot,
      },
      {
        id: "cached-parent",
        path: parentPath,
        cwd: projectRoot,
        firstMessage: "cached-parent",
        messageCount: 1,
        parentSessionId: undefined,
        projectRoot,
      },
    ],
  );
  const persisted = JSON.parse(readFileSync(cachePath, "utf8"));
  assert.equal(persisted.version, 1);
  assert.deepEqual(Object.keys(persisted.records).sort(), [parentPath, childPath].sort());
  assert.equal(Object.hasOwn(persisted.records[childPath].info, "parentSessionId"), false);
  assert.equal(Object.hasOwn(persisted.records[childPath].info, "projectRoot"), false);

  unlinkSync(parentPath);
  await restored.refreshAll();
  assert.equal(restored.getByPath(parentPath), null);
  const remaining = await restored.getAll();
  assert.deepEqual(
    remaining.map((session) => session.id),
    ["cached-child"],
  );
  assert.equal(remaining[0].parentSessionId, undefined);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(cachePath, "utf8")).records), [childPath]);
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
        progress.some((count) => count > 0 && count < 40),
        "a callback observes a partially indexed history before scanning completes",
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
