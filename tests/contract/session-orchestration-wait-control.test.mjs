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

const host = await startSessionOrchestrationHost({ name: "orchestration-wait-control", settings: ENABLED_SETTINGS });
after(() => host.close());

async function withinMs(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not happen within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function assistantTexts(sessionId) {
  const detail = await host.detail(sessionId);
  return detail.context.messages.filter((message) => message.role === "assistant").map(textOf);
}

test(
  "stopping the waiting session ends its wait at once and the awaited session still finishes on its own",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("abort-parent") });
    const childMessage = "Worker keeps working while the parent waits";
    const child = host.model.script(childMessage, [{ hold: true, partial: "Worker is", rest: " still working" }]);
    let childId;
    host.model.script("Start a worker and wait for it", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_wait", input: () => ({ sessionId: childId, timeoutSeconds: 120 }) } },
      { text: "Gave up waiting" },
    ]);
    const events = host.events(parent);
    const results = resultReader(host);

    await host.prompt(parent, "Start a worker and wait for it");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await child.partialSent(0);

    await host.prompt(parent, "Wait for the worker now");
    await events.next((event) => event.type === "tool_execution_start" && event.toolName === "session_wait");

    const stopping = host.command(parent, { type: "abort" }).catch((error) => error);
    await waitUntil(
      async () => {
        const state = await host.state(parent);
        return !state.running || state.state?.isPromptRunning === false;
      },
      { timeoutMs: 15_000, label: "the stopped session to release its turn instead of waiting out the timeout" },
    );
    await withinMs(stopping, 15_000, "stopping the session");

    const childState = await host.state(childId);
    assert.equal(childState.running, true, "the awaited session keeps running after the wait was stopped");

    child.release(0);
    await waitUntil(
      async () => {
        const replies = await assistantTexts(childId);
        return replies.includes("Worker is still working");
      },
      { timeoutMs: 20_000, label: "the awaited session to finish its own turn" },
    );
  },
);

test("a session cannot wait on a session that is already waiting on it", { timeout: 90_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("cycle-parent") });
  const childMessage = "Child asks the parent first";
  let childId;
  host.model.script(childMessage, [
    toolCall("session_prompt", () => ({
      sessionId: parent,
      message: "Child asks for an answer",
      wait: true,
      timeoutSeconds: 20,
    })),
    { text: "Child got its answer" },
  ]);
  host.model.script("Start a child that waits for you", [
    toolCall("session_new", { message: childMessage, wait: false }),
    { text: "Child started" },
    { toolCall: { name: "session_wait", input: () => ({ sessionId: childId, timeoutSeconds: 20 }) } },
    { text: "Refused to wait in a circle" },
  ]);
  const results = resultReader(host);

  await host.prompt(parent, "Start a child that waits for you");
  childId = expectToolPayload((await results.next())[0], "the child must be created").sessionId;

  const refusal = expectToolRefusal(
    (await results.next())[0],
    "waiting on a session that already waits on this one must be refused",
    /cycle/i,
  );
  assert.match(refusal, /cycle/i);

  await waitUntil(
    async () => {
      const replies = await assistantTexts(childId);
      return replies.includes("Child got its answer");
    },
    { timeoutMs: 30_000, label: "the child to get the answer of the turn it asked for" },
  );
});
