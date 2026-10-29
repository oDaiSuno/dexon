import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import {
  collectEvents,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "session-block-timing" });
after(() => host.close());

const PARTIAL_ANSWER = "The notes say ";
const REST_OF_ANSWER = "hello.";

function savedEntries(prompt) {
  const directory = path.join(host.base, "sessions");
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".jsonl"))) {
    const entries = readFileSync(path.join(directory, name), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (!JSON.stringify(entries).includes(prompt)) continue;
    return entries;
  }
  throw new Error(`no saved conversation holds “${prompt}”`);
}

function savedReplies(prompt) {
  return savedEntries(prompt)
    .filter((entry) => entry.type === "message" && entry.message?.role === "assistant")
    .map((entry) => entry.message);
}

async function runTurn(label, prompt, steps, hold) {
  const session = await host.createUserSession({ cwd: host.workspace(label) });
  const scripted = host.model.script(prompt, steps);
  const events = collectEvents(host.client, session);
  await host.prompt(session, prompt);
  if (hold) await hold(scripted, events);
  await events.next((event) => event.type === "agent_settled");
  const detail = await waitUntil(
    async () => {
      const state = await host.state(session);
      return state.state?.isPromptRunning === false ? await host.detail(session) : null;
    },
    { timeoutMs: 30_000, label: `the ${label} turn to finish` },
  );
  events.off();
  return { session, detail, events };
}

function assistantUpdates(events) {
  return events.all.filter((event) => event.type === "message_update" && event.message?.role === "assistant");
}

function streamBlockTypes(events) {
  return assistantUpdates(events)
    .map((event) => event.assistantMessageEvent?.type)
    .filter((type) => /^(thinking|text)_(start|end)$/.test(type ?? ""));
}

async function waitForPartialAnswer(events) {
  return waitUntil(() => assistantUpdates(events).some((event) => textOf(event.message).includes(PARTIAL_ANSWER)), {
    timeoutMs: 10_000,
    label: "the partial answer to reach the renderer",
  });
}

function holdAnswerWithPause(scripted, events, pauseMs) {
  return (async () => {
    await scripted.partialSent(0);
    await waitForPartialAnswer(events);
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    scripted.release(0);
  })();
}

function holdAnswerToInspect(scripted, events, inspect) {
  return (async () => {
    await scripted.partialSent(0);
    await waitForPartialAnswer(events);
    inspect(events);
    scripted.release(0);
  })();
}

test(
  "when a reply pauses in the middle of its answer, the saved line records when each of its content blocks started and ended",
  { timeout: 60_000 },
  async () => {
    const prompt = "Time every block of this reply";
    const { events } = await runTurn(
      "block-times",
      prompt,
      [{ thinking: "Read the notes first", hold: true, partial: PARTIAL_ANSWER, rest: REST_OF_ANSWER }],
      (scripted, streamed) => holdAnswerWithPause(scripted, streamed, 300),
    );

    assert.deepEqual(
      streamBlockTypes(events),
      ["thinking_start", "text_start", "thinking_end", "text_end"],
      "the stream begins each block, and reports blocks finished only when it ends",
    );

    const [reply] = savedReplies(prompt);
    assert.ok(reply, "the reply was saved to the conversation file");
    assert.equal(reply.content.length, 2, "the reply holds a thinking block and an answer-text block");
    const timing = reply.dexonTiming;
    assert.ok(timing, "the saved reply carries the time of each of its blocks");
    assert.equal(timing.blocks.length, reply.content.length, "every content block has one start and one end");
    const [thinking, answer] = timing.blocks;
    for (const block of timing.blocks) {
      assert.equal(typeof block?.startedAt, "number", "every block records when it started");
      assert.equal(typeof block?.endedAt, "number", "every block records when it ended");
      assert.ok(block.endedAt >= block.startedAt, "no block ends before it started");
    }
    assert.ok(
      thinking.startedAt <= answer.startedAt,
      `the blocks record the order the stream began them: thinking at ${thinking.startedAt}, answer text at ${answer.startedAt}`,
    );
    assert.ok(
      thinking.endedAt <= answer.startedAt,
      `the thinking block is closed as soon as the answer text begins, not when the whole stream ends: it ended at ${thinking.endedAt}, the answer began at ${answer.startedAt}`,
    );
    assert.ok(
      answer.endedAt - answer.startedAt >= 250,
      `the answer text records the pause it contained: expected at least 250ms, got ${answer.endedAt - answer.startedAt}ms`,
    );
    assert.ok(
      thinking.endedAt - thinking.startedAt < 250,
      `the length of the thinking leaves out the time spent writing the answer: expected under 250ms, got ${thinking.endedAt - thinking.startedAt}ms`,
    );

    const finished = events.all.find((event) => event.type === "message_end" && event.message?.role === "assistant");
    assert.ok(finished, "the renderer was told the reply had finished");
    assert.deepEqual(
      finished.message.dexonTiming,
      timing,
      "the notification that ends the reply already carries every block, complete, exactly as the conversation file holds them",
    );
  },
);

