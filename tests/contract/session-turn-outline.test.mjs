import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { importTestBundle } from "#test-bundle";

const base = mkdtempSync(path.join(tmpdir(), "dexon-session-turn-outline-"));
const agentDirectory = path.join(base, "agent");
const sessionDirectory = path.join(base, "sessions");
mkdirSync(agentDirectory, { recursive: true });
mkdirSync(sessionDirectory, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = sessionDirectory;
process.env.PI_OFFLINE = "1";

const { registerHandlers } = await importTestBundle("session-turn-outline", {
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

function reply(text, at) {
  return {
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      provider: "provider",
      model: "model",
      timestamp: at,
      usage: usage(10, 5, 0, 0, 0.001),
    },
  };
}

const QUESTION_TEXTS = [
  "Which color tokens does the design use?",
  "Where does the sidebar keep its width?",
  "How are relative times computed?",
  "Why does the retry delay grow?",
  "Where is the outline stored?",
  "Which hook owns the scroll position?",
  "What happens when a page fails?",
  "How many turns fit in one page?",
  "Why does the conversation jump?",
  "Where is the leaf resolved?",
  "Which entry id marks a question?",
  "How is a skill message stored?",
  "What does an image-only question show?",
  "Where do tool results live?",
  "Which revision guards a cursor?",
  "How is the history cursor encoded?",
  "What happens on a stale cursor?",
  "Where does the transcript start?",
  "How is a branch path built?",
  "Which message becomes a turn?",
  "Why does the window cap bytes?",
  "How is a page prepended?",
  "Where are retry outcomes attached?",
  "What clears the deferred content?",
  "Which version wins after a switch?",
  "How is the leaf stored between runs?",
  "What happens when the file moves?",
  "Where are model settings read?",
  "How is the title of a turn computed?",
  "Which questions does the navigator list?",
];

const QUESTION_TITLES = QUESTION_TEXTS;

function longConversation() {
  const definitions = [];
  const expected = [];
  QUESTION_TEXTS.forEach((question, index) => {
    definitions.push({ type: "message", message: { role: "user", content: question, timestamp: index * 10 + 1 } });
    expected.push({ entryId: `${definitions.length - 1}-message`, title: QUESTION_TITLES[index] });
    definitions.push({
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: `Reading the files of turn ${index + 1}.` },
          ...[0, 1, 2].map((step) => ({
            type: "toolCall",
            toolCallId: `call-${index}-${step}`,
            toolName: "read",
            input: { path: `src/file-${index}-${step}.ts` },
          })),
        ],
        provider: "provider",
        model: "model",
        timestamp: index * 10 + 2,
        usage: usage(10, 5, 0, 0, 0.001),
      },
    });
    for (const step of [0, 1, 2]) {
      definitions.push({
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: `call-${index}-${step}`,
          content: [{ type: "text", text: `turn ${index} step ${step} output `.repeat(220) }],
          timestamp: index * 10 + 3,
        },
      });
    }
    definitions.push(reply(`Answer ${index + 1}: the files are read.`, index * 10 + 4));
  });
  return { definitions, expected };
}

test("when a session has more questions than one history page holds, sessions.get returns every question of the conversation in order", async () => {
  const sessionId = "outline-long-session";
  const { definitions, expected } = longConversation();
  writeSessionFile(sessionId, chain(definitions));
  await handlers["sessions.list"]();

  const detail = await handlers["sessions.get"]({
    id: sessionId,
    historyWindow: { maxTurns: 20, maxBytes: 64 * 1024 },
  });
  const loadedQuestions = detail.context.messages.filter((message) => message.role === "user");
  assert.ok(
    loadedQuestions.length < QUESTION_TEXTS.length,
    `the page window loaded ${loadedQuestions.length} of ${QUESTION_TEXTS.length} questions`,
  );
  assert.equal(typeof detail.context.previousCursor, "string", "the newest page is a partial window");
  assert.deepEqual(detail.context.outline, expected);
});

test("when a question spans lines, expands a skill or carries no text, its outline title follows the visible text", async () => {
  const sessionId = "outline-titles";
  const long = "x".repeat(260);
  const skill =
    '<skill name="review" location="/skills/review/SKILL.md">\nReview the diff.\n</skill>\n\nCheck the diff';
  const entries = chain([
    { type: "message", message: { role: "user", content: "  Which   color\n\n tokens \t does the design use?  " } },
    reply("Eight of them.", 2),
    { type: "message", message: { role: "user", content: skill } },
    reply("Checked.", 4),
    {
      type: "message",
      message: { role: "user", content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] },
    },
    reply("Seen.", 6),
    { type: "message", message: { role: "user", content: long } },
    reply("Handled.", 8),
  ]);
  writeSessionFile(sessionId, entries);
  await handlers["sessions.list"]();

  const detail = await handlers["sessions.get"]({ id: sessionId });
  assert.deepEqual(detail.context.outline, [
    { entryId: entries[0].id, title: "Which color tokens does the design use?" },
    { entryId: entries[2].id, title: "/skill:review Check the diff" },
    { entryId: entries[4].id, title: "" },
    { entryId: entries[6].id, title: "x".repeat(200) },
  ]);
});

test("when the conversation has two branches, sessions.context for the other leaf returns only that branch's questions", async () => {
  const sessionId = "outline-branched";
  const message = (body) => ({ type: "message", message: body });
  const question = (text, at) => message({ role: "user", content: text, timestamp: at });
  const entry = (id, parentId, definition) => ({ id, parentId, timestamp, ...definition });
  const entries = [
    entry("e1", null, question("Why is the window full?", 1)),
    entry("e2", "e1", reply("Because it is long.", 2)),
    entry("e3", "e2", question("Which page holds the question?", 3)),
    entry("e4", "e3", reply("The oldest one.", 4)),
    entry("e5", "e4", question("Which branch keeps the summary?", 5)),
    entry("e6", "e5", reply("The branch the reader picked.", 6)),
    entry("e7", "e4", question("Which branch keeps the diff?", 7)),
    entry("e8", "e7", reply("The other branch.", 8)),
  ];
  writeSessionFile(sessionId, entries);
  await handlers["sessions.list"]();

  const other = await handlers["sessions.context"]({
    id: sessionId,
    leafId: "e6",
    historyWindow: { maxTurns: 20, maxBytes: 64 * 1024 },
  });
  assert.deepEqual(other.context.outline, [
    { entryId: "e1", title: "Why is the window full?" },
    { entryId: "e3", title: "Which page holds the question?" },
    { entryId: "e5", title: "Which branch keeps the summary?" },
  ]);

  const newest = await handlers["sessions.get"]({
    id: sessionId,
    historyWindow: { maxTurns: 20, maxBytes: 64 * 1024 },
  });
  assert.deepEqual(newest.context.outline, [
    { entryId: "e1", title: "Why is the window full?" },
    { entryId: "e3", title: "Which page holds the question?" },
    { entryId: "e7", title: "Which branch keeps the diff?" },
  ]);
});
