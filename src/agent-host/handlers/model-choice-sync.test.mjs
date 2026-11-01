import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startSessionOrchestrationHost, textOf } from "../../../tests/support/session-orchestration-host.mjs";

const ORIGINAL_MODEL = { provider: "held-fixture", modelId: "held-model" };
const CHOSEN_MODEL = { provider: "held-fixture", modelId: "held-model-b" };
const ORIGINAL_CHOICE = { model: ORIGINAL_MODEL, thinkingLevel: "high" };
const CHOSEN_CHOICE = { model: CHOSEN_MODEL, thinkingLevel: "off" };
const host = await startSessionOrchestrationHost({
  name: "backend-model-choice-sync",
  models: [
    { id: ORIGINAL_MODEL.modelId, reasoning: true },
    { id: CHOSEN_MODEL.modelId, reasoning: true },
  ],
  agentSettings: { compaction: { enabled: false } },
  modules: { getRpcSession: "./src/agent-host/rpc-manager.ts" },
});
after(() => host.close());

function appendTurn(manager, question) {
  const userId = manager.appendMessage({ role: "user", content: question, timestamp: Date.now() });
  const answerId = manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: `Answer to ${question}` }],
    api: "openai-completions",
    provider: ORIGINAL_MODEL.provider,
    model: ORIGINAL_MODEL.modelId,
    stopReason: "stop",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  });
  return { userId, answerId };
}

async function seededSession(name, { explicitModel = true, thinkingLevel = "high" } = {}) {
  const manager = SessionManager.create(host.workspace(name), path.join(host.base, "sessions"));
  if (explicitModel) manager.appendModelChange(ORIGINAL_MODEL.provider, ORIGINAL_MODEL.modelId);
  manager.appendThinkingLevelChange(thinkingLevel);
  const firstQuestion = `${name}: first question`;
  const first = appendTurn(manager, firstQuestion);
  const middle = appendTurn(manager, `${name}: second question`);
  const older = appendTurn(manager, `${name}: original third question`);
  manager.branch(middle.answerId);
  const newer = appendTurn(manager, `${name}: revised third question`);
  const sessionId = manager.getSessionId();
  await host.sessions();
  await host.command(sessionId, { type: "get_state" });
  return { sessionId, firstQuestion, first, older, newer, filePath: manager.getSessionFile() };
}

async function chooseModel(fixture) {
  await host.command(fixture.sessionId, { type: "set_model", ...CHOSEN_MODEL });
  await host.command(fixture.sessionId, { type: "set_thinking_level", level: "off" });
  const state = await host.command(fixture.sessionId, { type: "get_state" });
  assert.deepEqual(state.model, { provider: CHOSEN_MODEL.provider, id: CHOSEN_MODEL.modelId });
  assert.equal(state.thinkingLevel, "off");
}

function choiceOf(context) {
  return { model: context.model, thinkingLevel: context.thinkingLevel };
}

function choiceRecords(manager) {
  return manager
    .getEntries()
    .filter((entry) => entry.type === "model_change" || entry.type === "thinking_level_change");
}

function recordedChoiceBefore(fixture, question) {
  const manager = SessionManager.open(fixture.filePath);
  const user = manager
    .getEntries()
    .findLast(
      (entry) => entry.type === "message" && entry.message.role === "user" && textOf(entry.message) === question,
    );
  assert.ok(user, "the new question is saved before its model request starts");
  const preceding = manager.getBranch(user.id).slice(0, -1);
  const model = preceding.findLast((entry) => entry.type === "model_change");
  const thinking = preceding.findLast((entry) => entry.type === "thinking_level_change");
  return {
    model: model ? { provider: model.provider, modelId: model.modelId } : null,
    thinkingLevel: thinking?.thinkingLevel ?? null,
  };
}

async function whileModelIsAnswering(fixture, firstQuestion, invoke, verify) {
  const held = host.model.hold(firstQuestion, { partial: "Starting reply", rest: " and finishing it." });
  const events = host.events(fixture.sessionId);
  const done = events.next((event) => event.type === "prompt_done" || event.type === "channel_turn_end");
  const operation = invoke();
  try {
    await held.partialSent();
    await verify();
  } finally {
    held.release();
    await operation;
    await done;
    events.off();
  }
  assert.deepEqual(
    events.all.filter((event) => event.type === "prompt_error" || event.type === "channel_turn_error"),
    [],
  );
}

async function exportedSession(sessionId) {
  return (await host.client.call("sessions.export", { id: sessionId, format: "json" })).content;
}

