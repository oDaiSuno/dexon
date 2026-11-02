import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
let modulePromise;
function loadSubject() {
  if (!modulePromise) {
    modulePromise = (async () =>
      importTestBundle("src/agent-host/session-reader", {
        packages: "external",
        absWorkingDir: root,
        entryPoints: ["src/agent-host/session-reader.ts"],
      }))();
  }
  return modulePromise;
}

test("message entries adopt the entry completion timestamp over the inner start timestamp", async () => {
  const { entryToUiMessage } = await loadSubject();
  // pi stamps message.timestamp at message START (2026-01-01T00:00:00.000Z);
  // the session entry is persisted at message COMPLETION (+5s).
  const entry = {
    type: "message",
    id: "e1",
    timestamp: "2026-01-01T00:00:05.000Z",
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
      content: [{ type: "text", text: "done" }],
    },
  };

  const message = entryToUiMessage(entry);
  assert.equal(message.timestamp, Date.parse("2026-01-01T00:00:05.000Z"));
});

test("message entries keep the inner timestamp when the entry timestamp is unusable", async () => {
  const { entryToUiMessage } = await loadSubject();
  const inner = Date.parse("2026-01-01T00:00:00.000Z");
  const entry = {
    type: "message",
    id: "e2",
    timestamp: "not-a-date",
    message: { role: "assistant", provider: "test", model: "test-model", timestamp: inner, content: [] },
  };

  const message = entryToUiMessage(entry);
  assert.equal(message.timestamp, inner);
});

test("system records never become history messages", async () => {
  const { entryToUiMessage, buildSessionContext } = await loadSubject();
  const entries = [
    {
      type: "message",
      id: "system",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "system", content: "private prompt", timestamp: 1 },
    },
    {
      type: "message",
      id: "user",
      parentId: "system",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: "hello", timestamp: 2 },
    },
  ];
  assert.equal(entryToUiMessage(entries[0]), null);
  const context = buildSessionContext(entries);
  assert.deepEqual(context.entryIds, ["user"]);
  assert.deepEqual(
    context.messages.map((message) => message.role),
    ["user"],
  );
});

test("session list counts conversation records but not system records", async () => {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { buildSessionInfoFromManager } = await loadSubject();
  const manager = SessionManager.inMemory(root);
  manager.appendMessage({ role: "system", content: "private", timestamp: 1 });
  manager.appendMessage({ role: "user", content: "hello", timestamp: 2 });
  const info = await buildSessionInfoFromManager("", manager, manager.getEntries(), { resolveProjectInfo: false });
  assert.equal(info.messageCount, 1);
  assert.equal(info.firstMessage, "hello");
});
