import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { importTestBundle } from "#test-bundle";

const base = mkdtempSync(path.join(tmpdir(), "dexon-session-history-"));
const agentDirectory = path.join(base, "agent");
const sessionDirectory = path.join(base, "sessions");
mkdirSync(agentDirectory, { recursive: true });
mkdirSync(sessionDirectory, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = sessionDirectory;
process.env.PI_OFFLINE = "1";

const { registerHandlers } = await importTestBundle("session-history-paging", {
  packages: "external",
  absWorkingDir: path.resolve(import.meta.dirname, "../.."),
  entryPoints: ["src/agent-host/handlers.ts"],
});

const handlers = {};
const cleanupHandlers = registerHandlers({
  handle(next) {
    Object.assign(handlers, next);
  },
  emit() {},
});

after(async () => {
  try {
    await cleanupHandlers();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

const timestamp = "2026-08-06T00:00:00.000Z";

function writeSessionFile(id, definitions) {
  const header = { type: "session", version: 3, id, timestamp, cwd: base };
  const filePath = path.join(sessionDirectory, `2026-08-06T00-00-00-000Z_${id}.jsonl`);
  writeFileSync(filePath, `${[header, ...definitions].map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  return filePath;
}

function chain(definitions) {
  let parentId = null;
  return definitions.map((definition, index) => {
    const entry = { id: `${index}-${definition.type}`, parentId, timestamp, ...definition };
    parentId = entry.id;
    return entry;
  });
}

function usage(input, output, cacheRead, cacheWrite, cost) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

test("sessions.get reports usage and message counts for the whole session file regardless of the page window", async () => {
  const entries = chain([
    { type: "message", message: { role: "user", content: "count me", timestamp: 1 } },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "working" },
          { type: "toolCall", toolCallId: "call-a", toolName: "read", input: { path: "a" } },
          { type: "toolCall", toolCallId: "call-b", toolName: "read", input: { path: "b" } },
        ],
        provider: "provider",
        model: "model",
        timestamp: 2,
        usage: usage(100, 20, 10, 5, 0.5),
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call-a",
        content: [{ type: "text", text: "a-content" }],
        timestamp: 3,
        usage: usage(200, 0, 0, 0, 0.25),
      },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        provider: "provider",
        model: "model",
        timestamp: 4,
        usage: usage(300, 40, 20, 0, 1),
      },
    },
    {
      type: "compaction",
      summary: "compressed",
      firstKeptEntryId: "0-message",
      tokensBefore: 900,
      usage: usage(50, 10, 0, 0, 0.125),
    },
    {
      type: "message",
      parentId: "1-message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "other branch" }],
        provider: "provider",
        model: "model",
        timestamp: 5,
        usage: usage(0, 0, 0, 0, 0),
      },
    },
  ]);
  const sessionId = "stats-session";
  writeSessionFile(sessionId, entries);
  await handlers["sessions.list"]();

  const paged = await handlers["sessions.get"]({ id: sessionId, historyWindow: { maxTurns: 1, maxBytes: 32 * 1024 } });
  assert.deepEqual(paged.stats, {
    userMessages: 1,
    assistantMessages: 3,
    toolCalls: 2,
    toolResults: 1,
    totalMessages: 5,
    tokens: { input: 650, output: 70, cacheRead: 30, cacheWrite: 5, total: 755 },
    cost: 1.875,
    costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    lastCompactionAt: timestamp,
  });
  assert.equal(paged.info.messageCount, paged.stats.totalMessages);

  const whole = await handlers["sessions.get"]({ id: sessionId });
  assert.deepEqual(whole.stats, paged.stats);
  assert.equal(whole.context.messages.length, 3);
});

function longSessionDefinitions() {
  const definitions = [{ type: "message", message: { role: "user", content: "analyze the repository", timestamp: 1 } }];
  for (let index = 0; index < 80; index += 1) {
    definitions.push(
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: `reasoning ${index} `.repeat(100),
              thinkingSignature: `signature-${index} `.repeat(700),
            },
            {
              type: "toolCall",
              toolCallId: `call-${index}`,
              toolName: "read",
              input: { path: `src/file-${index}.ts` },
            },
          ],
          provider: "provider",
          model: "model",
          timestamp: 2 + index,
          usage: usage(10, 5, 0, 0, 0.001),
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: `call-${index}`,
          content: [{ type: "text", text: `output ${index} `.repeat(1_300) }],
          timestamp: 2 + index,
        },
      },
    );
  }
  definitions.push({
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "final summary" }],
      provider: "provider",
      model: "model",
      timestamp: 100,
      usage: usage(10, 5, 0, 0, 0.001),
    },
  });
  return definitions;
}

async function readEveryEarlierPage(id, newestContext) {
  const pages = [newestContext];
  let cursor = newestContext.previousCursor;
  while (cursor) {
    const page = await handlers["sessions.contextPage"]({ id, cursor, maxTurns: 20, maxBytes: 1024 * 1024 });
    pages.unshift(page.context);
    cursor = page.context.previousCursor;
    if (pages.length > 2_000) throw new Error("history paging never reached the start of the branch");
  }
  return pages;
}

test("when a long session is reopened with the default window, the conversation is visible and every message reads back once", async () => {
  const sessionId = "long-session";
  const entries = chain(longSessionDefinitions());
  const filePath = writeSessionFile(sessionId, entries);
  const bytesBefore = statSync(filePath).size;
  const hashBefore = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  await handlers["sessions.list"]();

  const detail = await handlers["sessions.get"]({
    id: sessionId,
    historyWindow: { maxTurns: 20, maxBytes: 1024 * 1024 },
  });
  assert.equal(detail.context.messages.length > 0, true);
  assert.equal(detail.context.loadedMessages, detail.context.messages.length);
  assert.equal(detail.context.truncatedBefore, true);
  assert.equal(typeof detail.context.previousCursor, "string");
  assert.equal(detail.stats.totalMessages, 162);
  assert.equal(detail.stats.toolCalls, 80);

  const pages = await readEveryEarlierPage(sessionId, detail.context);
  assert.equal(pages.length > 1, true);
  assert.deepEqual(
    pages.flatMap((page) => page.entryIds),
    entries.map((entry) => entry.id),
  );
  assert.equal(pages.flatMap((page) => page.messages).length, entries.length);

  const shippedBlocks = pages
    .flatMap((page) => page.messages)
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []));
  assert.deepEqual(
    shippedBlocks.filter(
      (block) => "thinkingSignature" in block || "textSignature" in block || "thoughtSignature" in block,
    ),
    [],
  );

  assert.equal(statSync(filePath).size, bytesBefore);
  assert.equal(createHash("sha256").update(readFileSync(filePath)).digest("hex"), hashBefore);
});
