import assert from "node:assert/strict";
import test, { after } from "node:test";
import { runAgentTurn, startSessionOrchestrationHost, toolCall } from "../support/session-orchestration-host.mjs";

const MODELS = [
  { id: "held-model", reasoning: true },
  { id: "held-model-b", reasoning: true },
  { id: "held-model-c", reasoning: true },
  { id: "held-model-d", reasoning: true },
];

const host = await startSessionOrchestrationHost({
  name: "orchestration-launch-report",
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

async function launchReport(parentCwd, input, label) {
  const parent = await host.createUserSession({
    cwd: parentCwd,
    provider: "held-fixture",
    modelId: "held-model-b",
    thinkingLevel: "high",
  });
  host.model.script(input.message, [{ text: "Working" }]);
  const events = host.events(parent);
  await runAgentTurn(host, parent, {
    prompt: `Start the ${label} worker`,
    steps: [toolCall("session_new", input), { text: "Started" }],
  });
  const ended = events.all.find((event) => event.type === "tool_execution_end" && event.toolName === "session_new");
  assert.ok(ended, "the session_new card receives its result");
  return ended.result.details.launch;
}

test(
  "when the tool call leaves model, thinking and directory out, the result reports the ones the new session really uses",
  { timeout: 60_000 },
  async () => {
    const parentCwd = host.workspace("launch-defaults");
    const launch = await launchReport(parentCwd, { message: "Report what you run on" }, "default");
    assert.deepEqual(launch, {
      model: { provider: "held-fixture", modelId: "held-model-c" },
      thinkingLevel: "low",
      cwd: parentCwd,
    });
  },
);

test(
  "when the tool call names a model and thinking level, the result reports those for the new session",
  { timeout: 60_000 },
  async () => {
    const parentCwd = host.workspace("launch-explicit");
    const launch = await launchReport(
      parentCwd,
      {
        message: "Report the explicit choice",
        model: { provider: "held-fixture", modelId: "held-model-d" },
        thinkingLevel: "medium",
      },
      "explicit",
    );
    assert.deepEqual(launch, {
      model: { provider: "held-fixture", modelId: "held-model-d" },
      thinkingLevel: "medium",
      cwd: parentCwd,
    });
  },
);
