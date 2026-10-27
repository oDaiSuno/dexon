import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  collectEvents,
  expectToolPayload,
  resultQueue,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({
  name: "retry-attempts-history",
  settings: ENABLED_SETTINGS,
  retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
});
after(() => host.close());

const busyAnswer = { error: { status: 503, message: "upstream is overloaded" } };

async function settledTurn(label, steps) {
  const session = await host.createUserSession({ cwd: host.workspace(label) });
  const prompt = `Answer the ${label} turn`;
  host.model.script(prompt, steps);
  const events = collectEvents(host.client, session);
  await host.prompt(session, prompt);
  await events.next((event) => event.type === "agent_settled");
  const detail = await waitUntil(
    async () => {
      const state = await host.state(session);
      return state.state?.isPromptRunning === false ? await host.detail(session) : null;
    },
    { timeoutMs: 20_000, label: `the ${label} turn to finish` },
  );
  const listed = await host.client.call("sessions.list");
  return { session, detail, status: listed.sessionStatuses?.[session] };
}

async function failedTurn(label, steps) {
  const session = await host.createUserSession({ cwd: host.workspace(label) });
  const prompt = `Fail the ${label} turn`;
  host.model.script(prompt, steps);
  const events = collectEvents(host.client, session);
  await host.prompt(session, prompt);
  await events.next((event) => event.type === "agent_settled");
  const detail = await waitUntil(
    async () => {
      const current = await host.detail(session);
      return current.context.messages.at(-1)?.role === "assistant" ? current : null;
    },
    { timeoutMs: 10_000, label: "the failed answer to be saved" },
  );
  return detail.context.messages.filter((message) => message.role === "assistant");
}

test(
  "when every automatic retry fails, the saved failure remembers it was attempt 2 of 2",
  { timeout: 60_000 },
  async () => {
    const busy = { error: { status: 503, message: "upstream is overloaded" } };
    const answers = await failedTurn("exhausted", [busy, busy, busy]);
    assert.equal(answers.length, 3, "the first try and both retries are kept in the history");
    assert.deepEqual(answers.at(-1).retry, { attempt: 2, maxAttempts: 2 });
  },
);

test(
  "when the first request fails with 503 and the automatic retry answers, the session is not reported as an error",
  { timeout: 60_000 },
  async () => {
    const turn = await settledTurn("recovered", [busyAnswer, { text: "Recovered answer" }]);
    assert.equal(
      textOf(turn.detail.context.messages.at(-1)),
      "Recovered answer",
      "the answer of the retry is the last thing the turn saved",
    );
    assert.notEqual(
      turn.status,
      "error",
      "a turn whose last result is a normal answer must not be reported as an error",
    );
  },
);

test("when every automatic retry fails, the session is still reported as an error", { timeout: 60_000 }, async () => {
  const turn = await settledTurn("exhausted-status", [busyAnswer, busyAnswer, busyAnswer]);
  assert.equal(turn.status, "error", "a turn whose last result is a failure is reported as an error");
});

test(
  "when a request fails without being retried, the session is still reported as an error",
  { timeout: 60_000 },
  async () => {
    const turn = await settledTurn("not-retried-status", [
      { error: { status: 400, message: "bad request from fixture" } },
    ]);
    assert.equal(turn.status, "error", "a turn that ends on a failure is reported as an error");
  },
);

test(
  "when an Agent asks a session that recovered from a retry, the status it reads is not an error",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("orchestration-recovered") });
    const childMessage = "Recover after one busy answer";
    host.model.script(childMessage, [busyAnswer, { text: "Child recovered answer" }]);
    let childId;
    host.model.script("Start a worker and then read it", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_read", input: () => ({ sessionId: childId }) } },
      { text: "Read the worker" },
    ]);
    const results = resultQueue(host);

    await host.prompt(parent, "Start a worker and then read it");
    childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
    await waitUntil(
      async () => {
        const texts = (await host.detail(childId)).context.messages.map(textOf);
        if (texts.at(-1) !== "Child recovered answer") return false;
        return (await host.state(childId)).state?.isPromptRunning === false;
      },
      { timeoutMs: 30_000, label: "the worker to answer after its retry and finish its turn" },
    );

    await host.prompt(parent, "Read the worker now");
    const payload = expectToolPayload(await results.named("session_read"), "the Agent must receive what it read");
    assert.equal(payload.lastReply, "Child recovered answer", "the answer of the retry comes back to the Agent");
    assert.equal(
      payload.status,
      "idle",
      "the worker ended on a normal answer, so the Agent reads it as finished rather than as failed",
    );
  },
);

test("a failure that was never retried carries no attempt count", { timeout: 60_000 }, async () => {
  const answers = await failedTurn("not-retried", [{ error: { status: 400, message: "bad request from fixture" } }]);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].stopReason, "error");
  assert.equal(answers[0].retry, undefined);
});
