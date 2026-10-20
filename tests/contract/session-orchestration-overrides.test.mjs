import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  expectToolPayload,
  runAgentTurn,
  startSessionOrchestrationHost,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const MODELS = [
  { id: "held-model", reasoning: true },
  { id: "held-model-b", reasoning: true },
  { id: "held-model-c", reasoning: true },
  { id: "held-model-d", reasoning: true },
];

// The collaborator model Settings section: every Agent-created session runs on
// the cheaper model at a lower thinking level unless the Agent says otherwise.
const host = await startSessionOrchestrationHost({
  name: "orchestration-overrides",
  models: MODELS,
  settings: {
    enabled: true,
    maxRunning: 8,
    model: { provider: "held-fixture", modelId: "held-model-c" },
    thinkingLevel: "low",
    allowUserSessions: true,
  },
});
after(() => host.close());

async function liveState(sessionId) {
  return waitUntil(
    async () => {
      const result = await host.state(sessionId);
      return result.running ? result.state : null;
    },
    { timeoutMs: 10_000, label: "the created session to be live" },
  );
}

test(
  "the model and thinking level chosen in Settings replace the creator's own for a created session",
  { timeout: 60_000 },
  async () => {
    const parent = await host.createUserSession({
      cwd: host.workspace("settings-parent"),
      provider: "held-fixture",
      modelId: "held-model-b",
      thinkingLevel: "high",
    });
    const childMessage = "Use the configured collaborator model";
    host.model.script(childMessage, [{ text: "Configured" }]);

    const [received] = await runAgentTurn(host, parent, {
      prompt: "Start a worker on the configured model",
      steps: [toolCall("session_new", { message: childMessage }), { text: "Started" }],
    });
    const childId = expectToolPayload(received, "the model must receive a session_new result").sessionId;

    const state = await liveState(childId);
    assert.deepEqual(state.model, { id: "held-model-c", provider: "held-fixture" });
    assert.equal(state.thinkingLevel, "low");
  },
);

test(
  "a model and thinking level asked for in the tool call win over both the creator and Settings",
  { timeout: 60_000 },
  async () => {
    const parent = await host.createUserSession({
      cwd: host.workspace("explicit-parent"),
      provider: "held-fixture",
      modelId: "held-model-b",
      thinkingLevel: "high",
    });
    const childMessage = "Think hard on this one";
    host.model.script(childMessage, [{ text: "Thought hard" }]);

    const [received] = await runAgentTurn(host, parent, {
      prompt: "Start a worker on a stronger model",
      steps: [
        toolCall("session_new", {
          message: childMessage,
          model: { provider: "held-fixture", modelId: "held-model-d" },
          thinkingLevel: "medium",
        }),
        { text: "Started" },
      ],
    });
    const childId = expectToolPayload(received, "the model must receive a session_new result").sessionId;

    const state = await liveState(childId);
    assert.deepEqual(state.model, { id: "held-model-d", provider: "held-fixture" });
    assert.equal(state.thinkingLevel, "medium");
  },
);
