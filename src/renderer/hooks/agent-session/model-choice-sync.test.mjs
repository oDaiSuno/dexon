import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_A,
  MODEL_B,
  MODEL_C,
  announceSessionChanged,
  mountHeldSession,
  settle,
  snapshot,
  start,
} from "./model-choice-sync-fixtures.mjs";

const HELD = ["set_model", "set_thinking_level"];

async function mountIdleSession(t, bundleName) {
  const setup = await mountHeldSession(t, { bundleName, heldCommands: HELD });
  await settle(setup.h, () => setup.reads.calls[0].resolve(snapshot()));
  assert.deepEqual(setup.h.state.currentModel, MODEL_A, "the session opens on its recorded model");
  assert.equal(setup.h.state.thinkingLevel, "off");
  return setup;
}

test("a refresh that started before a model switch does not bring the old model back after the switch is confirmed", async (t) => {
  const { h, reads, commands } = await mountIdleSession(t, "model-sync-read-before-switch");

  await announceSessionChanged(h);
  const { pending: switching } = await start(h, () => h.state.handleModelChange(MODEL_B.provider, MODEL_B.modelId));
  await settle(h, async () => {
    commands.calls[0].resolve({ thinkingLevel: "medium" });
    await switching;
  });
  assert.deepEqual(h.state.currentModel, MODEL_B, "the confirmed switch is shown");

  await settle(h, () => reads.calls[1].resolve(snapshot()));
  assert.deepEqual(h.state.currentModel, MODEL_B, "the stale refresh does not restore model A");
  assert.equal(h.state.thinkingLevel, "medium", "the stale refresh does not restore the old reasoning level");
});

test("the picked model stays on the toolbar while the switch is in flight, even when a refresh lands meanwhile", async (t) => {
  const { h, reads, commands } = await mountIdleSession(t, "model-sync-read-during-switch");

  await announceSessionChanged(h);
  const { pending: switching } = await start(h, () => h.state.handleModelChange(MODEL_B.provider, MODEL_B.modelId));
  assert.deepEqual(h.state.currentModel, MODEL_B, "the picked model shows as soon as it is picked");

  await settle(h, () => reads.calls[1].resolve(snapshot()));
  assert.deepEqual(h.state.currentModel, MODEL_B, "a refresh landing mid-switch does not show model A");

  await settle(h, async () => {
    commands.calls[0].resolve({ thinkingLevel: "medium" });
    await switching;
  });
  assert.deepEqual(h.state.currentModel, MODEL_B);
  assert.equal(h.state.thinkingLevel, "medium");
});

test("a refresh that started during a model switch cannot undo it after the switch is confirmed", async (t) => {
  const { h, reads, commands } = await mountIdleSession(t, "model-sync-read-started-mid-switch");

  const { pending: switching } = await start(h, () => h.state.handleModelChange(MODEL_B.provider, MODEL_B.modelId));
  await announceSessionChanged(h);
  await settle(h, async () => {
    commands.calls[0].resolve({ thinkingLevel: "medium" });
    await switching;
  });

  await settle(h, () => reads.calls[1].resolve(snapshot()));
  assert.deepEqual(h.state.currentModel, MODEL_B, "the refresh served before the switch does not restore model A");
  assert.equal(h.state.thinkingLevel, "medium");
});

test("after a switch settles, a later refresh still shows a model the host changed on its own", async (t) => {
  const { h, reads, commands } = await mountIdleSession(t, "model-sync-read-after-switch");

  const { pending: switching } = await start(h, () => h.state.handleModelChange(MODEL_B.provider, MODEL_B.modelId));
  await settle(h, async () => {
    commands.calls[0].resolve({ thinkingLevel: "medium" });
    await switching;
  });

  await announceSessionChanged(h);
  await settle(h, () => reads.calls[1].resolve(snapshot({ model: MODEL_C, thinkingLevel: "high" })));
  assert.deepEqual(h.state.currentModel, MODEL_C, "a refresh started after the switch is trusted");
  assert.equal(h.state.thinkingLevel, "high");
});

