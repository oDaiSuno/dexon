import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  SESSION_TOOL_NAMES,
  expectToolPayload,
  resultReader,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const ASK_COMMAND_EXTENSION = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ask-fixture", {
    description: "Ask the user a question and wait for the answer",
    handler: async (_args, ctx) => {
      await ctx.ui.input("What should the worker do next?");
    },
  });
}
`;

const host = await startSessionOrchestrationHost({
  name: "orchestration-prompt-wait",
  settings: ENABLED_SETTINGS,
  extension: { file: "ask-fixture.ts", source: ASK_COMMAND_EXTENSION },
});
after(() => host.close());

const FIRST_REPLY = "First reply begins and first reply ends";

function heldChild(message, secondReply = "Second reply") {
  return host.model.script(message, [
    { hold: true, partial: "First reply begins", rest: " and first reply ends" },
    { text: secondReply },
  ]);
}

async function assistantTexts(sessionId) {
  const detail = await host.detail(sessionId);
  return detail.context.messages.filter((message) => message.role === "assistant").map(textOf);
}

test(
  "asking a busy session with wait returns the reply of the turn this message caused, not the earlier one",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("wait-parent") });
    const childMessage = "Worker takes the first task";
    const child = heldChild(childMessage);
    let childId;
    host.model.script("Start a worker on the first task", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      {
        toolCall: {
          name: "session_prompt",
          input: () => ({ sessionId: childId, message: "Worker takes the second task", wait: true, timeoutMs: 30_000 }),
        },
      },
      { text: "Second pass finished" },
    ]);
    const events = host.events(parent);
    const results = resultReader(host);

    await host.prompt(parent, "Start a worker on the first task");
    const [created] = await results.next();
    childId = expectToolPayload(created, "the worker must be created").sessionId;
    await child.partialSent(0);

    await host.prompt(parent, "Ask the worker for a second pass");
    await events.next((event) => event.type === "tool_execution_start" && event.toolName === "session_prompt");
    child.release(0);

    const [answer] = await results.next();
    const payload = expectToolPayload(answer, "the Agent must receive the result of its prompt");
    assert.equal(payload.lastReply, "Second reply", "the wait covers the turn caused by this message");
    assert.equal(payload.status, "idle");
    assert.equal(payload.stillRunning, false);
  },
);

test(
  "asking a busy session leaves its current turn running to the end instead of interrupting it",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("queue-parent") });
    const childMessage = "Worker keeps its first task";
    const child = heldChild(childMessage);
    let childId;
    host.model.script("Queue a second task for the worker", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_prompt", input: () => ({ sessionId: childId, message: "Queued task" }) } },
      { text: "Queued" },
    ]);
    const events = host.events(parent);
    const results = resultReader(host);

    await host.prompt(parent, "Queue a second task for the worker");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await child.partialSent(0);

    await host.prompt(parent, "Send the queued task");
    await events.next((event) => event.type === "tool_execution_start" && event.toolName === "session_prompt");
    child.release(0);

    await results.next();
    const replies = await waitUntil(
      async () => {
        const texts = await assistantTexts(childId);
        return texts.length >= 2 ? texts : null;
      },
      { timeoutMs: 20_000, label: "the worker to answer both messages" },
    );
    assert.equal(replies[0], FIRST_REPLY, "the interrupted turn still produced its complete reply");
    assert.equal(replies[1], "Second reply", "the queued message ran as a separate turn afterwards");
  },
);

test(
  "waiting too long reports a timeout while the session keeps working and finishes on its own",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("timeout-parent") });
    const childMessage = "Worker is slow on purpose";
    const child = heldChild(childMessage);
    let childId;
    host.model.script("Start a slow worker", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_wait", input: () => ({ sessionId: childId, timeoutMs: 300 }) } },
      { text: "Gave up waiting" },
    ]);

    const results = resultReader(host);

    await host.prompt(parent, "Start a slow worker");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await child.partialSent(0);

    await host.prompt(parent, "Wait for the slow worker");
    const waited = expectToolPayload((await results.next())[0], "the Agent must receive its wait result");
    assert.equal(waited.status, "timeout");
    assert.equal(waited.stillRunning, true, "a timeout says the other session is still running");
    assert.equal(waited.error, undefined, "a timeout is not an error");
    assert.ok((await host.runningIds()).includes(childId), "the timeout did not cancel the other session");

    child.release(0);
    const finished = await waitUntil(
      async () => {
        const texts = await assistantTexts(childId);
        return texts.at(-1) === FIRST_REPLY ? texts : null;
      },
      { timeoutMs: 20_000, label: "the slow worker to finish after the timeout" },
    );
    assert.deepEqual(finished, [FIRST_REPLY]);
  },
);

test(
  "a session waiting for the user's answer reports awaiting input, and no tool can answer for the user",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("awaiting-parent") });
    let childId;
    host.model.script("Start a worker that needs the user", [
      toolCall("session_new", { message: "/ask-fixture", wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_wait", input: () => ({ sessionId: childId, timeoutMs: 20_000 }) } },
      { text: "The worker needs the user" },
    ]);
    const frames = [];
    const offRunning = host.client.subscribe("agent.running", "*", (frame) => frames.push(frame));
    const results = resultReader(host);

    try {
      await host.prompt(parent, "Start a worker that needs the user");
      childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
      await waitUntil(() => host.sessionRow(childId), { timeoutMs: 10_000, label: "the worker to be listed" });

      await host.prompt(parent, "Wait for the worker");
      const waited = expectToolPayload((await results.next())[0], "the Agent must receive its wait result");
      assert.equal(waited.status, "awaiting_input");
      assert.equal(waited.stillRunning, true);

      const sessionTools = (await host.activeToolNames(childId)).filter((name) => name.startsWith("session_"));
      assert.deepEqual(
        sessionTools,
        [...SESSION_TOOL_NAMES].sort(),
        "no session tool exists for answering the question",
      );

      const listed = await waitUntil(
        async () => {
          const result = await host.client.call("sessions.list");
          return result.sessionStatuses?.[childId] === "awaiting_input" ? result : null;
        },
        { timeoutMs: 10_000, label: "the session list to report the waiting state" },
      );
      assert.equal(listed.sessionStatuses[childId], "awaiting_input");

      assert.ok(
        frames.some((frame) => frame.sessionStatuses?.[childId] === "awaiting_input"),
        "the live status stream reports the waiting state to the sidebar",
      );
    } finally {
      offRunning();
    }
  },
);
