import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { ENABLED_SETTINGS, startSessionOrchestrationHost, waitUntil } from "../support/session-orchestration-host.mjs";

const PROVIDER = "held-fixture";

const UP_TO_HIGH = { id: "held-model", reasoning: true };
const UP_TO_HIGH_TOO = { id: "held-model-b", reasoning: true };
const WITH_EXTRA_AND_MAX = {
  id: "held-model-max",
  reasoning: true,
  thinkingLevelMap: { xhigh: "xhigh", max: "max" },
};
const WITHOUT_THINKING = { id: "held-model-plain", reasoning: false };

const SHARED_LEVEL = "high";
const PER_MODEL_LEVEL = "max";

const host = await startSessionOrchestrationHost({
  name: "session-thinking-level",
  models: [UP_TO_HIGH, UP_TO_HIGH_TOO, WITH_EXTRA_AND_MAX, WITHOUT_THINKING],
  settings: ENABLED_SETTINGS,
  agentSettings: {
    defaultThinkingLevel: SHARED_LEVEL,
    modelThinkingLevels: { [`${PROVIDER}/${WITH_EXTRA_AND_MAX.id}`]: PER_MODEL_LEVEL },
  },
});
after(() => host.close());

function keyOf(model) {
  return `${PROVIDER}:${model.id}`;
}

async function announcedLevels(cwd) {
  const listed = await host.client.call("models.list", { cwd });
  assert.ok(
    listed.effectiveThinkingLevels,
    "models.list must announce, for every model, the reasoning level a new conversation in this folder would use",
  );
  return listed.effectiveThinkingLevels;
}

async function announcedLevel(cwd, model) {
  return (await announcedLevels(cwd))[keyOf(model)];
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

function withOwnWorkspaceDefault(workspace, thinkingLevel) {
  mkdirSync(path.join(workspace, ".pi"), { recursive: true });
  writeFileSync(
    path.join(workspace, ".pi", "settings.json"),
    JSON.stringify({ defaultThinkingLevel: thinkingLevel }),
    "utf8",
  );
  return workspace;
}

test("when the shared default level is high, a model with no level of its own is announced with high", async () => {
  const cwd = host.workspace("thinking-shared-default");
  const openedBefore = (await host.sessions()).length;
  const runningBefore = await host.runningIds();
  const listed = await host.client.call("models.list", { cwd });
  assert.equal(
    (await host.sessions()).length,
    openedBefore,
    "asking which level a new conversation would use does not add a conversation",
  );
  assert.deepEqual(
    await host.runningIds(),
    runningBefore,
    "asking which level a new conversation would use does not start a conversation",
  );
  assert.deepEqual(
    Object.keys(listed.effectiveThinkingLevels ?? {}).sort(),
    listed.models.map((model) => `${model.provider}:${model.id}`).sort(),
    "every model the picker lists is announced with the level a new conversation on it would reason at",
  );
  assert.equal(
    await announcedLevel(cwd, UP_TO_HIGH),
    SHARED_LEVEL,
    "a fresh conversation on that model reasons at the shared default",
  );
});

test("a model with its own level of max is announced with max even though the shared default is high", async () => {
  const cwd = host.workspace("thinking-per-model-wins");
  assert.equal(
    await announcedLevel(cwd, WITH_EXTRA_AND_MAX),
    PER_MODEL_LEVEL,
    "the model's own level wins over the shared default",
  );
});

test("when the shared default is max, a model that reasons up to high is announced with high and a model that cannot reason is announced with off", async (t) => {
  t.after(() => host.writeAgentSettings({ defaultThinkingLevel: SHARED_LEVEL }));
  await host.writeAgentSettings({ defaultThinkingLevel: "max" });
  const cwd = host.workspace("thinking-clamped");

  assert.equal(
    await announcedLevel(cwd, UP_TO_HIGH),
    "high",
    "the announced level is lowered to the highest level that model can reason at",
  );
  assert.equal(
    await announcedLevel(cwd, WITHOUT_THINKING),
    "off",
    "a model that cannot reason at all is announced with reasoning off",
  );
});

test("a folder that sets its own default level is announced with that level while other folders keep the shared one", async () => {
  const ownFolder = withOwnWorkspaceDefault(host.workspace("thinking-own-folder"), "low");
  const otherFolder = host.workspace("thinking-other-folder");

  assert.equal(
    await announcedLevel(ownFolder, UP_TO_HIGH),
    "low",
    "the folder's own default level wins for conversations started in that folder",
  );
  assert.equal(
    await announcedLevel(otherFolder, UP_TO_HIGH),
    SHARED_LEVEL,
    "another folder keeps the shared default level",
  );
  assert.equal(
    await announcedLevel(ownFolder, WITH_EXTRA_AND_MAX),
    PER_MODEL_LEVEL,
    "a model's own level still wins over the folder's default",
  );
});

test("switching an open conversation to a model with its own level of max answers max straight away", async () => {
  const cwd = host.workspace("thinking-switch-per-model");
  const sessionId = await host.createUserSession({
    cwd,
    provider: PROVIDER,
    modelId: UP_TO_HIGH.id,
    thinkingLevel: "low",
  });
  await openSession(sessionId);

  const answer = await host.command(sessionId, {
    type: "set_model",
    provider: PROVIDER,
    modelId: WITH_EXTRA_AND_MAX.id,
  });
  assert.deepEqual(
    { id: answer.id, provider: answer.provider },
    { id: WITH_EXTRA_AND_MAX.id, provider: PROVIDER },
    "the answer names the model the conversation now runs on",
  );
  assert.equal(
    answer.thinkingLevel,
    PER_MODEL_LEVEL,
    "the answer reports the reasoning level the conversation uses right after the switch",
  );
  assert.equal(
    (await host.state(sessionId)).state.thinkingLevel,
    PER_MODEL_LEVEL,
    "the conversation itself reasons at that level",
  );
});

test("switching an open conversation to a model with no level of its own answers the shared default", async () => {
  const cwd = host.workspace("thinking-switch-shared");
  const sessionId = await host.createUserSession({
    cwd,
    provider: PROVIDER,
    modelId: UP_TO_HIGH.id,
    thinkingLevel: "low",
  });
  await openSession(sessionId);

  const answer = await host.command(sessionId, {
    type: "set_model",
    provider: PROVIDER,
    modelId: UP_TO_HIGH_TOO.id,
  });
  assert.equal(
    answer.thinkingLevel,
    SHARED_LEVEL,
    "the answer reports the shared default level, not the level the conversation had before",
  );
  assert.equal(
    (await host.state(sessionId)).state.thinkingLevel,
    SHARED_LEVEL,
    "the conversation itself reasons at the shared default level",
  );
});

test("the level announced for a model is the level a conversation started on that model really uses", async () => {
  const cwd = host.workspace("thinking-announced-versus-real");
  const announced = await announcedLevel(cwd, WITH_EXTRA_AND_MAX);
  assert.equal(announced, PER_MODEL_LEVEL, "the model's own level is the one announced for it");

  const sessionId = await host.createUserSession({ cwd, provider: PROVIDER, modelId: WITH_EXTRA_AND_MAX.id });
  const state = await openSession(sessionId);
  assert.equal(
    state.thinkingLevel,
    announced,
    "a conversation started on that model reasons at exactly the level announced for it",
  );
});
