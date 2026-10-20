import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  resultReader,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "orchestration-read-list", settings: ENABLED_SETTINGS });
after(() => host.close());

const LONG_REPLY = `Head of the report ${"x".repeat(360)} tail of the report`;

function recordsMentioning(value, sessionId, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) recordsMentioning(item, sessionId, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  if (Object.values(value).some((entry) => entry === sessionId)) found.push(value);
  for (const entry of Object.values(value)) recordsMentioning(entry, sessionId, found);
  return found;
}

function smallestRecordMentioning(value, sessionId) {
  const candidates = recordsMentioning(value, sessionId);
  assert.notEqual(candidates.length, 0, `the answer must describe session ${sessionId}`);
  return candidates.sort((left, right) => JSON.stringify(left).length - JSON.stringify(right).length)[0];
}

test(
  "reading another session returns its last reply and recent tool calls within the requested size",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("read-parent") });
    const childMessage = "Write a report to disk first";
    host.model.script(childMessage, [toolCall("bash", { command: "echo tool-run" }), { text: LONG_REPLY }]);
    let childId;
    host.model.script("Read the worker's report", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_read", input: () => ({ sessionId: childId, maxChars: 40, toolCalls: 3 }) } },
      { text: "Read it" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "Read the worker's report");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitUntil(
      async () => {
        const detail = await host.detail(childId);
        const last = detail.context.messages.at(-1);
        return last?.role === "assistant" && textOf(last) === LONG_REPLY;
      },
      { timeoutMs: 30_000, label: "the worker to finish its report" },
    );

    await host.prompt(parent, "Read the report now");
    const [, readResult] = await results.next(2);
    assert.equal(readResult.name, "session_read", "after the worker's own bash result comes the Agent's reading");
    const payload = expectToolPayload(readResult, "the Agent must receive what it read");
    const rendered = JSON.stringify(payload);
    assert.ok(rendered.includes(LONG_REPLY.slice(0, 30)), "the beginning of the last reply is reported");
    assert.ok(
      !rendered.includes(LONG_REPLY.slice(-30)),
      "a 40 character reading cannot contain the end of a long reply",
    );
    assert.match(rendered, /bash/, "recent tool calls are summarised by tool name");
  },
);

test(
  "listing sessions reports each session's live status and the session that created it",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("list-parent") });
    const userSession = await host.createUserSession({ cwd: host.workspace("list-user-session") });
    host.model.script("The user's own quiet task", [{ text: "The user's own quiet answer" }]);
    await host.prompt(userSession, "The user's own quiet task");
    await waitUntil(
      async () => {
        const texts = (await host.detail(userSession)).context.messages.map(textOf);
        return texts.includes("The user's own quiet answer");
      },
      { timeoutMs: 30_000, label: "the user's own session to answer" },
    );

    const childMessage = "Stay busy while the parent looks around";
    host.model.script(childMessage, [{ hold: true, partial: "Still working", rest: " and still working" }]);
    let childId;
    host.model.script("List the sessions you can see", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_list", input: () => ({ scope: "all", limit: 50 }) } },
      { text: "Listed" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, "List the sessions you can see");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitUntil(async () => (await host.runningIds()).includes(childId), {
      timeoutMs: 10_000,
      label: "the worker to be running",
    });

    await host.prompt(parent, "List them now");
    const payload = expectToolPayload((await results.next())[0], "the Agent must receive the session list");

    const running = JSON.stringify(smallestRecordMentioning(payload, childId));
    assert.match(running, /:\s*"running"/, "the busy worker is reported as running");
    assert.match(running, new RegExp(parent), "the listing names the session that created it");

    const idle = JSON.stringify(smallestRecordMentioning(payload, userSession));
    assert.doesNotMatch(idle, /:\s*"running"/, "a user session nobody is running is not reported as running");
  },
);
