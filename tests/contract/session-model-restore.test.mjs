import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  resultReader,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const MODELS = [
  { id: "held-model", reasoning: true },
  { id: "held-model-b", reasoning: true },
  { id: "held-model-c", reasoning: true },
  { id: "held-model-plain", reasoning: false },
];

const host = await startSessionOrchestrationHost({
  name: "session-model-restore",
  models: MODELS,
  settings: ENABLED_SETTINGS,
});
after(() => host.close());

function at(second) {
  return new Date(Date.UTC(2026, 7, 6, 9, 0, second)).toISOString();
}

function user(id, parentId, second, text) {
  return {
    id,
    parentId,
    type: "message",
    timestamp: at(second),
    message: { role: "user", content: text, timestamp: second * 1000 },
  };
}

function assistant(id, parentId, second, modelId, text) {
  return {
    id,
    parentId,
    type: "message",
    timestamp: at(second),
    message: {
      role: "assistant",
      provider: "held-fixture",
      model: modelId,
      content: [{ type: "text", text }],
      stopReason: "stop",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: second * 1000,
    },
  };
}

function modelChange(id, parentId, second, modelId) {
  return { id, parentId, type: "model_change", provider: "held-fixture", modelId, timestamp: at(second) };
}

function thinkingChange(id, parentId, second, thinkingLevel) {
  return { id, parentId, type: "thinking_level_change", thinkingLevel, timestamp: at(second) };
}

async function openSession(sessionId) {
  await host.command(sessionId, { type: "get_state" });
  return waitUntil(
    async () => {
      const result = await host.state(sessionId);
      return result.running && result.state ? result.state : null;
    },
    { timeoutMs: 20_000, label: `session ${sessionId} to be open` },
  );
}

function assistantMessages(detail) {
  return detail.context.messages.filter((message) => message.role === "assistant");
}

async function waitForReply(sessionId, expected) {
  return waitUntil(
    async () => {
      const replies = assistantMessages(await host.detail(sessionId));
      return replies.at(-1) && textOf(replies.at(-1)) === expected ? replies.at(-1) : null;
    },
    { timeoutMs: 30_000, label: `session ${sessionId} to reply "${expected}"` },
  );
}

test(
  "a session whose last reply was signed with a provider-internal name reopens on the model the reader chose and keeps thinking high",
  { timeout: 90_000 },
  async () => {
    const sessionId = "restore-internal-signature";
    const cwd = host.workspace("restore-internal-signature");
    const firstQuestion = "Which model did the reader choose for this conversation?";
    await host.writeSession(sessionId, cwd, [
      modelChange("m1", null, 1, "held-model-b"),
      thinkingChange("t1", "m1", 2, "high"),
      user("q1", "t1", 3, firstQuestion),
      assistant("a1", "q1", 4, "held-model-b-internal:1017", "The provider signed this reply with its own name."),
    ]);

    const state = await openSession(sessionId);
    assert.deepEqual(
      state.model,
      { id: "held-model-b", provider: "held-fixture" },
      "the reopened session runs on the model the reader chose, not on the default model",
    );
    assert.equal(state.thinkingLevel, "high", "the reopened session keeps the thinking level the reader chose");

    host.model.script(firstQuestion, [{ text: "Answered by the chosen model" }]);
    await host.prompt(sessionId, "Please carry on from here.");
    const reply = await waitForReply(sessionId, "Answered by the chosen model");
    assert.equal(reply.model, "held-model-b", "the new reply was written by the model the reader chose");
  },
);

test(
  "a conversation the reader started on a chosen model reopens on that model after Dexon is reopened",
  { timeout: 90_000 },
  async () => {
    const cwd = host.workspace("restore-reader-choice");
    const question = "Please ask the chosen model a question.";
    const sessionId = await host.createUserSession({
      cwd,
      provider: "held-fixture",
      modelId: "held-model-c",
      thinkingLevel: "high",
    });
    host.model.script(question, [{ text: "The chosen model answered the first time" }]);
    await host.prompt(sessionId, question);
    await waitForReply(sessionId, "The chosen model answered the first time");

    await host.restart();

    const state = await openSession(sessionId);
    assert.deepEqual(
      state.model,
      { id: "held-model-c", provider: "held-fixture" },
      "after reopening, the conversation still runs on the model the reader chose",
    );

    host.model.script(question, [{ text: "The chosen model answered after reopening" }]);
    await host.prompt(sessionId, "Here is one more question.");
    const reply = await waitForReply(sessionId, "The chosen model answered after reopening");
    assert.equal(reply.model, "held-model-c", "the next reply was written by the model the reader chose");
  },
);

test(
  "a conversation the reader switched to another model by hand reopens on the later choice",
  { timeout: 90_000 },
  async () => {
    const cwd = host.workspace("restore-manual-switch");
    const question = "Please start this conversation on the default model.";
    const sessionId = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    host.model.script(question, [{ text: "The default model answered once" }]);
    await host.prompt(sessionId, question);
    await waitForReply(sessionId, "The default model answered once");

    await host.command(sessionId, { type: "set_model", provider: "held-fixture", modelId: "held-model-plain" });
    await host.restart();

    const state = await openSession(sessionId);
    assert.deepEqual(
      state.model,
      { id: "held-model-plain", provider: "held-fixture" },
      "after reopening, the conversation runs on the model the reader switched to last",
    );
    assert.equal(state.thinkingLevel, "off", "the model the reader switched to cannot think, so thinking stays off");
  },
);

