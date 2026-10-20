import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  SESSION_TOOL_NAMES,
  expectToolPayload,
  resultQueue,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "orchestration-tool-contract", settings: ENABLED_SETTINGS });
after(() => host.close());

const PARALLEL_GUIDELINE = "To run work in parallel, start every session without wait first, then wait on them.";

async function promptAndCaptureRequest(sessionId, text) {
  const before = host.model.requests().length;
  await host.prompt(sessionId, text);
  await waitUntil(() => host.model.requests().length > before, {
    timeoutMs: 20_000,
    label: "the model to receive the turn",
  });
  return host.model.requests()[before];
}

function systemPromptOf(request) {
  const instruction = request.messages.find((message) => message.role === "system" || message.role === "developer");
  assert.ok(instruction, "the turn carries the system prompt");
  return textOf(instruction);
}

function sessionToolsOf(request) {
  const tools = (request.tools ?? []).filter((tool) => tool.function?.name?.startsWith("session_"));
  return new Map(tools.map((tool) => [tool.function.name, tool.function]));
}

test("the system prompt lists all seven session tools so the Agent knows they exist", { timeout: 60_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("contract-prompt") });
  host.model.script("Say hello", [{ text: "Hello" }]);
  const request = await promptAndCaptureRequest(parent, "Say hello");
  const prompt = systemPromptOf(request);

  for (const name of SESSION_TOOL_NAMES) {
    assert.match(prompt, new RegExp(`^- ${name}: \\S`, "m"), `${name} must appear in the available tools list`);
  }
});

test(
  "every session tool parameter explains itself to the model, including the wait limits",
  { timeout: 60_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("contract-parameters") });
    host.model.script("Describe your tools", [{ text: "Described" }]);
    const request = await promptAndCaptureRequest(parent, "Describe your tools");
    const tools = sessionToolsOf(request);

    assert.deepEqual([...tools.keys()].sort(), [...SESSION_TOOL_NAMES].sort(), "all seven tools are offered");
    for (const [name, definition] of tools) {
      assert.ok(definition.description?.trim(), `${name} must describe what it does`);
      const properties = definition.parameters?.properties ?? {};
      assert.ok(Object.keys(properties).length > 0, `${name} declares its parameters`);
      for (const [parameter, schema] of Object.entries(properties)) {
        assert.ok(
          typeof schema.description === "string" && schema.description.trim(),
          `${name}.${parameter} must explain what it means`,
        );
      }
    }

    for (const name of ["session_new", "session_prompt", "session_wait"]) {
      const timeout = tools.get(name).parameters.properties.timeoutSeconds;
      assert.match(timeout.description, /second/i, `${name}.timeoutSeconds states its unit`);
      assert.match(timeout.description, /900/, `${name}.timeoutSeconds states the default`);
      assert.match(timeout.description, /7200/, `${name}.timeoutSeconds states the maximum`);
    }
    for (const name of ["session_new", "session_prompt"]) {
      assert.ok(tools.get(name).parameters.properties.wait.description, `${name}.wait is described`);
    }
    assert.match(tools.get("session_list").parameters.properties.limit.description, /30/);
    assert.match(tools.get("session_list").parameters.properties.limit.description, /100/);

    const newMessage = tools.get("session_new").parameters.properties.message.description;
    const promptMessage = tools.get("session_prompt").parameters.properties.message.description;
    assert.notEqual(newMessage, promptMessage, "the first message and a later message are explained differently");
    assert.deepEqual(Object.keys(tools.get("session_read").parameters.properties), ["sessionId"]);
  },
);

test("the guideline for working in parallel reaches the model exactly once", { timeout: 60_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("contract-guideline") });
  host.model.script("Say hello again", [{ text: "Hello again" }]);
  const request = await promptAndCaptureRequest(parent, "Say hello again");
  const prompt = systemPromptOf(request);

  assert.equal(
    prompt.split(PARALLEL_GUIDELINE).length - 1,
    1,
    "the parallel work guideline appears once even though two tools carry it",
  );
});

test("one step waits on two busy sessions at the same time", { timeout: 90_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("contract-parallel") });
  const firstMessage = "First worker stays busy";
  const secondMessage = "Second worker stays busy";
  const firstWorker = host.model.script(firstMessage, [{ hold: true, partial: "First worker", rest: " is done" }]);
  const secondWorker = host.model.script(secondMessage, [{ hold: true, partial: "Second worker", rest: " is done" }]);
  let firstId;
  let secondId;
  host.model.script("Start two workers and wait on both", [
    toolCall("session_new", { message: firstMessage, wait: false }),
    toolCall("session_new", { message: secondMessage, wait: false }),
    { text: "Two workers are up" },
    {
      toolCalls: [
        { name: "session_wait", input: () => ({ sessionId: firstId, timeoutSeconds: 30 }) },
        { name: "session_wait", input: () => ({ sessionId: secondId, timeoutSeconds: 30 }) },
      ],
    },
    { text: "Both workers are done" },
  ]);
  const events = host.events(parent);
  const results = resultQueue(host);

  await host.prompt(parent, "Start two workers and wait on both");
  firstId = expectToolPayload(await results.named("session_new"), "the first worker must be created").sessionId;
  secondId = expectToolPayload(await results.named("session_new"), "the second worker must be created").sessionId;
  await Promise.all([firstWorker.partialSent(0), secondWorker.partialSent(0)]);

  await host.prompt(parent, "Wait for both workers");
  await waitUntil(
    () =>
      events.all.filter((event) => event.type === "tool_execution_start" && event.toolName === "session_wait")
        .length === 2,
    { timeoutMs: 15_000, label: "both waits to be in flight at the same time" },
  );

  firstWorker.release(0);
  secondWorker.release(0);
  const waits = [await results.named("session_wait"), await results.named("session_wait")];
  for (const wait of waits) {
    assert.equal(expectToolPayload(wait, "both waits must be answered").status, "idle");
  }
});
