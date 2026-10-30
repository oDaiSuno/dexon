import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  collectEvents,
  startSessionOrchestrationHost,
  textOf,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "session-block-timing-state" });
after(() => host.close());

const PARTIAL_ANSWER = "The notes say ";
const REST_OF_ANSWER = "hello.";

function assistantUpdates(events) {
  return events.all.filter((event) => event.type === "message_update" && event.message?.role === "assistant");
}

async function replyBeingWritten(prompt, label) {
  const session = await host.createUserSession({ cwd: host.workspace(label) });
  const scripted = host.model.script(prompt, [
    { thinking: "Read the notes first", hold: true, partial: PARTIAL_ANSWER, rest: REST_OF_ANSWER },
  ]);
  const events = collectEvents(host.client, session);
  await host.prompt(session, prompt);
  await scripted.partialSent(0);
  await waitUntil(() => assistantUpdates(events).some((event) => textOf(event.message).includes(PARTIAL_ANSWER)), {
    timeoutMs: 10_000,
    label: "the partial answer to reach the renderer",
  });
  const state = await host.state(session);
  scripted.release(0);
  await events.next((event) => event.type === "agent_settled");
  events.off();
  const detail = await waitUntil(
    async () => {
      const current = await host.state(session);
      return current.state?.isPromptRunning === false ? await host.detail(session) : null;
    },
    { timeoutMs: 30_000, label: `the ${label} turn to finish` },
  );
  const saved = detail.context.messages.find(
    (message) => message.role === "assistant" && message.dexonTiming?.blocks?.length > 0,
  );
  return { streaming: state.state.streamingMessage, saved };
}

test(
  "when a reader comes back to a reply that is still being written, the reply carries the times recorded so far",
  { timeout: 60_000 },
  async () => {
    const { streaming, saved } = await replyBeingWritten(
      "Come back to this reply while it is still being written",
      "reopened-while-writing",
    );

    assert.ok(streaming, "the state hands the renderer the reply that is being written");
    assert.ok(streaming.dexonTiming, "the reply that is being written carries the times recorded so far");
    assert.equal(streaming.dexonTiming.blocks.length, 2, "the thinking and the answer text are both known");
    const [thinking, answer] = streaming.dexonTiming.blocks;
    assert.equal(typeof thinking.startedAt, "number", "the thinking reports when it started");
    assert.equal(typeof thinking.endedAt, "number", "the thinking is already closed");
    assert.equal(typeof answer.startedAt, "number", "the answer text reports when it started");
    assert.equal(answer.endedAt, undefined, "the answer text is still open");

    assert.ok(saved?.dexonTiming, "the finished reply was saved with its times");
    assert.deepEqual(
      [thinking.startedAt, thinking.endedAt],
      [saved.dexonTiming.blocks[0].startedAt, saved.dexonTiming.blocks[0].endedAt],
      "the thinking keeps the times the reader already saw while the reply was being written",
    );
  },
);
