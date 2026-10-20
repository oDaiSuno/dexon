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

const host = await startSessionOrchestrationHost({ name: "orchestration-wait-seconds", settings: ENABLED_SETTINGS });
after(() => host.close());

async function assistantTexts(sessionId) {
  const detail = await host.detail(sessionId);
  return detail.context.messages.filter((message) => message.role === "assistant").map(textOf);
}

async function waitForReply(sessionId, expected) {
  await waitUntil(
    async () => {
      const texts = await assistantTexts(sessionId);
      return texts.at(-1) === expected;
    },
    { timeoutMs: 20_000, label: `session ${sessionId} to reply` },
  );
}

test("a wait longer than two hours is refused while two hours is allowed", { timeout: 90_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("wait-limit-parent") });
  const childMessage = "Worker answers at once";
  host.model.script(childMessage, [{ text: "Answered" }]);
  let childId;
  host.model.script("Try the wait limits", [
    toolCall("session_new", { message: childMessage, wait: false }),
    { text: "Worker started" },
    { toolCall: { name: "session_wait", input: () => ({ sessionId: childId, timeoutSeconds: 7_201 }) } },
    { text: "Refused" },
    { toolCall: { name: "session_wait", input: () => ({ sessionId: childId, timeoutSeconds: 7_200 }) } },
    { text: "Allowed" },
  ]);
  const results = resultReader(host);

  await host.prompt(parent, "Try the wait limits");
  childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
  await waitForReply(childId, "Answered");

  await host.prompt(parent, "Ask for a wait above the limit");
  expectToolRefusal((await results.next())[0], "a wait of 7201 seconds must be refused", /7200/);

  await host.prompt(parent, "Ask for a wait of exactly two hours");
  const allowed = expectToolPayload((await results.next())[0], "a wait of 7200 seconds must be allowed");
  assert.equal(allowed.status, "idle", "a settled session answers a two hour wait at once");
});

test("a wait of zero seconds reports the current state and returns at once", { timeout: 90_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("wait-zero-parent") });
  const childMessage = "Worker stays busy while the parent looks";
  const child = host.model.script(childMessage, [{ hold: true, partial: "Still busy", rest: " and done" }]);
  let childId;
  host.model.script("Look at the worker without waiting", [
    toolCall("session_new", { message: childMessage, wait: false }),
    { text: "Worker started" },
    { toolCall: { name: "session_wait", input: () => ({ sessionId: childId, timeoutSeconds: 0 }) } },
    { text: "Looked" },
  ]);
  const results = resultReader(host);

  await host.prompt(parent, "Look at the worker without waiting");
  childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
  await child.partialSent(0);

  const startedAt = Date.now();
  await host.prompt(parent, "Check the worker now");
  const looked = expectToolPayload((await results.next())[0], "the Agent must receive the current state");
  const elapsed = Date.now() - startedAt;

  assert.equal(looked.status, "timeout", "a busy session has nothing to settle yet");
  assert.equal(looked.stillRunning, true, "the worker is still running");
  assert.ok(elapsed < 5_000, `a zero second wait must return at once, but it took ${elapsed}ms`);
  assert.equal((await host.state(childId)).running, true, "looking at the worker did not stop it");

  child.release(0);
  await waitForReply(childId, "Still busy and done");
});

test("a wait of one second returns after about a second instead of an hour", { timeout: 90_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("wait-second-parent") });
  const childMessage = "Worker takes far longer than the wait";
  const child = host.model.script(childMessage, [{ hold: true, partial: "Slow work", rest: " finished" }]);
  let childId;
  host.model.script("Wait one second for the worker", [
    toolCall("session_new", { message: childMessage, wait: false }),
    { text: "Worker started" },
    { toolCall: { name: "session_wait", input: () => ({ sessionId: childId, timeoutSeconds: 1 }) } },
    { text: "Waited" },
  ]);
  const events = host.events(parent);
  const results = resultReader(host);

  const startedAt = events
    .next((event) => event.type === "tool_execution_start" && event.toolName === "session_wait")
    .then(() => Date.now());
  const endedAt = events
    .next((event) => event.type === "tool_execution_end" && event.toolName === "session_wait")
    .then(() => Date.now());
  const safetyRelease = setTimeout(() => child.release(0), 4_000);

  try {
    await host.prompt(parent, "Wait one second for the worker");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await child.partialSent(0);

    await host.prompt(parent, "Wait for the worker now");
    const waited = (await endedAt) - (await startedAt);

    assert.ok(waited >= 900, `a one second wait must last about a second, but it lasted ${waited}ms`);
    assert.ok(waited < 4_000, `a one second wait must not last much longer, but it lasted ${waited}ms`);
    const payload = expectToolPayload((await results.next())[0], "the Agent must receive its wait result");
    assert.equal(payload.status, "timeout");
    assert.equal(payload.stillRunning, true);
  } finally {
    clearTimeout(safetyRelease);
    child.release(0);
  }
});
