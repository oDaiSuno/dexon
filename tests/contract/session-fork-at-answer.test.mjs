import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { heldModel, startHeldModelServer } from "../fixtures/held-model-server.mjs";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dexon-fork-at-answer-")));
const agent = path.join(base, "agent");
const workspace = path.join(base, "workspace");
const sessionDirectory = path.join(base, "sessions");
for (const directory of [agent, workspace, sessionDirectory]) mkdirSync(directory, { recursive: true });
const variables = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE"];
const previous = new Map(variables.map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_CODING_AGENT_SESSION_DIR = sessionDirectory;
process.env.PI_DESKTOP_USER_DATA = path.join(base, "desktop");
process.env.PI_OFFLINE = "1";
const restoreMainProcess = installMainProcessPort();
const model = await startHeldModelServer();
model.configure(agent);

const { registerHandlers } = await importTestBundle("session-fork-at-answer", {
  packages: "external",
  absWorkingDir: path.resolve(import.meta.dirname, "../.."),
  entryPoints: ["src/agent-host/handlers.ts"],
});
const server = createRpcServer();
const { port1, port2 } = new MessageChannel();
server.attachPort(port1);
const client = createRpcClient(port2);
const cleanupHost = registerHandlers(server);

after(async () => {
  try {
    await cleanupHost();
  } finally {
    client.close();
    server.detachPort(port1);
    await model.close();
    restoreMainProcess();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(base, { recursive: true, force: true });
  }
});

const QUESTION_ONE = "Where do the tests of this project live?";
const ANSWER_ONE = "The tests live in the tests directory.";
const QUESTION_TWO = "What does a new session copy from this conversation?";
const TOOL_CALL_ID = "call-read-1";
const ANSWER_TWO_OPENING = "It copies the conversation up to the chosen answer.";
const TOOL_OUTPUT = "src/app.ts has 42 lines and no null check.";
const ANSWER_TWO_ENDING = "A trailing tool result stays with its call.";

const ENTRY = {
  questionOne: "question-one",
  answerOne: "answer-one",
  questionTwo: "question-two",
  answerTwoOpening: "answer-two-tool-call",
  toolResult: "answer-two-tool-result",
  answerTwoEnding: "answer-two-ending",
};

const timestamp = "2026-08-06T00:00:00.000Z";

function textBlock(value) {
  return { type: "text", text: value };
}

function usage(input, output) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(blocks, moment) {
  return {
    role: "assistant",
    content: blocks,
    provider: heldModel.provider,
    model: heldModel.modelId,
    stopReason: "stop",
    usage: usage(100, 20),
    timestamp: moment,
  };
}

function conversation() {
  return [
    { id: ENTRY.questionOne, type: "message", message: { role: "user", content: QUESTION_ONE, timestamp: 1 } },
    { id: ENTRY.answerOne, type: "message", message: assistantMessage([textBlock(ANSWER_ONE)], 2) },
    { id: ENTRY.questionTwo, type: "message", message: { role: "user", content: QUESTION_TWO, timestamp: 3 } },
    {
      id: ENTRY.answerTwoOpening,
      type: "message",
      message: assistantMessage(
        [
          textBlock(ANSWER_TWO_OPENING),
          { type: "toolCall", id: TOOL_CALL_ID, name: "read", arguments: { path: "src/app.ts" } },
        ],
        4,
      ),
    },
    {
      id: ENTRY.toolResult,
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: TOOL_CALL_ID,
        toolName: "read",
        content: [textBlock(TOOL_OUTPUT)],
        isError: false,
        timestamp: 5,
      },
    },
    { id: ENTRY.answerTwoEnding, type: "message", message: assistantMessage([textBlock(ANSWER_TWO_ENDING)], 6) },
  ];
}

