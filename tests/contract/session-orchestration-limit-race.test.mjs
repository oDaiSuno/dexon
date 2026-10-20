import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  expectToolRefusal,
  resultReader,
  startSessionOrchestrationHost,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({
  name: "orchestration-limit-race",
  settings: {
    enabled: true,
    maxRunning: 1,
    model: null,
    thinkingLevel: null,
    allowUserSessions: true,
  },
});
after(() => host.close());

function createdFrom(toolResult) {
  try {
    const value = JSON.parse(toolResult.content);
    return typeof value?.sessionId === "string" ? value.sessionId : undefined;
  } catch {
    return undefined;
  }
}

test(
  "two sessions asking for a worker at the same moment start only one when just one slot is free",
  { timeout: 90_000 },
  async () => {
    const alice = await host.createUserSession({ cwd: host.workspace("race-alice") });
    const bob = await host.createUserSession({ cwd: host.workspace("race-bob") });
    const aliceWorker = "Alice worker takes its time";
    const bobWorker = "Bob worker takes its time";
    const aliceChild = host.model.script(aliceWorker, [{ hold: true, partial: "Alice worker", rest: " is busy" }]);
    const bobChild = host.model.script(bobWorker, [{ hold: true, partial: "Bob worker", rest: " is busy" }]);
    host.model.script("Alice starts a worker", [
      toolCall("session_new", { message: aliceWorker, wait: false }),
      { text: "Alice asked for a worker" },
    ]);
    host.model.script("Bob starts a worker", [
      toolCall("session_new", { message: bobWorker, wait: false }),
      { text: "Bob asked for a worker" },
    ]);
    const results = resultReader(host);

    await Promise.all([host.prompt(alice, "Alice starts a worker"), host.prompt(bob, "Bob starts a worker")]);
    const answers = await results.next(2);
    const created = answers.map(createdFrom).filter(Boolean);
    const refused = answers.find((answer) => createdFrom(answer) === undefined);

    assert.equal(created.length, 1, "exactly one of the two simultaneous requests starts a worker");
    expectToolRefusal(refused, "the other request must be refused", /limit|max|at most/i);

    const listed = await waitUntil(
      async () => {
        const sessions = await host.sessions();
        const workers = sessions.filter(
          (session) => session.createdBySessionId === alice || session.createdBySessionId === bob,
        );
        return workers.length === 1 ? workers : null;
      },
      { timeoutMs: 10_000, label: "exactly one worker session to exist" },
    );
    assert.equal(listed.length, 1, "the refused request created no session");

    const [createdId] = created;
    await waitUntil(async () => (await host.runningIds()).includes(createdId), {
      timeoutMs: 10_000,
      label: "the accepted worker to be running",
    });

    if (listed[0].createdBySessionId === alice) aliceChild.release(0);
    else bobChild.release(0);
    await waitUntil(
      async () => {
        const running = await host.runningIds();
        return !running.includes(createdId);
      },
      { timeoutMs: 20_000, label: "the accepted worker to finish" },
    );
  },
);