test(
  "while a reply is still being written, every message notification carries the times recorded so far and leaves the newest block open",
  { timeout: 60_000 },
  async () => {
    const prompt = "Show the times while this answer is still being written";
    await runTurn(
      "streaming-times",
      prompt,
      [{ thinking: "Check the notes", hold: true, partial: PARTIAL_ANSWER, rest: REST_OF_ANSWER }],
      (scripted, streamed) =>
        holdAnswerToInspect(scripted, streamed, (events) => {
          const updates = assistantUpdates(events);
          assert.ok(updates.length >= 3, "the renderer saw the thinking and the answer text arrive");
          for (const event of updates) {
            const phase = event.assistantMessageEvent?.type ?? "unknown";
            const timing = event.message.dexonTiming;
            assert.ok(timing, `the notification from the “${phase}” phase carries the times recorded so far`);
            assert.ok(
              timing.blocks.length >= 1,
              `the notification from the “${phase}” phase already knows the first block`,
            );
            assert.equal(
              typeof timing.blocks[0].startedAt,
              "number",
              `the first block reports when it started (${phase})`,
            );
          }
          const timing = updates.at(-1).message.dexonTiming;
          assert.equal(timing.blocks.length, 2, "the thinking block and the answer text block are known by then");
          assert.equal(typeof timing.blocks[1].startedAt, "number", "the answer text reports when it started");
          assert.equal(
            timing.blocks[1].endedAt,
            undefined,
            "the answer text is still being written, so it has no end yet",
          );
          assert.equal(
            typeof timing.blocks[0].endedAt,
            "number",
            "the thinking block is already closed, because the answer text that follows it has begun",
          );
          assert.ok(
            timing.blocks[0].endedAt <= timing.blocks[1].startedAt,
            `the thinking block ends no later than the moment the answer text begins: thinking ended at ${timing.blocks[0].endedAt}, the answer began at ${timing.blocks[1].startedAt}`,
          );
        }),
    );

    const [saved] = savedReplies(prompt);
    assert.ok(saved?.dexonTiming, "the finished reply was saved with its times");
    assert.equal(saved.dexonTiming.blocks.length, saved.content.length, "every block is recorded once the reply ends");
    for (const block of saved.dexonTiming.blocks) {
      assert.equal(typeof block.endedAt, "number", "the end of the stream closes every block that was still open");
    }
  },
);

test(
  "when the reply is stopped while it is still being written, the saved line closes its blocks at the moment of the stop",
  { timeout: 60_000 },
  async () => {
    const prompt = "Stop this answer while it is still being written";
    const session = await host.createUserSession({ cwd: host.workspace("stopped-times") });
    const scripted = host.model.script(prompt, [
      { thinking: "Check the notes", hold: true, partial: PARTIAL_ANSWER, rest: REST_OF_ANSWER },
    ]);
    const events = collectEvents(host.client, session);
    await host.prompt(session, prompt);
    await scripted.partialSent(0);
    await waitForPartialAnswer(events);

    const stopAskedAt = Date.now();
    await host.command(session, { type: "abort" });
    await events.next((event) => event.type === "agent_settled");
    const stoppedAt = Date.now();
    events.off();

    const [reply] = await waitUntil(
      () => {
        const replies = savedReplies(prompt);
        return replies.length > 0 ? replies : null;
      },
      { timeoutMs: 10_000, label: "the stopped reply to be saved" },
    );
    assert.equal(reply.stopReason, "aborted", "the saved reply says it was stopped");
    assert.equal(reply.content.length, 2, "the reply keeps the thinking and the words written before the stop");
    const timing = reply.dexonTiming;
    assert.ok(timing, "the stopped reply carries the time of each of its blocks");
    assert.equal(timing.blocks.length, reply.content.length, "every content block has one start and one end");
    const [thinking, answer] = timing.blocks;
    for (const block of timing.blocks) {
      assert.equal(typeof block?.startedAt, "number", "every block records when it started");
      assert.equal(typeof block?.endedAt, "number", "the stop closes every block that was still open");
      assert.ok(block.endedAt >= block.startedAt, "no block ends before it started");
    }
    assert.ok(
      thinking.endedAt <= answer.startedAt,
      `the thinking block was already closed when the answer text began, so the stop leaves its end alone: thinking ended at ${thinking.endedAt}, the answer began at ${answer.startedAt}`,
    );
    assert.ok(
      answer.endedAt >= stopAskedAt,
      `the answer text was still open when the reader stopped, so it ends at the stop: ${answer.endedAt} is before ${stopAskedAt}`,
    );
    assert.ok(
      answer.endedAt <= stoppedAt,
      `a block closed by the stop does not run past the stop: ${answer.endedAt} is after ${stoppedAt}`,
    );
  },
);

