import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  collectEvents,
  startSessionOrchestrationHost,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({
  name: "retry-attempts-history",
  settings: ENABLED_SETTINGS,
  retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
});
after(() => host.close());

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

test("a failure that was never retried carries no attempt count", { timeout: 60_000 }, async () => {
  const answers = await failedTurn("not-retried", [{ error: { status: 400, message: "bad request from fixture" } }]);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].stopReason, "error");
  assert.equal(answers[0].retry, undefined);
});
