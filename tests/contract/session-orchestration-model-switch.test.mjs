import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  expectToolRefusal,
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
  name: "session-model-switch",
  models: MODELS,
  settings: ENABLED_SETTINGS,
});
after(() => host.close());

function callLater(name, input) {
  return { toolCall: { name, input } };
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

async function enabledModels(cwd, refs) {
  return host.client.call("models.preferences.set", { cwd, enabledModels: refs });
}

async function waitForPickerWithout(cwd, modelId) {
  await waitUntil(
    async () => !(await host.client.call("models.list", { cwd })).models.some((model) => model.id === modelId),
    { timeoutMs: 20_000, label: `the model picker to stop showing ${modelId}` },
  );
}

test(
  "the session list and the session read of a worker report its model, its thinking level and whether that model can be used",
  { timeout: 120_000 },
  async () => {
    const cwd = host.workspace("switch-reporting");
    const parent = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    const workerTask = "Worker reports the model it runs on.";
    let childId;
    host.model.script(workerTask, [{ text: "The worker answered on its own model" }]);
    host.model.script("Start a worker and ask what it runs on", [
      toolCall("session_new", {
        message: workerTask,
        model: { provider: "held-fixture", modelId: "held-model-b" },
        thinkingLevel: "high",
        wait: false,
      }),
      { text: "Worker started" },
      toolCall("session_list", {}),
      { text: "Listed" },
      callLater("session_read", () => ({ sessionId: childId })),
      { text: "Read" },
      callLater("session_models", () => ({})),
      { text: "Models listed" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Start a worker and ask what it runs on");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "The worker answered on its own model");

    await host.prompt(parent, "List the sessions of this project");
    const listed = expectToolPayload((await results.next())[0], "the sessions of this project must be listed");
    const row = listed.sessions.find((session) => session.sessionId === childId);
    assert.ok(row, "the worker appears in the list");
    assert.deepEqual(row.model, { provider: "held-fixture", modelId: "held-model-b" }, "the row names its model");
    assert.equal(row.thinkingLevel, "high", "the row names its thinking level");
    assert.equal(row.modelAvailable, true, "the row says its model can be used");

    await host.prompt(parent, "Read the worker");
    const read = expectToolPayload((await results.next())[0], "the worker must be readable");
    assert.deepEqual(
      read.model,
      { provider: "held-fixture", modelId: "held-model-b" },
      "the read view names its model",
    );
    assert.equal(read.thinkingLevel, "high", "the read view names its thinking level");
    assert.equal(read.modelAvailable, true, "the read view says its model can be used");

    await host.prompt(parent, "Which models may I hand out?");
    const offered = expectToolPayload((await results.next())[0], "the models the Agent may hand out must be listed");
    const picker = await host.client.call("models.list", { cwd });
    const refOf = (entry) => `${entry.provider}/${entry.modelId ?? entry.id}`;
    assert.deepEqual(
      offered.models.map(refOf).sort(),
      picker.models.map(refOf).sort(),
      "the Agent is offered exactly the models the model picker shows",
    );
    for (const model of offered.models) {
      assert.equal(typeof model.name, "string", `${refOf(model)} comes with a name`);
      assert.ok(Array.isArray(model.thinkingLevels), `${refOf(model)} comes with its thinking levels`);
    }
  },
);

test(
  "the Agent can move an idle worker to another model and the worker stays on it after Dexon is reopened",
  { timeout: 120_000 },
  async () => {
    const cwd = host.workspace("switch-happy");
    const parent = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    const workerTask = "Worker waits on the first model.";
    let childId;
    host.model.script(workerTask, [{ text: "The worker answered on the first model" }]);
    host.model.script("Start a worker on the first model", [
      toolCall("session_new", {
        message: workerTask,
        model: { provider: "held-fixture", modelId: "held-model-b" },
        thinkingLevel: "high",
        wait: false,
      }),
      { text: "Worker started" },
      callLater("session_set_model", () => ({
        sessionId: childId,
        model: { provider: "held-fixture", modelId: "held-model-c" },
      })),
      { text: "Worker moved" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Start a worker on the first model");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "The worker answered on the first model");
    const defaultsBefore = await host.client.call("models.defaults.get", { cwd });

    const events = host.events(parent);
    await host.prompt(parent, "Move that worker to the other model");
    const payload = expectToolPayload((await results.next())[0], "the worker must be moved to the other model");
    const ended = await events.next(
      (event) => event.type === "tool_execution_end" && event.toolName === "session_set_model",
    );
    events.off();

    const expectedSwitch = {
      from: { provider: "held-fixture", modelId: "held-model-b" },
      to: { provider: "held-fixture", modelId: "held-model-c" },
    };
    assert.equal(payload.sessionId, childId);
    assert.deepEqual(
      payload.previous,
      { model: expectedSwitch.from, thinkingLevel: "high" },
      "the report says which model and thinking level the worker had",
    );
    assert.deepEqual(payload.current.model, expectedSwitch.to, "the report says which model the worker has now");
    assert.equal(ended.result.details.targetSessionId, childId, "the card is told which session it moved");
    assert.deepEqual(ended.result.details.modelSwitch.from, expectedSwitch.from, "the card is told the old model");
    assert.deepEqual(ended.result.details.modelSwitch.to, expectedSwitch.to, "the card is told the new model");
    assert.equal(
      ended.result.details.modelSwitch.thinkingLevel,
      payload.current.thinkingLevel,
      "the card is told the thinking level the worker kept",
    );

    const state = await host.state(childId);
    assert.deepEqual(state.state.model, { id: "held-model-c", provider: "held-fixture" });

    assert.deepEqual(
      await host.client.call("models.defaults.get", { cwd }),
      defaultsBefore,
      "moving a worker leaves the default model and the default thinking level alone",
    );

    await host.restart();
    const reopened = await openSession(childId);
    assert.deepEqual(
      reopened.model,
      { id: "held-model-c", provider: "held-fixture" },
      "the worker stays on the model it was moved to after Dexon is reopened",
    );
  },
);

test(
  "moving a worker that thinks hard to a model that cannot think turns its thinking off",
  { timeout: 120_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("switch-clamp") });
    const workerTask = "Worker thinks hard on the first model.";
    let childId;
    host.model.script(workerTask, [{ text: "The worker thought hard once" }]);
    host.model.script("Start a worker that thinks hard", [
      toolCall("session_new", {
        message: workerTask,
        model: { provider: "held-fixture", modelId: "held-model-b" },
        thinkingLevel: "high",
        wait: false,
      }),
      { text: "Worker started" },
      callLater("session_set_model", () => ({
        sessionId: childId,
        model: { provider: "held-fixture", modelId: "held-model-plain" },
      })),
      { text: "Worker moved" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Start a worker that thinks hard");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "The worker thought hard once");

    await host.prompt(parent, "Move that worker to a model without thinking");
    const payload = expectToolPayload((await results.next())[0], "the worker must move to the plain model");
    assert.equal(payload.current.thinkingLevel, "off", "a model that cannot think leaves thinking off");

    const state = await host.state(childId);
    assert.equal(state.state.thinkingLevel, "off", "the worker really stops thinking");
  },
);

test("moving only the thinking level of a worker keeps its model", { timeout: 120_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("switch-thinking-only") });
  const workerTask = "Worker takes one task before the thinking level changes.";
  let childId;
  host.model.script(workerTask, [{ text: "The worker answered at medium" }]);
  host.model.script("Start a worker that thinks at medium", [
    toolCall("session_new", {
      message: workerTask,
      model: { provider: "held-fixture", modelId: "held-model-b" },
      thinkingLevel: "medium",
      wait: false,
    }),
    { text: "Worker started" },
    callLater("session_set_model", () => ({ sessionId: childId, thinkingLevel: "low" })),
    { text: "Worker thinks less" },
  ]);
  const results = resultReader(host);

  await host.prompt(parent, "Start a worker that thinks at medium");
  childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
  await waitForReply(childId, "The worker answered at medium");

  await host.prompt(parent, "Ask that worker to think a little less");
  const payload = expectToolPayload((await results.next())[0], "the thinking level of the worker must change");
  assert.deepEqual(
    payload.current.model,
    { provider: "held-fixture", modelId: "held-model-b" },
    "the worker keeps its model",
  );
  assert.equal(payload.current.thinkingLevel, "low", "the worker thinks less now");

  const state = await host.state(childId);
  assert.equal(state.state.thinkingLevel, "low");
  assert.deepEqual(state.state.model, { id: "held-model-b", provider: "held-fixture" });
});

test("a worker that is still answering cannot be moved to another model", { timeout: 120_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("switch-busy") });
  const workerTask = "Worker keeps answering for a while.";
  let childId;
  const worker = host.model.script(workerTask, [{ hold: true, partial: "Worker is still", rest: " answering" }]);
  host.model.script("Start a worker that keeps answering", [
    toolCall("session_new", {
      message: workerTask,
      model: { provider: "held-fixture", modelId: "held-model-b" },
      thinkingLevel: "high",
      wait: false,
    }),
    { text: "Worker started" },
    callLater("session_set_model", () => ({
      sessionId: childId,
      model: { provider: "held-fixture", modelId: "held-model-c" },
    })),
    { text: "Move refused" },
  ]);
  const results = resultReader(host);

  await host.prompt(parent, "Start a worker that keeps answering");
  childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
  await worker.partialSent(0);
  await waitUntil(
    async () => {
      const state = await host.state(childId);
      return state.running && state.state.isPromptRunning;
    },
    { timeoutMs: 20_000, label: "the worker to be busy" },
  );

  await host.prompt(parent, "Move the busy worker anyway");
  const refusal = expectToolRefusal(
    (await results.next())[0],
    "a worker that is still answering must not be moved",
    /busy|running/i,
  );
  assert.match(refusal, /wait/i, "the refusal says the Agent has to wait");
  assert.match(refusal, /finish/i, "the refusal says the Agent has to wait for the turn to finish");

  worker.release(0);
  await waitForReply(childId, "Worker is still answering");
  const state = await host.state(childId);
  assert.deepEqual(
    state.state.model,
    { id: "held-model-b", provider: "held-fixture" },
    "the refused move left the worker on its model",
  );
});

test("a worker cannot be moved to a model the model picker does not show", { timeout: 120_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("switch-unusable") });
  const workerTask = "Worker takes a task before an impossible model switch.";
  let childId;
  host.model.script(workerTask, [{ text: "The worker answered before the switch" }]);
  host.model.script("Start a worker before an impossible switch", [
    toolCall("session_new", {
      message: workerTask,
      model: { provider: "held-fixture", modelId: "held-model-b" },
      wait: false,
    }),
    { text: "Worker started" },
    callLater("session_set_model", () => ({
      sessionId: childId,
      model: { provider: "held-fixture", modelId: "held-model-gone" },
    })),
    { text: "Move refused" },
  ]);
  const results = resultReader(host);

  await host.prompt(parent, "Start a worker before an impossible switch");
  childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
  await waitForReply(childId, "The worker answered before the switch");

  await host.prompt(parent, "Move that worker to a model that is not installed");
  const refusal = expectToolRefusal(
    (await results.next())[0],
    "a worker must not move to a model that is not installed",
    /held-model-gone/,
  );
  assert.match(refusal, /unavailable/i, "the refusal says the model is unavailable");

  const state = await host.state(childId);
  assert.deepEqual(
    state.state.model,
    { id: "held-model-b", provider: "held-fixture" },
    "the refused move left the worker on its model",
  );
});

test(
  "the Agent can move only the workers it started, never the reader's own sessions nor another Agent's workers",
  { timeout: 120_000 },
  async () => {
    const cwd = host.workspace("switch-ownership");
    const firstParent = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    const workerTask = "Worker belongs to the first Agent.";
    let childId;
    const firstResults = resultReader(host);
    host.model.script(workerTask, [{ text: "The worker answered once" }]);
    host.model.script("Start a worker that belongs to you", [
      toolCall("session_new", {
        message: workerTask,
        model: { provider: "held-fixture", modelId: "held-model-b" },
        wait: false,
      }),
      { text: "Worker started" },
    ]);
    await host.prompt(firstParent, "Start a worker that belongs to you");
    childId = expectToolPayload((await firstResults.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "The worker answered once");

    const readersSession = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    const secondParent = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    const results = resultReader(host);
    host.model.script("Move the reader's own conversation to another model", [
      callLater("session_set_model", () => ({
        sessionId: readersSession,
        model: { provider: "held-fixture", modelId: "held-model-c" },
      })),
      { text: "Move refused" },
      callLater("session_set_model", () => ({
        sessionId: childId,
        model: { provider: "held-fixture", modelId: "held-model-c" },
      })),
      { text: "Move refused" },
    ]);

    await host.prompt(secondParent, "Move the reader's own conversation to another model");
    expectToolRefusal(
      (await results.next())[0],
      "the reader's own conversation must not be moved even when user sessions are allowed",
      /own|created|allowed|forbidden|permission/i,
    );
    assert.deepEqual(
      (await host.state(readersSession)).state.model,
      { id: "held-model", provider: "held-fixture" },
      "the reader's own conversation kept its model",
    );

    await host.prompt(secondParent, "Move another Agent's worker");
    expectToolRefusal(
      (await results.next())[0],
      "a worker that another Agent started must not be moved",
      /own|created|allowed|forbidden|permission/i,
    );
    assert.deepEqual(
      (await host.state(childId)).state.model,
      { id: "held-model-b", provider: "held-fixture" },
      "the other Agent's worker kept its model",
    );
  },
);

test(
  "a worker whose model was unchecked in the model list is reported as not available and drops out of the models the Agent may hand out",
  { timeout: 150_000 },
  async (t) => {
    const cwd = host.workspace("switch-unavailable-report");
    const parent = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    const workerTask = "Worker runs on the model that will be unchecked.";
    let childId;
    host.model.script(workerTask, [{ text: "The worker answered on the unchecked model" }]);
    host.model.script("Start a worker on the model that will be unchecked", [
      toolCall("session_new", {
        message: workerTask,
        model: { provider: "held-fixture", modelId: "held-model-c" },
        wait: false,
      }),
      { text: "Worker started" },
      toolCall("session_list", {}),
      { text: "Listed" },
      callLater("session_models", () => ({})),
      { text: "Models listed" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Start a worker on the model that will be unchecked");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "The worker answered on the unchecked model");

    t.after(() => enabledModels(cwd, null));
    await enabledModels(cwd, ["held-fixture/held-model", "held-fixture/held-model-b"]);
    await waitForPickerWithout(cwd, "held-model-c");

    await host.prompt(parent, "List the sessions of this project");
    const listed = expectToolPayload((await results.next())[0], "the sessions of this project must be listed");
    const row = listed.sessions.find((session) => session.sessionId === childId);
    assert.ok(row, "the worker appears in the list");
    assert.equal(row.modelAvailable, false, "the row says the worker's model can no longer be used");

    await host.prompt(parent, "Which models may I hand out now?");
    const offered = expectToolPayload((await results.next())[0], "the models the Agent may hand out must be listed");
    const refOf = (entry) => `${entry.provider}/${entry.modelId ?? entry.id}`;
    const offeredRefs = offered.models.map(refOf);
    assert.equal(
      offeredRefs.includes("held-fixture/held-model-c"),
      false,
      "the unchecked model is no longer reported to the Agent",
    );
    const picker = await host.client.call("models.list", { cwd });
    assert.deepEqual(
      [...offeredRefs].sort(),
      picker.models.map(refOf).sort(),
      "the Agent is still offered exactly the models the model picker shows",
    );
  },
);

test(
  "after a task was refused for an unavailable model the Agent can move the worker and hand it the task again",
  { timeout: 150_000 },
  async (t) => {
    const cwd = host.workspace("switch-recovery");
    const parent = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    const firstTask = "Worker takes the first task before its model disappears.";
    const secondTask = "Worker takes the task that failed before.";
    let childId;
    host.model.script(firstTask, [
      { text: "The worker answered the first task" },
      { text: "The worker answered the task that failed before" },
    ]);
    host.model.script("Start a worker on a model that will be unchecked", [
      toolCall("session_new", {
        message: firstTask,
        model: { provider: "held-fixture", modelId: "held-model-c" },
        wait: false,
      }),
      { text: "Worker started" },
      callLater("session_prompt", () => ({ sessionId: childId, message: secondTask, wait: true })),
      { text: "The task failed" },
      callLater("session_set_model", () => ({
        sessionId: childId,
        model: { provider: "held-fixture", modelId: "held-model-b" },
      })),
      { text: "Worker moved" },
      callLater("session_prompt", () => ({ sessionId: childId, message: secondTask, wait: true })),
      { text: "The worker answered" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Start a worker on a model that will be unchecked");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "The worker answered the first task");

    t.after(() => enabledModels(cwd, null));
    await enabledModels(cwd, ["held-fixture/held-model", "held-fixture/held-model-b"]);
    await waitForPickerWithout(cwd, "held-model-c");

    await host.prompt(parent, "Hand the worker the task");
    const refused = expectToolPayload((await results.next())[0], "the task must be refused");
    assert.equal(refused.status, "error", "the task cannot run on the unavailable model");

    await host.prompt(parent, "Move the worker to a model I can use");
    const moved = expectToolPayload((await results.next())[0], "the worker must be moved");
    assert.deepEqual(moved.current.model, { provider: "held-fixture", modelId: "held-model-b" });

    await host.prompt(parent, "Hand the worker the task again");
    const answered = expectToolPayload((await results.next())[0], "the worker must answer the task now");
    assert.equal(answered.lastReply, "The worker answered the task that failed before");
    const reply = await waitForReply(childId, "The worker answered the task that failed before");
    assert.equal(reply.model, "held-model-b", "the answer was written by the model the Agent moved the worker to");
  },
);