function writeConversation(sessionId) {
  const header = { type: "session", version: 3, id: sessionId, timestamp, cwd: workspace };
  const entries = conversation().map((entry, index, all) => ({
    ...entry,
    parentId: index === 0 ? null : all[index - 1].id,
    timestamp,
  }));
  const filePath = path.join(sessionDirectory, `2026-08-06T00-00-00-000Z_${sessionId}.jsonl`);
  writeFileSync(filePath, `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  return filePath;
}

function textOf(message) {
  return typeof message?.content === "string"
    ? message.content
    : (message?.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}

async function readConversation(sessionId) {
  let detail;
  try {
    detail = await client.call("sessions.get", { id: sessionId });
  } catch (error) {
    assert.fail(`the new session holds no readable conversation at all (${error.message})`);
  }
  return detail.context.messages.map((message) => [message.role, textOf(message)]);
}

async function conversationFile(sessionId) {
  await client.call("sessions.list");
  return writeConversation(sessionId);
}

async function startNewSession(sessionId, command) {
  await client.call("sessions.list");
  return client.call("agent.command", { sessionId, command });
}

async function openSavedConversation(sessionId) {
  await client.call("agent.command", { sessionId, command: { type: "get_state" } });
}

function digestOf(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

test("when a reader starts a new session at an answer, the new session holds that question and that answer and nothing after it", async () => {
  const sessionId = "fork-at-first-answer";
  await conversationFile(sessionId);
  const answer = await startNewSession(sessionId, { type: "fork", entryId: ENTRY.answerOne, position: "at" });
  assert.equal(answer.cancelled, false);
  assert.deepEqual(await readConversation(answer.newSessionId), [
    ["user", QUESTION_ONE],
    ["assistant", ANSWER_ONE],
  ]);
});

test("when a reader starts a new session at the latest answer of a conversation, the new session holds the whole conversation in the order it was written", async () => {
  const sessionId = "fork-at-latest-answer";
  await conversationFile(sessionId);
  const answer = await startNewSession(sessionId, { type: "fork", entryId: ENTRY.answerTwoEnding, position: "at" });
  assert.equal(answer.cancelled, false);
  assert.deepEqual(await readConversation(answer.newSessionId), [
    ["user", QUESTION_ONE],
    ["assistant", ANSWER_ONE],
    ["user", QUESTION_TWO],
    ["assistant", ANSWER_TWO_OPENING],
    ["toolResult", TOOL_OUTPUT],
    ["assistant", ANSWER_TWO_ENDING],
  ]);
});

test("when a turn ends on a tool result, a new session started at that point keeps the call together with its result", async () => {
  const sessionId = "fork-at-tool-result";
  await conversationFile(sessionId);
  const answer = await startNewSession(sessionId, { type: "fork", entryId: ENTRY.toolResult, position: "at" });
  assert.equal(answer.cancelled, false);
  const detail = await client.call("sessions.get", { id: answer.newSessionId });
  const messages = detail.context.messages;
  assert.deepEqual(
    messages.map((message) => [message.role, textOf(message)]),
    [
      ["user", QUESTION_ONE],
      ["assistant", ANSWER_ONE],
      ["user", QUESTION_TWO],
      ["assistant", ANSWER_TWO_OPENING],
      ["toolResult", TOOL_OUTPUT],
    ],
  );
  const result = messages.at(-1);
  const call = messages.at(-2).content.find((block) => block.type === "toolCall");
  assert.equal(result.toolCallId, TOOL_CALL_ID, "the copied result still names the call it answers");
  assert.equal(call?.toolCallId, TOOL_CALL_ID, "the copied call still names the result that follows it");
});

test("when a reader starts a new session on a question without saying where to stop, the copy stops before that question", async () => {
  const sessionId = "fork-before-question";
  await conversationFile(sessionId);
  const answer = await startNewSession(sessionId, { type: "fork", entryId: ENTRY.questionTwo });
  assert.equal(answer.cancelled, false);
  assert.deepEqual(await readConversation(answer.newSessionId), [
    ["user", QUESTION_ONE],
    ["assistant", ANSWER_ONE],
  ]);
});

test("when a new session is started at an answer, the conversation it came from is not rewritten and the new session is listed under it", async () => {
  const sessionId = "fork-keeps-original";
  const filePath = await conversationFile(sessionId);
  await openSavedConversation(sessionId);
  const digestBefore = digestOf(filePath);
  const answer = await startNewSession(sessionId, { type: "fork", entryId: ENTRY.answerOne, position: "at" });
  assert.equal(answer.cancelled, false);
  assert.equal(
    digestOf(filePath),
    digestBefore,
    "the conversation file is not rewritten by starting a new session from it",
  );
  const listed = (await client.call("sessions.list")).sessions.filter((session) => session.id === answer.newSessionId);
  assert.equal(listed.length, 1, "the new session appears in the session list exactly once");
  assert.equal(listed[0].parentSessionId, sessionId, "the new session hangs under the conversation it came from");
});
