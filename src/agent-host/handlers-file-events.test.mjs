import assert from "node:assert/strict";
import { mkdirSync, realpathSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRpcClient, createRpcServer } from "../contract/rpc.ts";
import {
  loadHandlersModule,
  captureHandlers,
  waitFor,
  root,
  isolatedAgentDirectory,
} from "./handlers-test-support.mjs";

test("sessions.get returns the contract shape without rescanning known session paths", async (t) => {
  const sessionDirectory = path.join(process.env.PI_CODING_AGENT_SESSION_DIR, "contract-fixture");
  mkdirSync(sessionDirectory, { recursive: true });
  const sessionId = "contract-session";
  const sessionPath = path.join(sessionDirectory, `2026-08-06T00-00-00-000Z_${sessionId}.jsonl`);
  const entries = [
    {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-08-06T00:00:00.000Z",
      cwd: root,
    },
    {
      type: "message",
      id: "user-one",
      parentId: null,
      timestamp: "2026-08-06T00:00:01.000Z",
      message: { role: "user", content: "hello", timestamp: 1_786_060_801_000 },
    },
    {
      type: "message",
      id: "assistant-one",
      parentId: "user-one",
      timestamp: "2026-08-06T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        api: "test",
        provider: "test",
        model: "test",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
        stopReason: "stop",
        timestamp: 1_786_060_802_000,
      },
    },
    {
      type: "message",
      id: "user-two",
      parentId: "assistant-one",
      timestamp: "2026-08-06T00:00:03.000Z",
      message: { role: "user", content: "second", timestamp: 1_786_060_803_000 },
    },
    {
      type: "message",
      id: "assistant-two",
      parentId: "user-two",
      timestamp: "2026-08-06T00:00:04.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "second answer" }],
        api: "test",
        provider: "test",
        model: "test",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
        stopReason: "stop",
        timestamp: 1_786_060_804_000,
      },
    },
  ];
  writeFileSync(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  const { handlers } = await captureHandlers();
  const listed = await handlers["sessions.list"]();
  assert.equal(
    listed.sessions.some((session) => session.id === sessionId),
    true,
  );
  const filtered = await handlers["sessions.list"]({ cwd: path.join(root, ".") });
  assert.equal(
    filtered.sessions.some((session) => session.id === sessionId),
    true,
  );
  const excluded = await handlers["sessions.list"]({ cwd: isolatedAgentDirectory });
  assert.equal(
    excluded.sessions.some((session) => session.id === sessionId),
    false,
  );
  await assert.rejects(handlers["sessions.list"]({ cwd: "relative/project" }), (error) => error.code === "BAD_REQUEST");

  const originalListAll = SessionManager.listAll;
  SessionManager.listAll = async () => {
    throw new Error("global scan must not run");
  };
  t.after(() => {
    SessionManager.listAll = originalListAll;
  });

  const detail = await handlers["sessions.get"]({ id: sessionId });
  assert.deepEqual(Object.keys(detail).sort(), ["context", "filePath", "info", "leafId", "sessionId", "stats", "tree"]);
  assert.equal(detail.sessionId, sessionId);
  assert.equal(detail.filePath, sessionPath);
  assert.equal(detail.info.id, sessionId);
  assert.equal(detail.info.messageCount, 4);
  assert.equal(detail.info.firstMessage, "hello");
  assert.deepEqual(detail.context.entryIds, ["user-one", "assistant-one", "user-two", "assistant-two"]);
  assert.equal(detail.context.messages.length, 4);

  const paged = await handlers["sessions.get"]({ id: sessionId, historyWindow: { maxTurns: 1, maxBytes: 64 * 1024 } });
  assert.deepEqual(paged.context.entryIds, ["user-two", "assistant-two"]);
  assert.equal(paged.context.truncatedBefore, true);
  const older = await handlers["sessions.contextPage"]({ id: sessionId, cursor: paged.context.previousCursor });
  assert.deepEqual(older.context.entryIds, ["user-one", "assistant-one"]);
  const cursorPayload = JSON.parse(Buffer.from(paged.context.previousCursor, "base64url").toString("utf8"));
  const staleCursor = Buffer.from(
    JSON.stringify({ ...cursorPayload, historyRevision: "stale-revision" }),
    "utf8",
  ).toString("base64url");
  await assert.rejects(
    handlers["sessions.contextPage"]({ id: sessionId, cursor: staleCursor }),
    (error) => error.code === "STALE_CURSOR",
  );
  await assert.rejects(
    handlers["sessions.contextPage"]({ id: sessionId, cursor: "invalid" }),
    (error) => error.code === "BAD_REQUEST",
  );
  assert.deepEqual(await handlers["sessions.entryContent"]({ id: sessionId, entryId: "assistant-two" }), {
    content: { type: "text", text: "second answer" },
    deferredContent: {
      entryId: "assistant-two",
      blockIndex: 0,
      originalBytes: Buffer.byteLength(JSON.stringify({ type: "text", text: "second answer" }), "utf8"),
      contentType: "text",
    },
  });
  await assert.rejects(
    handlers["sessions.entryContent"]({ id: sessionId, entryId: "another-session-entry", blockIndex: 0 }),
    (error) => error.code === "NOT_FOUND",
  );
});
test("host cleanup releases the file watch it owns and silences its events", async (t) => {
  const { registerHandlers } = await loadHandlersModule();

  const watchRoot = mkdtempSync(path.join(tmpdir(), "pi-host-cleanup-"));
  const watchedFile = path.join(watchRoot, "watched.txt");
  writeFileSync(watchedFile, "before cleanup\n");

  const server = createRpcServer();
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const client = createRpcClient(port2);
  const cleanup = registerHandlers(server);
  t.after(() => {
    client.close();
    server.detachPort(port1);
    rmSync(watchRoot, { recursive: true, force: true });
  });

  const changeEvents = [];
  client.subscribe("files.changed", watchedFile, (event) => changeEvents.push(event));

  await client.call("system.allowRoot", { path: watchRoot });
  assert.deepEqual(await client.call("files.watchStart", { path: watchedFile }), { ok: true });
  await waitFor(() => changeEvents.some((event) => event.event === "connected"), 5_000);

  let changeObserved = false;
  for (let attempt = 0; attempt < 3 && !changeObserved; attempt += 1) {
    writeFileSync(watchedFile, `touch-${attempt}-${Date.now()}\n`);
    try {
      await waitFor(() => changeEvents.some((event) => event.event === "change"), 1_200);
      changeObserved = true;
    } catch {
      if (attempt === 2) throw new Error("the live watch never relayed a file change before cleanup");
    }
  }

  await cleanup();

  const eventsBeforeSilence = changeEvents.length;
  writeFileSync(watchedFile, `quiet-${Date.now()}\n`);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(
    changeEvents.length,
    eventsBeforeSilence,
    "the host-owned watch must not emit after the composition cleanup releases it",
  );
});

test("checking a typed folder for the project switcher resolves ~ and existing folders without granting file access", async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), "pi-inspect-folder-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const folder = path.join(base, "typed-project");
  mkdirSync(folder);
  const file = path.join(base, "notes.txt");
  writeFileSync(file, "not a folder\n");

  const { handlers } = await captureHandlers();
  assert.equal((await handlers["projects.browse"]({ path: folder })).path, realpathSync.native(folder));
  assert.equal((await handlers["projects.browse"]({ path: "~" })).path, realpathSync.native(homedir()));
  assert.equal((await handlers["projects.browse"]({ path: file })).ok, false);
  assert.equal((await handlers["projects.browse"]({ path: path.join(base, "missing") })).ok, false);
  await assert.rejects(
    handlers["files.list"]({ path: folder }),
    (error) => error.code === "FORBIDDEN",
    "only checking a folder must not open it for file access",
  );
});
