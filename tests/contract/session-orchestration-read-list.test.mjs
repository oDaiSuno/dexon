import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  resultQueue,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "orchestration-read-list", settings: ENABLED_SETTINGS });
after(() => host.close());

const LONG_REPLY = `Head of the report ${"x".repeat(360)} tail of the report`;

test(
  "reading another session returns its last reply and a transcript that keeps the tool results",
  { timeout: 90_000 },
  async () => {
    const workspace = host.workspace("read-parent");
    writeFileSync(path.join(workspace, "report.txt"), "tool-run\n");
    const parent = await host.createUserSession({ cwd: workspace });
    const childMessage = "Write a report to disk first";
    host.model.script(childMessage, [toolCall("read", { path: "report.txt" }), { text: LONG_REPLY }]);
    let childId;
    host.model.script("Read the worker's report", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_read", input: () => ({ sessionId: childId }) } },
      { text: "Read it" },
    ]);
    const results = resultQueue(host);

    await host.prompt(parent, "Read the worker's report");
    childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
    await waitUntil(
      async () => {
        const detail = await host.detail(childId);
        const last = detail.context.messages.at(-1);
        return last?.role === "assistant" && textOf(last) === LONG_REPLY;
      },
      { timeoutMs: 30_000, label: "the worker to finish its report" },
    );

    await host.prompt(parent, "Read the report now");
    const payload = expectToolPayload(await results.named("session_read"), "the Agent must receive what it read");
    assert.equal(payload.lastReply, LONG_REPLY, "the whole last reply comes back in the answer");
    assert.equal(payload.lastReplyTruncated, false, "a short reply is not shortened");

    const transcript = readFileSync(payload.transcript.path, "utf8");
    assert.ok(transcript.includes("tool-run"), "the tool result the worker produced is in the transcript");
    assert.ok(transcript.includes(LONG_REPLY), "the report itself is in the transcript");
  },
);

test(
  "listing sessions reports each session's live status and the session that created it",
  { timeout: 90_000 },
  async () => {
    const parentCwd = host.workspace("list-parent");
    const parent = await host.createUserSession({ cwd: parentCwd });
    const userSession = await host.createUserSession({ cwd: parentCwd });
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
      { toolCall: { name: "session_list", input: () => ({ limit: 50 }) } },
      { text: "Listed" },
    ]);
    const results = resultQueue(host);

    await host.prompt(parent, "List the sessions you can see");
    childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
    await waitUntil(async () => (await host.runningIds()).includes(childId), {
      timeoutMs: 10_000,
      label: "the worker to be running",
    });

    await host.prompt(parent, "List them now");
    const listed = expectToolPayload(await results.named("session_list"), "the Agent must receive the list");
    const bySession = new Map(listed.sessions.map((session) => [session.sessionId, session]));

    assert.equal(bySession.get(childId)?.status, "running", "the busy worker is reported as running");
    assert.equal(bySession.get(childId)?.createdBySessionId, parent, "the listing names the session that created it");
    assert.equal(bySession.get(userSession)?.status, "idle", "a user session nobody is running is not running");
  },
);
