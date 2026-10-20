import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import {
  expectToolPayload,
  expectToolRefusal,
  resultReader,
  startSessionOrchestrationHost,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const host = await startSessionOrchestrationHost({
  name: "orchestration-capacity",
  settings: {
    enabled: true,
    maxRunning: 2,
    model: null,
    thinkingLevel: null,
    allowUserSessions: true,
  },
});
after(() => host.close());

const heldChild = (message, { partial, rest }) => host.model.script(message, [{ hold: true, partial, rest }]);

test(
  "at most two Agent-created sessions run at once, and a slot that frees up lets the next one start",
  { timeout: 120_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("capacity-parent") });
    const first = heldChild("Worker one takes its time", { partial: "Worker one is", rest: " still working" });
    const second = heldChild("Worker two takes its time", { partial: "Worker two is", rest: " still working" });
    const third = "Worker three should be created";
    host.model.script(third, [{ text: "Worker three started" }]);
    host.model.script("Start two workers", [
      toolCall("session_new", { message: "Worker one takes its time" }),
      toolCall("session_new", { message: "Worker two takes its time" }),
      { text: "Two workers are running" },
      toolCall("session_new", { message: third }),
      { text: "The third worker was refused" },
      toolCall("session_new", { message: third }),
      { text: "The third worker started" },
    ]);

    const results = resultReader(host);

    await host.prompt(parent, "Start two workers");
    const [firstWorker, secondWorker] = await results.next(2);
    const firstId = expectToolPayload(firstWorker, "the first worker must be created").sessionId;
    const secondId = expectToolPayload(secondWorker, "the second worker must be created").sessionId;
    await Promise.all([first.partialSent(0), second.partialSent(0)]);
    await waitUntil(
      async () => {
        const running = await host.runningIds();
        return running.includes(firstId) && running.includes(secondId);
      },
      { timeoutMs: 10_000, label: "both workers to be running" },
    );

    await host.prompt(parent, "Start one more worker");
    const [refused] = await results.next();
    expectToolRefusal(
      refused,
      "a third Agent-created session must be refused while two are running",
      /limit|max|at most/i,
    );
    assert.equal(
      (await host.sessions()).filter((session) => session.createdBySessionId === parent).length,
      2,
      "the refused request created no session",
    );

    first.release(0);
    await waitUntil(
      async () => {
        const running = await host.runningIds();
        return !running.includes(firstId) && running.includes(secondId);
      },
      { timeoutMs: 15_000, label: "the first worker to finish" },
    );

    await host.prompt(parent, "Start a worker now that a slot is free");
    const [accepted] = await results.next();
    const payload = expectToolPayload(accepted, "creation must work again once a running session finished");
    const row = await waitUntil(() => host.sessionRow(payload.sessionId), {
      timeoutMs: 8_000,
      label: "the third worker to be listed",
    });
    assert.equal(row.createdBySessionId, parent);
  },
);

test(
  "a forked session is listed as a fork, and the origin record is kept outside Pi's session file",
  { timeout: 90_000 },
  async () => {
    const parent = await host.createUserSession({ cwd: host.workspace("fork-parent") });
    host.model.script("First question for the fork", [{ text: "First answer" }, { text: "Second answer" }]);
    await host.prompt(parent, "First question for the fork");
    await host.prompt(parent, "Second question for the fork");

    const before = await waitUntil(
      async () => {
        const detail = await host.detail(parent);
        return detail.context.entryIds.length >= 4 ? detail : null;
      },
      { timeoutMs: 15_000, label: "the parent conversation to be saved" },
    );
    const originalFile = before.info.path;
    const originalContent = readFileSync(originalFile, "utf8");
    assert.deepEqual(
      before.context.messages.map((message) => message.role),
      ["user", "assistant", "user", "assistant"],
    );

    const forkPoint = before.context.entryIds[2];
    const forked = await host.command(parent, { type: "fork", entryId: forkPoint });
    assert.equal(forked.cancelled, false, `the fork must happen, received: ${JSON.stringify(forked)}`);
    const forkedId = forked.newSessionId;

    const row = await waitUntil(() => host.sessionRow(forkedId), { timeoutMs: 15_000, label: "the fork to be listed" });
    assert.equal(row.relation, "fork", "a forked session is marked as a fork, not a delegation");
    assert.equal(row.createdBySessionId, undefined, "a fork was not created by another session");

    const forkedDetail = await host.detail(forkedId);
    assert.deepEqual(
      forkedDetail.context.messages.map((message) => message.role),
      ["user", "assistant"],
      "the fork keeps the conversation up to the fork point",
    );

    const forkedLines = readFileSync(forkedDetail.info.path, "utf8").trimEnd().split("\n");
    assert.deepEqual(
      forkedLines.map((line) => JSON.parse(line).type),
      ["session", "message", "message"],
      "the forked file holds only what Pi wrote: a header and the copied messages",
    );
    assert.equal(
      forkedLines.some((line) => /dexon/i.test(line)),
      false,
      "origin bookkeeping never lands in Pi's session file",
    );
    assert.equal(readFileSync(originalFile, "utf8"), originalContent, "forking leaves the original file untouched");
  },
);
