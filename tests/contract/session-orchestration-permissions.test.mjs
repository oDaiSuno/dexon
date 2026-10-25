import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  expectToolPayload,
  expectToolRefusal,
  resultReader,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({
  name: "orchestration-permissions",
  settings: {
    enabled: true,
    maxRunning: 8,
    model: null,
    thinkingLevel: null,
    allowUserSessions: false,
  },
});
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
    { timeoutMs: 30_000, label: `session ${sessionId} to reply` },
  );
}

async function waitForRunning(sessionId) {
  await waitUntil(
    async () => {
      const result = await host.state(sessionId);
      return result.running && result.state.isPromptRunning;
    },
    { timeoutMs: 15_000, label: `session ${sessionId} to be busy` },
  );
}

test(
  "with user sessions excluded the Agent may start turns in sessions it created, but not in the user's own sessions",
  { timeout: 90_000 },
  async () => {
    const parentCwd = host.workspace("strict-project");
    const userSession = await host.createUserSession({ cwd: parentCwd });
    host.model.script("The user's own task", [{ text: "The user's own reply" }]);
    await host.prompt(userSession, "The user's own task");
    await waitForReply(userSession, "The user's own reply");
    const before = (await host.detail(userSession)).context.messages.length;

    const parent = await host.createUserSession({ cwd: parentCwd });
    const childMessage = "Worker takes the first half";
    host.model.script(childMessage, [{ text: "First half done" }, { text: "Second half done" }]);
    let childId;
    host.model.script("Delegate the halves", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_prompt", input: () => ({ sessionId: userSession, message: "Do my work" }) } },
      { text: "Refused" },
      {
        toolCall: {
          name: "session_prompt",
          input: () => ({ sessionId: childId, message: "Take the second half", wait: true, timeoutSeconds: 30 }),
        },
      },
      { text: "Worker continued" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Delegate the halves");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "First half done");

    await host.prompt(parent, "Ask the user's session to do the work");
    expectToolRefusal(
      (await results.next())[0],
      "prompting a session the user created must be refused while user sessions are excluded",
    );
    assert.equal(
      (await host.detail(userSession)).context.messages.length,
      before,
      "the refused prompt added nothing to the user's session",
    );

    await host.prompt(parent, "Ask the worker for the second half");
    const payload = expectToolPayload((await results.next())[0], "prompting a session the Agent created must work");
    assert.equal(payload.lastReply, "Second half done");
  },
);

test(
  "the Agent can stop and close only the sessions it created, and a closed session keeps its history",
  { timeout: 120_000 },
  async () => {
    const parentCwd = host.workspace("owned-project");
    const userSession = await host.createUserSession({ cwd: parentCwd });
    const userTurns = host.model.script("The user starts some work", [
      { text: "User answered once" },
      { hold: true, partial: "User second reply", rest: " and it keeps going" },
    ]);
    await host.prompt(userSession, "The user starts some work");
    await waitForReply(userSession, "User answered once");
    await host.prompt(userSession, "The user keeps working");
    await userTurns.partialSent(1);

    const parent = await host.createUserSession({ cwd: parentCwd });
    const childMessage = "Worker owns its own work";
    const child = host.model.script(childMessage, [
      { text: "Worker answered once" },
      { hold: true, partial: "Worker second reply", rest: " and it keeps going" },
    ]);
    let childId;
    host.model.script("Own a worker and try to reach the user's session", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_stop", input: () => ({ sessionId: userSession }) } },
      { text: "Stop refused" },
      { toolCall: { name: "session_stop", input: () => ({ sessionId: childId }) } },
      { text: "Worker stopped" },
      { toolCall: { name: "session_close", input: () => ({ sessionId: userSession }) } },
      { text: "Close refused" },
      { toolCall: { name: "session_close", input: () => ({ sessionId: childId }) } },
      { text: "Worker closed" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Own a worker and try to reach the user's session");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "Worker answered once");
    await host.prompt(childId, "Worker keeps working");
    await child.partialSent(1);
    await waitForRunning(childId);

    await host.prompt(parent, "Stop the user's session");
    expectToolRefusal(
      (await results.next())[0],
      "a session the Agent did not create cannot be stopped",
      /own|created|not allowed|forbidden|permission/i,
    );
    const userState = await host.state(userSession);
    assert.equal(userState.running, true);
    assert.equal(userState.state.isPromptRunning, true, "the user's turn was untouched");

    await host.prompt(parent, "Stop your own worker");
    expectToolPayload((await results.next())[0], "a session the Agent created can be stopped");
    await waitUntil(
      async () => {
        const state = await host.state(childId);
        return state.running && !state.state.isPromptRunning && !state.state.isStreaming;
      },
      { timeoutMs: 20_000, label: "the worker to stop its turn" },
    );

    await host.prompt(parent, "Close the user's session");
    expectToolRefusal(
      (await results.next())[0],
      "a session the Agent did not create cannot be closed",
      /own|created|not allowed|forbidden|permission/i,
    );
    assert.equal((await host.state(userSession)).running, true);

    await host.prompt(parent, "Close your own worker");
    expectToolPayload((await results.next())[0], "a session the Agent created can be closed");
    await waitUntil(
      async () => {
        const state = await host.state(childId);
        return state.running === false;
      },
      { timeoutMs: 20_000, label: "the worker to be released" },
    );
    const row = await host.sessionRow(childId);
    assert.ok(row, "the closed session keeps its place in the history");
    assert.equal(row.firstMessage, childMessage);
  },
);

test(
  "stopping the creator leaves its workers running, and the creator cannot be deleted while a worker runs",
  { timeout: 120_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("independent-parent") });
    const childMessage = "Independent worker";
    const child = host.model.script(childMessage, [{ hold: true, partial: "Working alone", rest: " and finished" }]);
    const parentTurn = host.model.script("Start a worker that outlives you", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { hold: true, partial: "The creator keeps thinking", rest: " and then finishes" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Start a worker that outlives you");
    const childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await child.partialSent(0);
    await waitForRunning(childId);
    await parentTurn.partialSent(1);
    await waitForRunning(parent);

    await host.command(parent, { type: "abort" });
    await waitUntil(async () => (await host.state(parent)).state?.isPromptRunning === false, {
      timeoutMs: 15_000,
      label: "the creator's turn to stop",
    });
    const afterStop = await host.state(childId);
    assert.equal(afterStop.running, true, "the worker stays alive when its creator's turn is stopped");
    assert.equal(afterStop.state.isPromptRunning, true);

    await assert.rejects(
      host.client.call("sessions.delete", { id: parent }),
      (error) => error.code === "CONFLICT",
      "deleting the creator would delete its running worker too, so it is refused",
    );
    const afterDelete = await host.state(childId);
    assert.equal(afterDelete.running, true, "the worker stays alive when deleting its creator is refused");
    assert.ok(await host.sessionRow(parent), "the creator stays in the history");

    child.release(0);
    await waitForReply(childId, "Working alone and finished");
    assert.ok(await host.sessionRow(childId));
  },
);
