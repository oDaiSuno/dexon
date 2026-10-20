import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  resultQueue,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({ name: "orchestration-transcript", settings: ENABLED_SETTINGS });
after(() => host.close());

const LONG_REPLY = Array.from({ length: 2_500 }, (_, index) => `report line ${index + 1}`).join("\n");

async function waitForReply(sessionId, expected) {
  await waitUntil(
    async () => {
      const detail = await host.detail(sessionId);
      const last = detail.context.messages.filter((message) => message.role === "assistant").at(-1);
      return last && textOf(last) === expected;
    },
    { timeoutMs: 20_000, label: `session ${sessionId} to reply` },
  );
}

function sectionTitles(transcript) {
  return [...transcript.matchAll(/^## \[(\d+)\] (.+)$/gm)].map((match) => match[2]);
}

test(
  "reading a session returns its last reply and the path of a transcript of the whole conversation",
  { timeout: 90_000 },
  async () => {
    const parentCwd = host.workspace("transcript-parent");
    const parent = await host.createUserSession({ cwd: parentCwd });
    writeFileSync(path.join(parentCwd, "build.log"), "tool-run\n");
    const childMessage = "Write a report about the build";
    host.model.script(childMessage, [toolCall("read", { path: "build.log" }), { text: "The report is written" }]);
    let childId;
    host.model.script("Ask the worker for a report", [
      toolCall("session_new", { message: childMessage, name: "Reporter", wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_read", input: () => ({ sessionId: childId }) } },
      { text: "Read the report" },
    ]);
    const results = resultQueue(host);

    await host.prompt(parent, "Ask the worker for a report");
    childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
    await waitForReply(childId, "The report is written");

    const readingStartedAt = Date.now();
    await host.prompt(parent, "Read the report now");
    const payload = expectToolPayload(await results.named("session_read"), "the Agent must receive what it read");

    assert.equal(payload.sessionId, childId);
    assert.equal(payload.title, "Reporter");
    assert.equal(payload.status, "idle");
    assert.equal(payload.lastReply, "The report is written");
    assert.equal(payload.lastReplyTruncated, false);
    assert.ok(payload.transcript, "the answer says where the transcript is");

    const transcriptPath = payload.transcript.path;
    assert.ok(path.isAbsolute(transcriptPath), `the transcript path must be absolute, received ${transcriptPath}`);
    assert.equal(path.basename(transcriptPath), `${childId}.md`);
    assert.equal(path.basename(path.dirname(transcriptPath)), "session-transcripts");
    assert.ok(existsSync(transcriptPath), "the transcript file exists where the answer says it is");

    const transcript = readFileSync(transcriptPath, "utf8");
    const lines = transcript.split("\n");
    assert.equal(lines[0], "# Reporter", "the transcript opens with the session title");
    assert.ok(lines.includes(`- Session: ${childId}`), "the transcript names the session");
    assert.ok(lines.includes(`- Directory: ${parentCwd}`), "the transcript names the working directory");
    assert.ok(lines.includes("- Status: idle"), "the transcript names the status at snapshot time");
    assert.ok(lines.includes(`- Created by: ${parent}`), "the transcript names the session that created it");
    const snapshot = lines.find((line) => line.startsWith("- Snapshot: "));
    assert.ok(snapshot, "the transcript says when the snapshot was taken");
    const snapshotAt = Date.parse(snapshot.slice("- Snapshot: ".length));
    assert.ok(Math.abs(snapshotAt - readingStartedAt) < 120_000, "the snapshot time is the moment of this reading");

    assert.deepEqual(sectionTitles(transcript), [
      `User — from session ${parent}`,
      "Assistant",
      "Tool result: read",
      "Assistant",
    ]);
    assert.equal(payload.transcript.messages, 4, "one section per message");
    assert.equal(payload.transcript.lines, lines.length);
    assert.equal(payload.transcript.bytes, statSync(transcriptPath).size);
    assert.ok(transcript.includes("The report is written"), "the last reply is part of the transcript");
  },
);

test(
  "the transcript shows thinking, tool call input and tool results the way the session produced them",
  { timeout: 90_000 },
  async () => {
    const workspace = host.workspace("transcript-blocks-parent");
    writeFileSync(path.join(workspace, "notes.txt"), "first-line\nsecond-line\n");
    const parent = await host.createUserSession({ cwd: workspace });
    const childMessage = "Inspect the workspace";
    host.model.script(childMessage, [
      { thinking: "I should look at the files first", toolCall: { name: "read", input: { path: "notes.txt" } } },
      { toolCall: { name: "read", input: { path: "missing.txt" } } },
      { text: "The workspace was inspected" },
    ]);
    let childId;
    host.model.script("Start a worker that inspects the workspace", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_read", input: () => ({ sessionId: childId }) } },
      { text: "Read it" },
    ]);
    const results = resultQueue(host);

    await host.prompt(parent, "Start a worker that inspects the workspace");
    childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
    await waitForReply(childId, "The workspace was inspected");

    await host.prompt(parent, "Read the worker now");
    const payload = expectToolPayload(await results.named("session_read"), "the Agent must receive what it read");
    assert.ok(payload.transcript, "the answer says where the transcript is");
    const transcript = readFileSync(payload.transcript.path, "utf8");

    assert.match(transcript, /^Thinking:\n> I should look at the files first$/m, "thinking is quoted");
    assert.match(
      transcript,
      /^Tool call: read\n```json\n\{\n {2}"path": "notes.txt"\n\}\n```$/m,
      "a tool call shows its full input as readable json",
    );
    assert.deepEqual(sectionTitles(transcript), [
      `User — from session ${parent}`,
      "Assistant",
      "Tool result: read",
      "Assistant",
      "Tool result: read (error)",
      "Assistant",
    ]);
    assert.match(transcript, /first-line\nsecond-line/, "a tool result keeps the text the tool returned");
    assert.ok(transcript.includes("The workspace was inspected"), "the closing reply is in the transcript");
  },
);

test(
  "a very long last reply is shortened in the answer and complete in the transcript",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("transcript-long-parent") });
    const childMessage = "Write a very long report";
    host.model.script(childMessage, [{ text: LONG_REPLY }]);
    let childId;
    host.model.script("Ask for a long report and read it", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      { toolCall: { name: "session_read", input: () => ({ sessionId: childId }) } },
      { text: "Read it" },
    ]);
    const results = resultQueue(host);

    await host.prompt(parent, "Ask for a long report and read it");
    childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
    await waitForReply(childId, LONG_REPLY);

    await host.prompt(parent, "Read the long report now");
    const payload = expectToolPayload(await results.named("session_read"), "the Agent must receive what it read");

    assert.equal(payload.lastReplyTruncated, true, "the answer says the reply is shortened");
    const answeredLines = payload.lastReply.split("\n");
    assert.equal(answeredLines.length, DEFAULT_MAX_LINES, "the answer keeps the first 2000 lines");
    assert.equal(answeredLines[0], "report line 1");
    assert.equal(answeredLines.at(-1), `report line ${DEFAULT_MAX_LINES}`);

    const transcript = readFileSync(payload.transcript.path, "utf8");
    assert.ok(transcript.includes("report line 2500"), "the transcript keeps every line of the reply");
  },
);

