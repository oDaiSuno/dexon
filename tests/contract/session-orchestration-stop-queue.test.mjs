import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  resultQueue,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "orchestration-stop-queue", settings: ENABLED_SETTINGS });
after(() => host.close());

async function messagesOf(sessionId) {
  return (await host.detail(sessionId)).context.messages;
}

async function assistantTexts(sessionId) {
  return (await messagesOf(sessionId)).filter((message) => message.role === "assistant").map(textOf);
}

async function userTexts(sessionId) {
  return (await messagesOf(sessionId)).filter((message) => message.role === "user").map(textOf);
}

test(
  "stopping a session drops the messages this session queued and keeps the user's queued message",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("stop-queue-parent") });
    const childMessage = "Worker starts a long job";
    const childTurns = host.model.script(childMessage, [
      { hold: true, partial: "Worker is", rest: " and the long job ends" },
      { text: "The user's message was answered" },
    ]);
    let childId;
    host.model.script("Queue work and stop it", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_prompt", input: () => ({ sessionId: childId, message: "Queued by the agent" }) } },
      {
        toolCall: {
          name: "session_prompt",
          input: () => ({ sessionId: childId, message: "Also queued by the agent" }),
        },
      },
      { text: "Queued" },
      { toolCall: { name: "session_stop", input: () => ({ sessionId: childId }) } },
      { text: "Stopped" },
    ]);
    const results = resultQueue(host);

    await host.prompt(parent, "Queue work and stop it");
    childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
    await childTurns.partialSent(0);

    await host.prompt(parent, "Queue two messages for the worker");
    await results.named("session_prompt");
    await results.named("session_prompt");
    await host.prompt(childId, "The user's own message");

    await host.prompt(parent, "Stop the worker");
    expectToolPayload(await results.named("session_stop"), "stopping an own session must work");

    await waitUntil(
      async () => {
        const replies = await assistantTexts(childId);
        return replies.at(-1) === "The user's message was answered";
      },
      { timeoutMs: 20_000, label: "the user's queued message to run after the stop" },
    );

    const users = await userTexts(childId);
    assert.deepEqual(users, [childMessage, "The user's own message"], "the messages the Agent queued never ran");
    assert.equal(
      (await messagesOf(childId)).some((message) => textOf(message).includes("Queued by the agent")),
      false,
      "nothing the Agent queued reached the worker's history",
    );
  },
);

test(
  "a caller waiting on a turn someone else stops is answered with stopped instead of an error",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("stop-wait-parent") });
    const childMessage = "Say that you are ready";
    const childTurns = host.model.script(childMessage, [
      { text: "Ready" },
      { hold: true, partial: "Working on the queued task", rest: " and done" },
    ]);
    let childId;
    host.model.script("Ask the worker and wait", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      {
        toolCall: {
          name: "session_prompt",
          input: () => ({ sessionId: childId, message: "Do it now", wait: true, timeoutSeconds: 60 }),
        },
      },
      { text: "Someone else stopped it" },
    ]);
    const events = host.events(parent);
    const results = resultQueue(host);

    await host.prompt(parent, "Ask the worker and wait");
    childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
    await waitUntil(async () => (await assistantTexts(childId)).includes("Ready"), {
      timeoutMs: 20_000,
      label: "the worker to become idle",
    });

    await host.prompt(parent, "Ask the worker now");
    await events.next((event) => event.type === "tool_execution_start" && event.toolName === "session_prompt");
    await childTurns.partialSent(1);
    await host.command(childId, { type: "abort" });

    const payload = expectToolPayload(await results.named("session_prompt"), "the caller must be answered");
    assert.equal(payload.status, "stopped", "a stopped turn is reported as stopped");
    assert.equal(payload.error, undefined, "a stopped turn is not an error");
    assert.equal(payload.stillRunning, false, "the worker is no longer running after the stop");
  },
);

test("stopping a session that is not loaded reports it idle without reopening it", { timeout: 90_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("stop-closed-parent") });
  const childMessage = "Answer once and then rest";
  host.model.script(childMessage, [{ text: "Answered" }]);
  let childId;
  host.model.script("Stop a closed worker", [
    toolCall("session_new", { message: childMessage, wait: false }),
    { text: "Worker started" },
    { toolCall: { name: "session_close", input: () => ({ sessionId: childId }) } },
    { text: "Worker closed" },
    { toolCall: { name: "session_stop", input: () => ({ sessionId: childId }) } },
    { text: "Stopped a closed worker" },
  ]);
  const results = resultQueue(host);

  await host.prompt(parent, "Stop a closed worker");
  childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
  await waitUntil(async () => (await assistantTexts(childId)).includes("Answered"), {
    timeoutMs: 20_000,
    label: "the worker to answer",
  });

  await host.prompt(parent, "Close the worker");
  expectToolPayload(await results.named("session_close"), "closing an own session must work");
  await waitUntil(async () => (await host.state(childId)).running === false, {
    timeoutMs: 20_000,
    label: "the worker to be released",
  });

  await host.prompt(parent, "Stop the closed worker");
  const payload = expectToolPayload(await results.named("session_stop"), "stopping a closed session works");
  assert.equal(payload.sessionId, childId);
  assert.equal(payload.status, "idle");
  assert.equal((await host.state(childId)).running, false, "stopping a closed session does not reopen it");
});