test(
  "editing an earlier question records the chosen model and thinking level on its new branch before the reply starts",
  { timeout: 30_000 },
  async () => {
    const fixture = await seededSession("edit-rewind");
    await chooseModel(fixture);
    const edited = "edit-rewind: corrected first question";
    await whileModelIsAnswering(
      fixture,
      edited,
      () => host.command(fixture.sessionId, { type: "edit_message", entryId: fixture.first.userId, message: edited }),
      () => assert.deepEqual(recordedChoiceBefore(fixture, edited), CHOSEN_CHOICE),
    );
  },
);

for (const navigation of ["navigate_tree", "switch_version"]) {
  test(
    `${navigation} writes no conversation records until the next turn anchors the current choice`,
    { timeout: 30_000 },
    async () => {
      const fixture = await seededSession(navigation);
      await chooseModel(fixture);
      const beforeBrowsing = await exportedSession(fixture.sessionId);
      const result = await host.command(
        fixture.sessionId,
        navigation === "navigate_tree"
          ? { type: navigation, targetId: fixture.older.answerId }
          : { type: navigation, entryId: fixture.older.userId },
      );
      assert.equal(result.leafId, fixture.older.answerId);
      await host.client.call("sessions.context", { id: fixture.sessionId, leafId: result.leafId });
      assert.equal(
        await exportedSession(fixture.sessionId),
        beforeBrowsing,
        "browsing does not dirty the session file",
      );
      const question = `${navigation}: continue on the chosen model`;
      await whileModelIsAnswering(
        fixture,
        fixture.firstQuestion,
        () => host.prompt(fixture.sessionId, question),
        async () => {
          const beforeSteer = choiceRecords(SessionManager.open(fixture.filePath));
          await host.command(fixture.sessionId, {
            type: "prompt",
            message: "Keep the answer short.",
            streamingBehavior: "steer",
          });
          assert.deepEqual(
            choiceRecords(SessionManager.open(fixture.filePath)),
            beforeSteer,
            "steering adds no choice records mid-turn",
          );
          assert.deepEqual(recordedChoiceBefore(fixture, question), CHOSEN_CHOICE);
        },
      );
      const beforeNextTurn = choiceRecords(SessionManager.open(fixture.filePath));
      await whileModelIsAnswering(
        fixture,
        fixture.firstQuestion,
        () => host.prompt(fixture.sessionId, `${navigation}: one more question`),
        () =>
          assert.deepEqual(
            choiceRecords(SessionManager.open(fixture.filePath)),
            beforeNextTurn,
            "an unchanged choice is not recorded again",
          ),
      );
    },
  );
}

const activeReads = [
  ["sessions.get full history", (fixture) => host.client.call("sessions.get", { id: fixture.sessionId })],
  [
    "sessions.get newest page",
    (fixture) => host.client.call("sessions.get", { id: fixture.sessionId, historyWindow: { maxTurns: 1 } }),
  ],
  ["sessions.context default leaf", (fixture) => host.client.call("sessions.context", { id: fixture.sessionId })],
  [
    "sessions.context explicit active leaf",
    (fixture) => host.client.call("sessions.context", { id: fixture.sessionId, leafId: fixture.older.answerId }),
  ],
  [
    "sessions.context newest page",
    (fixture) =>
      host.client.call("sessions.context", {
        id: fixture.sessionId,
        leafId: fixture.older.answerId,
        historyWindow: { maxTurns: 1 },
      }),
  ],
];

for (const [name, read] of activeReads) {
  test(
    `${name} reports the live choice while another historical leaf retains its branch choice`,
    { timeout: 30_000 },
    async () => {
      const fixture = await seededSession(name.replaceAll(" ", "-"));
      await chooseModel(fixture);
      await host.command(fixture.sessionId, { type: "navigate_tree", targetId: fixture.older.answerId });
      const beforeReads = await exportedSession(fixture.sessionId);
      const active = await read(fixture);
      const historical = await host.client.call("sessions.context", {
        id: fixture.sessionId,
        leafId: fixture.newer.answerId,
        historyWindow: { maxTurns: 1 },
      });
      assert.equal(await exportedSession(fixture.sessionId), beforeReads, "history reads do not append choice records");
      assert.deepEqual(
        { active: choiceOf(active.context), historical: choiceOf(historical.context) },
        { active: CHOSEN_CHOICE, historical: ORIGINAL_CHOICE },
      );
    },
  );
}