test(
  "waiting for a reply applies the same limit, so a huge reply says it was shortened",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("transcript-wait-parent") });
    const childMessage = "Produce the long answer";
    host.model.script(childMessage, [{ text: LONG_REPLY }, { text: LONG_REPLY }]);
    let childId;
    host.model.script("Ask for a long answer and wait", [
      toolCall("session_new", { message: childMessage, wait: false }),
      { text: "Worker started" },
      {
        toolCall: {
          name: "session_prompt",
          input: () => ({ sessionId: childId, message: "Answer at length", wait: true, timeoutSeconds: 30 }),
        },
      },
      { text: "Waited" },
    ]);
    const results = resultQueue(host);

    await host.prompt(parent, "Ask for a long answer and wait");
    childId = expectToolPayload(await results.named("session_new"), "the worker must be created").sessionId;
    await waitForReply(childId, LONG_REPLY);

    await host.prompt(parent, "Ask the worker to answer at length");
    const payload = expectToolPayload(await results.named("session_prompt"), "the Agent must receive the waited reply");
    assert.equal(payload.status, "idle");
    assert.equal(payload.lastReplyTruncated, true, "a huge waited reply says it was shortened");
    assert.equal(payload.lastReply.split("\n").length, DEFAULT_MAX_LINES);
  },
);

test("deleting a session removes the transcript snapshot written for it", { timeout: 90_000 }, async () => {
  const parent = await host.createUserSession({ cwd: host.workspace("transcript-delete-parent") });
  const subject = await host.createUserSession({ cwd: host.workspace("transcript-delete-parent") });
  host.model.script("The session that will be deleted", [{ text: "Answered before deletion" }]);
  await host.prompt(subject, "The session that will be deleted");
  await waitForReply(subject, "Answered before deletion");

  host.model.script("Read a session that will disappear", [
    { toolCall: { name: "session_read", input: () => ({ sessionId: subject }) } },
    { text: "Read it" },
  ]);
  const results = resultQueue(host);
  await host.prompt(parent, "Read a session that will disappear");
  const payload = expectToolPayload(await results.named("session_read"), "the Agent must receive what it read");
  assert.ok(payload.transcript, "the answer says where the transcript is");
  assert.ok(existsSync(payload.transcript.path), "the snapshot exists while the session exists");

  await host.client.call("sessions.delete", { id: subject });
  assert.equal(existsSync(payload.transcript.path), false, "deleting the session removes its snapshot file");
});