test("the recorded times stay in the conversation and are never sent to the model", { timeout: 60_000 }, async () => {
  const prompt = "Read the notes and tell me what they say";
  const cwd = host.workspace("times-not-sent");
  writeFileSync(path.join(cwd, "notes.txt"), "hello");
  const { events } = await runTurn("times-not-sent", prompt, [
    { thinking: "Read the notes", ...toolCall("read", { path: "notes.txt" }) },
    { text: "The notes say hello." },
  ]);

  const requests = host.model.requests();
  assert.ok(requests.length >= 2, "the model was asked again after the tool result");
  for (const [index, request] of requests.entries()) {
    assert.equal(
      JSON.stringify(request.messages).includes("dexonTiming"),
      false,
      `request ${index + 1} must not carry the recorded times`,
    );
  }

  const [firstReply] = savedReplies(prompt);
  assert.ok(firstReply?.dexonTiming, "the reply was saved with its times, so the check above is not empty");
  assert.deepEqual(
    firstReply.content.map((block) => block.type),
    ["thinking", "toolCall"],
    "the reply reads: a thinking step first, then the call that reads the notes",
  );
  assert.equal(
    firstReply.dexonTiming.blocks.length,
    firstReply.content.length,
    "the tool call is timed like every other content block, so every block of the reply has one entry",
  );
  const [thinking, tool] = firstReply.dexonTiming.blocks;
  assert.ok(
    thinking.startedAt <= tool.startedAt,
    `the entries follow the order of the content: thinking at ${thinking.startedAt}, the tool call at ${tool.startedAt}`,
  );
  assert.ok(
    thinking.endedAt <= tool.startedAt,
    `the thinking block ends when the tool call begins: thinking ended at ${thinking.endedAt}, the tool call began at ${tool.startedAt}`,
  );
  assert.equal(typeof tool.endedAt, "number", "the tool call block is closed when the stream ends");

  const finished = events.all.find((event) => event.type === "message_end" && event.message?.role === "assistant");
  assert.ok(finished, "the renderer was told the reply had finished");
  assert.deepEqual(
    finished.message.dexonTiming,
    firstReply.dexonTiming,
    "the notification that ends the reply carries the same times the conversation file holds",
  );
});

test(
  "when a reader starts a new session at a timed answer, the new session keeps the times of that answer",
  { timeout: 60_000 },
  async () => {
    const prompt = "Answer this so I can start a new session at it";
    const { session, detail } = await runTurn("fork-keeps-times", prompt, [{ text: "The answer stands." }]);

    const answerIndex = detail.context.messages.findIndex((message) => message.role === "assistant");
    assert.ok(answerIndex > 0, "the turn saved an answer after the question");
    const timing = detail.context.messages[answerIndex].dexonTiming;
    assert.ok(timing, "the answer carries its times before the fork");
    const answerEntryId = detail.context.entryIds[answerIndex];

    await host.client.call("sessions.list");
    const forked = await host.command(session, { type: "fork", entryId: answerEntryId, position: "at" });
    assert.equal(forked.cancelled, false, "the fork went ahead");

    const copy = await host.detail(forked.newSessionId);
    const copiedAnswer = copy.context.messages.find((message) => message.role === "assistant");
    assert.ok(copiedAnswer, "the new session holds the answer it was started from");
    assert.deepEqual(copiedAnswer.dexonTiming, timing, "the new session keeps the times of that answer");
  },
);

test(
  "when the app is reopened, a timed answer still reaches the renderer with the same times",
  { timeout: 60_000 },
  async () => {
    const prompt = "Answer this so I can reopen the conversation";
    const { session, detail } = await runTurn("reopen-keeps-times", prompt, [{ text: "The answer stands." }]);

    const answerIndex = detail.context.messages.findIndex((message) => message.role === "assistant");
    const timing = detail.context.messages[answerIndex]?.dexonTiming;
    assert.ok(timing, "the answer reaches the renderer with its times while the app is open");
    const [saved] = savedReplies(prompt);
    assert.deepEqual(timing, saved.dexonTiming, "the renderer reads what the conversation file holds");

    await host.restart();

    const reopened = await host.detail(session);
    const reopenedAnswer = reopened.context.messages.find((message) => message.role === "assistant");
    assert.ok(reopenedAnswer, "the reopened conversation holds the answer");
    assert.deepEqual(reopenedAnswer.dexonTiming, timing, "reopening changes neither the times nor their blocks");
  },
);