test(
  "older history pages use the live choice only when their cursor belongs to the active leaf",
  { timeout: 30_000 },
  async () => {
    const fixture = await seededSession("history-cursor-choice");
    await chooseModel(fixture);
    await host.command(fixture.sessionId, { type: "navigate_tree", targetId: fixture.older.answerId });
    const active = await host.client.call("sessions.context", {
      id: fixture.sessionId,
      leafId: fixture.older.answerId,
      historyWindow: { maxTurns: 1 },
    });
    const historical = await host.client.call("sessions.context", {
      id: fixture.sessionId,
      leafId: fixture.newer.answerId,
      historyWindow: { maxTurns: 1 },
    });
    assert.equal(typeof active.context.previousCursor, "string");
    assert.equal(typeof historical.context.previousCursor, "string");
    const activePage = await host.client.call("sessions.contextPage", {
      id: fixture.sessionId,
      cursor: active.context.previousCursor,
      maxTurns: 1,
    });
    const historicalPage = await host.client.call("sessions.contextPage", {
      id: fixture.sessionId,
      cursor: historical.context.previousCursor,
      maxTurns: 1,
    });
    assert.deepEqual(
      { active: choiceOf(activePage.context), historical: choiceOf(historicalPage.context) },
      { active: CHOSEN_CHOICE, historical: ORIGINAL_CHOICE },
    );
  },
);

test(
  "a model restored only from an assistant signature gets an explicit choice record before the next turn",
  { timeout: 30_000 },
  async () => {
    const fixture = await seededSession("signature-fallback", { explicitModel: false, thinkingLevel: "off" });
    assert.deepEqual(choiceOf((await host.detail(fixture.sessionId)).context), {
      model: ORIGINAL_MODEL,
      thinkingLevel: "off",
    });
    assert.equal(
      choiceRecords(SessionManager.open(fixture.filePath)).some((entry) => entry.type === "model_change"),
      false,
    );
    const question = "signature-fallback: continue with the restored model";
    await whileModelIsAnswering(
      fixture,
      fixture.firstQuestion,
      () => host.prompt(fixture.sessionId, question),
      () => assert.deepEqual(recordedChoiceBefore(fixture, question), { model: ORIGINAL_MODEL, thinkingLevel: "off" }),
    );
  },
);

test(
  "turn anchoring records thinking off even when the model itself has not changed",
  { timeout: 30_000 },
  async () => {
    const fixture = await seededSession("thinking-off");
    await host.command(fixture.sessionId, { type: "set_thinking_level", level: "off" });
    await host.command(fixture.sessionId, { type: "navigate_tree", targetId: fixture.older.answerId });
    const state = await host.command(fixture.sessionId, { type: "get_state" });
    assert.equal(state.thinkingLevel, "off");
    const question = "thinking-off: answer without thinking";
    await whileModelIsAnswering(
      fixture,
      fixture.firstQuestion,
      () => host.prompt(fixture.sessionId, question),
      () => assert.deepEqual(recordedChoiceBefore(fixture, question), { model: ORIGINAL_MODEL, thinkingLevel: "off" }),
    );
  },
);

for (const turn of ["external", "orchestrated"]) {
  test(
    `${turn} turns anchor the current model and thinking level after branch navigation`,
    { timeout: 30_000 },
    async () => {
      const fixture = await seededSession(`${turn}-turn`);
      await chooseModel(fixture);
      await host.command(fixture.sessionId, { type: "navigate_tree", targetId: fixture.older.answerId });
      const wrapper = host.module.getRpcSession(fixture.sessionId);
      const message = `${turn}: continue with the chosen model`;
      await whileModelIsAnswering(
        fixture,
        fixture.firstQuestion,
        () =>
          turn === "external"
            ? wrapper.runExternalTurn({ runId: "model-choice-sync", channel: "telegram", message })
            : wrapper.runOrchestratedTurn({ message }),
        () => assert.deepEqual(recordedChoiceBefore(fixture, message), CHOSEN_CHOICE),
      );
    },
  );
}

test(
  "an edited question remains in its version group and reopens with the model and thinking level chosen for its reply",
  { timeout: 30_000 },
  async () => {
    const fixture = await seededSession("edit-reopen");
    await chooseModel(fixture);
    const edited = "edit-reopen: corrected first question";
    await whileModelIsAnswering(
      fixture,
      edited,
      () => host.command(fixture.sessionId, { type: "edit_message", entryId: fixture.first.userId, message: edited }),
      () => {},
    );
    const detail = await host.detail(fixture.sessionId);
    const question = detail.context.messages.find((message) => message.role === "user");
    assert.equal(
      question.versions.entryIds.length,
      2,
      "choice records do not split the edited question into a different version group",
    );
    assert.equal(question.versions.entryIds[0], fixture.first.userId);
    assert.equal(question.versions.index, 1);
    await host.restart();
    const cold = choiceOf((await host.detail(fixture.sessionId)).context);
    const restored = await host.command(fixture.sessionId, { type: "get_state" });
    assert.deepEqual(
      { cold, resumed: { model: restored.model, thinkingLevel: restored.thinkingLevel } },
      {
        cold: CHOSEN_CHOICE,
        resumed: { model: { provider: CHOSEN_MODEL.provider, id: CHOSEN_MODEL.modelId }, thinkingLevel: "off" },
      },
    );
  },
);