test(
  "a conversation whose replies all carry the model id the reader chose reopens on that model",
  { timeout: 90_000 },
  async () => {
    const sessionId = "restore-self-signed";
    const cwd = host.workspace("restore-self-signed");
    await host.writeSession(sessionId, cwd, [
      user("q1", null, 1, "Which model answered this conversation?"),
      assistant("a1", "q1", 2, "held-model-c", "Every reply of this conversation carries the chosen model id."),
    ]);

    const state = await openSession(sessionId);
    assert.deepEqual(
      state.model,
      { id: "held-model-c", provider: "held-fixture" },
      "the reopened session runs on the model that wrote the replies",
    );
  },
);

test(
  "a conversation that was earlier moved to the default model by a provider-internal name reopens on the model the reader chose",
  { timeout: 90_000 },
  async () => {
    const sessionId = "restore-silently-moved";
    const cwd = host.workspace("restore-silently-moved");
    await host.writeSession(sessionId, cwd, [
      modelChange("m1", null, 1, "held-model-c"),
      user("q1", "m1", 2, "Which model should this conversation use?"),
      assistant("a1", "q1", 3, "held-model-c-internal", "The provider signed the first reply with its own name."),
      user("q2", "a1", 4, "Are you still on the model I chose?"),
      assistant("a2", "q2", 5, "held-model", "This later reply silently came from the default model."),
    ]);

    const state = await openSession(sessionId);
    assert.deepEqual(
      state.model,
      { id: "held-model-c", provider: "held-fixture" },
      "the last model the reader chose wins over a later reply written by another model",
    );
  },
);

test(
  "a conversation switched twice by hand reopens on the last model the reader picked, even when both replies carry provider names",
  { timeout: 90_000 },
  async () => {
    const sessionId = "restore-switched-twice";
    const cwd = host.workspace("restore-switched-twice");
    await host.writeSession(sessionId, cwd, [
      modelChange("m1", null, 1, "held-model-b"),
      user("q1", "m1", 2, "Which model does this conversation start on?"),
      assistant("a1", "q1", 3, "held-model-b-internal:1017", "The provider signed the first reply with its own name."),
      modelChange("m2", "a1", 4, "held-model-plain"),
      user("q2", "m2", 5, "Which model does this conversation use now?"),
      assistant(
        "a2",
        "q2",
        6,
        "held-model-plain-internal:9",
        "The provider signed the second reply with its own name.",
      ),
    ]);

    const state = await openSession(sessionId);
    assert.deepEqual(
      state.model,
      { id: "held-model-plain", provider: "held-fixture" },
      "the last model the reader picked wins over the provider name written in the last reply",
    );
  },
);

test(
  "a worker the Agent closed answers again on the model and thinking level it was started with",
  { timeout: 120_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("restore-worker") });
    const firstTask = "Take the first half of the report.";
    const secondTask = "Take the second half of the report.";
    let childId;
    host.model.script("Give the report to a worker on the model I picked", [
      toolCall("session_new", {
        message: firstTask,
        model: { provider: "held-fixture", modelId: "held-model-b" },
        thinkingLevel: "high",
        wait: false,
      }),
      { text: "Worker started" },
      { toolCall: { name: "session_close", input: () => ({ sessionId: childId }) } },
      { text: "Worker closed" },
      { toolCall: { name: "session_prompt", input: () => ({ sessionId: childId, message: secondTask, wait: true }) } },
      { text: "Worker continued" },
    ]);
    host.model.script(firstTask, [
      { text: "The worker wrote the first half" },
      { text: "The worker wrote the second half" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Give the report to a worker on the model I picked");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "The worker wrote the first half");

    await host.prompt(parent, "Close the worker now");
    expectToolPayload((await results.next())[0], "the worker must be closed");

    await host.prompt(parent, "Ask the worker for the second half");
    const payload = expectToolPayload((await results.next())[0], "the reopened worker must answer");
    assert.equal(payload.lastReply, "The worker wrote the second half");

    const state = await openSession(childId);
    assert.deepEqual(
      state.model,
      { id: "held-model-b", provider: "held-fixture" },
      "the reopened worker still runs on the model it was started with",
    );
    assert.equal(state.thinkingLevel, "high", "the reopened worker still thinks at the level it was started with");
  },
);

test(
  "the conversation the reader opens reports the model they chose, not the model that signed the last reply",
  { timeout: 90_000 },
  async () => {
    const sessionId = "restore-view-chosen-model";
    const cwd = host.workspace("restore-view-chosen-model");
    await host.writeSession(sessionId, cwd, [
      modelChange("m1", null, 1, "held-model-c"),
      user("q1", "m1", 2, "Which model should this conversation use?"),
      assistant("a1", "q1", 3, "held-model-c-internal", "The provider signed the first reply with its own name."),
      user("q2", "a1", 4, "Are you still on the model I chose?"),
      assistant("a2", "q2", 5, "held-model", "This later reply silently came from the default model."),
    ]);

    const detail = await host.detail(sessionId);
    assert.deepEqual(
      detail.context.model,
      { provider: "held-fixture", modelId: "held-model-c" },
      "the chat shows the model the reader chose, not the model that signed the last reply",
    );
  },
);