test("a refresh that started before a reasoning change does not undo the change", async (t) => {
  const { h, reads, commands } = await mountIdleSession(t, "model-sync-read-before-thinking");

  await announceSessionChanged(h);
  const { pending: changing } = await start(h, () => h.state.handleThinkingLevelChange("high"));
  assert.equal(h.state.thinkingLevel, "high", "the picked level shows as soon as it is picked");

  await settle(h, () => reads.calls[1].resolve(snapshot()));
  assert.equal(h.state.thinkingLevel, "high", "a refresh landing mid-change does not show the old level");

  await settle(h, async () => {
    commands.calls[0].resolve({});
    await changing;
  });
  assert.equal(h.state.thinkingLevel, "high");
});

test("a reasoning level picked while a model switch is in flight survives the model reply", async (t) => {
  const { h, commands } = await mountIdleSession(t, "model-sync-model-then-thinking");

  const { pending: switching } = await start(h, () => h.state.handleModelChange(MODEL_B.provider, MODEL_B.modelId));
  const { pending: changing } = await start(h, () => h.state.handleThinkingLevelChange("high"));

  await settle(h, async () => {
    commands.calls[0].resolve({ thinkingLevel: "medium" });
    await switching;
  });
  assert.deepEqual(h.state.currentModel, MODEL_B);
  assert.equal(h.state.thinkingLevel, "high", "the later reasoning pick outranks the level the model reply reports");

  await settle(h, async () => {
    commands.calls[1].resolve({});
    await changing;
  });
  assert.deepEqual(h.state.currentModel, MODEL_B);
  assert.equal(h.state.thinkingLevel, "high");
});

test("a refused reasoning change falls back to the level the session already had", async (t) => {
  const { h, commands } = await mountIdleSession(t, "model-sync-thinking-refused");

  const { pending: changing } = await start(h, () => h.state.handleThinkingLevelChange("high"));
  await settle(h, async () => {
    commands.calls[0].reject(new Error("host refused the level"));
    await changing;
  });
  assert.equal(h.state.thinkingLevel, "off");
});

test("a refused model switch falls back to the model the session already had", async (t) => {
  const { h, commands } = await mountIdleSession(t, "model-sync-model-refused");

  const { pending: switching } = await start(h, () => h.state.handleModelChange(MODEL_B.provider, MODEL_B.modelId));
  await settle(h, async () => {
    commands.calls[0].reject(new Error("host refused the model"));
    await switching;
  });
  assert.deepEqual(h.state.currentModel, MODEL_A);
  assert.equal(h.state.thinkingLevel, "off");
});

test("an older refused reasoning change does not undo a newer accepted one", async (t) => {
  const { h, commands } = await mountIdleSession(t, "model-sync-overlapping-thinking");

  const { pending: first } = await start(h, () => h.state.handleThinkingLevelChange("high"));
  const { pending: second } = await start(h, () => h.state.handleThinkingLevelChange("low"));
  await settle(h, async () => {
    commands.calls[1].resolve({});
    await second;
  });
  await settle(h, async () => {
    commands.calls[0].reject(new Error("host refused the level"));
    await first;
  });
  assert.equal(h.state.thinkingLevel, "low");
});

test("a refused model switch keeps a reasoning change that the host accepted", async (t) => {
  const { h, commands } = await mountIdleSession(t, "model-sync-model-refused-thinking-kept");

  const { pending: switching } = await start(h, () => h.state.handleModelChange(MODEL_B.provider, MODEL_B.modelId));
  const { pending: changing } = await start(h, () => h.state.handleThinkingLevelChange("high"));
  await settle(h, async () => {
    commands.calls[1].resolve({});
    await changing;
  });
  await settle(h, async () => {
    commands.calls[0].reject(new Error("host refused the model"));
    await switching;
  });
  assert.deepEqual(h.state.currentModel, MODEL_A);
  assert.equal(h.state.thinkingLevel, "high");
});
