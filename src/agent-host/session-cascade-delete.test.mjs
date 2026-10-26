import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const agentDirectory = mkdtempSync(path.join(tmpdir(), "pi-cascade-delete-"));
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(agentDirectory, "sessions");
process.env.PI_OFFLINE = "1";
test.after(() => rmSync(agentDirectory, { recursive: true, force: true }));

const sessionDirectory = path.join(process.env.PI_CODING_AGENT_SESSION_DIR, "cascade-fixture");
const desktopDirectory = path.join(agentDirectory, "desktop");
mkdirSync(sessionDirectory, { recursive: true });
mkdirSync(desktopDirectory, { recursive: true });

function sessionFile(id) {
  return path.join(sessionDirectory, `2026-09-01T00-00-00-000Z_${id}.jsonl`);
}

function writeSession(id, parentId) {
  const header = { type: "session", version: 3, id, timestamp: "2026-09-01T00:00:00.000Z", cwd: root };
  if (parentId) header.parentSession = sessionFile(parentId);
  const message = {
    type: "message",
    id: `${id}-user`,
    parentId: null,
    timestamp: "2026-09-01T00:00:01.000Z",
    message: { role: "user", content: `${id} question`, timestamp: 1_788_220_801_000 },
  };
  writeFileSync(sessionFile(id), `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`, "utf8");
}

writeSession("root");
writeSession("fork-child", "root");
writeSession("fork-grandchild", "fork-child");
writeSession("delegate-child");
writeSession("unrelated");
writeFileSync(
  path.join(desktopDirectory, "session-origins.json"),
  JSON.stringify({
    version: 1,
    sessions: {
      "delegate-child": { relation: "delegate", createdBySessionId: "root", createdAt: "2026-09-01T00:00:00.000Z" },
    },
  }),
);
writeFileSync(
  path.join(desktopDirectory, "session-leaf-choices.json"),
  JSON.stringify({
    version: 1,
    sessions: {
      "fork-grandchild": { leafId: "fork-grandchild-user", lastEntryId: "fork-grandchild-user" },
      unrelated: { leafId: "unrelated-user", lastEntryId: "unrelated-user" },
    },
  }),
);

async function captureHandlers() {
  const { registerHandlers } = await importTestBundle("src/agent-host/cascade-delete-handlers", {
    packages: "external",
    absWorkingDir: root,
    entryPoints: ["src/agent-host/handlers.ts"],
  });
  const handlers = {};
  const events = [];
  registerHandlers({
    handle(next) {
      Object.assign(handlers, next);
    },
    emit(topic, key, data) {
      events.push({ topic, key, data });
    },
  });
  return { handlers, events };
}

const SUBTREE = ["delegate-child", "fork-child", "fork-grandchild"];

test("a session's descendants include forks at every depth and sessions it created, and nothing else", async () => {
  const { handlers } = await captureHandlers();
  await handlers["sessions.list"]();
  const result = await handlers["sessions.descendants"]({ id: "root" });
  assert.deepEqual([...result.sessionIds].sort(), SUBTREE);
  assert.deepEqual(result.runningSessionIds, []);
  assert.deepEqual(await handlers["sessions.descendants"]({ id: "fork-grandchild" }), {
    sessionIds: [],
    runningSessionIds: [],
  });
  await assert.rejects(handlers["sessions.descendants"]({ id: "missing" }), (error) => error.code === "NOT_FOUND");
});

test("deleting a session also deletes every descendant session and their saved records", async () => {
  const { handlers, events } = await captureHandlers();
  await handlers["sessions.list"]();
  assert.deepEqual(await handlers["sessions.delete"]({ id: "root" }), { ok: true });

  for (const id of ["root", ...SUBTREE]) assert.equal(existsSync(sessionFile(id)), false, `${id} file is removed`);
  assert.equal(existsSync(sessionFile("unrelated")), true, "an unrelated session stays");

  const listed = (await handlers["sessions.list"]()).sessions.map((session) => session.id);
  assert.deepEqual(listed, ["unrelated"]);

  const origins = JSON.parse(readFileSync(path.join(desktopDirectory, "session-origins.json"), "utf8"));
  assert.deepEqual(origins.sessions, {}, "the created-by record of the deleted child is gone");
  const leaves = JSON.parse(readFileSync(path.join(desktopDirectory, "session-leaf-choices.json"), "utf8"));
  assert.deepEqual(Object.keys(leaves.sessions), ["unrelated"], "only the unrelated leaf choice remains");

  const deletedIds = events
    .filter((event) => event.topic === "sessions.changed" && event.data.deleted)
    .map((event) => event.data.sessionId)
    .sort();
  assert.deepEqual(deletedIds, ["delegate-child", "fork-child", "fork-grandchild", "root"]);
});
