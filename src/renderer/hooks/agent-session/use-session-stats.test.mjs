import assert from "node:assert/strict";
import test from "node:test";

import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

const WHOLE_SESSION = {
  userMessages: 96,
  assistantMessages: 98,
  toolCalls: 17,
  toolResults: 17,
  totalMessages: 194,
  tokens: { input: 1_234, output: 567, cacheRead: 0, cacheWrite: 0, total: 1_801 },
  cost: 0.25,
};

test("when a long session is opened, the reported counts cover the whole session and stay put while older pages arrive", async (t) => {
  const detail = createSessionDetail("long-session", {
    messages: [
      { role: "user", content: "latest question", timestamp: 193 },
      { role: "assistant", content: [{ type: "text", text: "latest answer" }], timestamp: 194 },
    ],
    entryIds: ["latest-question", "latest-answer"],
    previousCursor: "older-page",
    historyRevision: "long-session-revision",
    stats: WHOLE_SESSION,
  });
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async () => ({
      context: {
        messages: [{ role: "user", content: "the oldest question", timestamp: 1 }],
        entryIds: ["oldest-question"],
        historyRevision: "long-session-revision",
        previousCursor: null,
      },
    }),
  });
  const h = await createSessionHookHarness(t, { bundleName: "session-stats-whole-file", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  assert.equal(h.state.sessionStats.totalMessages, 194, "the total counts the whole session file");
  assert.equal(h.state.sessionStats.userMessages, 96, "the user count is the host's whole-session count");
  assert.equal(h.state.sessionStats.assistantMessages, 98, "the assistant count is the host's whole-session count");
  assert.equal(h.state.sessionStats.tokens.total, 1_801, "the token total is the host's whole-session usage");
  assert.equal(h.state.sessionStats.cost, 0.25, "the cost is the host's whole-session cost");
  assert.equal(h.state.sessionStats.sessionId, "long-session", "the counts are reported for the opened session");
  assert.equal(h.state.sessionStats.sessionFile, "/fixture/long-session.jsonl", "the counts name the session file");

  await h.state.loadOlder();
  await h.flush();
  assert.equal(h.state.messages.length, 3, "the older page really did arrive");
  assert.deepEqual(
    {
      total: h.state.sessionStats.totalMessages,
      user: h.state.sessionStats.userMessages,
      assistant: h.state.sessionStats.assistantMessages,
      tokens: h.state.sessionStats.tokens.total,
    },
    { total: 194, user: 96, assistant: 98, tokens: 1_801 },
    "reading one more page does not change the reported counts",
  );
});

test("when another session is selected while the chat stays open, the counts never belong to the previous session", async (t) => {
  const first = createSessionDetail("session-a", {
    messages: [{ role: "user", content: "first session question", timestamp: 1 }],
    entryIds: ["first-question"],
    stats: WHOLE_SESSION,
  });
  const second = createSessionDetail("session-b", {
    messages: [{ role: "user", content: "second session question", timestamp: 2 }],
    entryIds: ["second-question"],
    stats: {
      userMessages: 4,
      assistantMessages: 3,
      toolCalls: 1,
      toolResults: 1,
      totalMessages: 7,
      tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
      cost: 0,
    },
  });
  const host = createSessionTestHost({ getSession: async () => first });
  const h = await createSessionHookHarness(t, { bundleName: "session-stats-switch", host });
  await h.mount({ session: first.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.sessionStats.totalMessages, 194, "the first session reports its own counts");

  await h.update({ session: second.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.sessionStats, null, "the second session does not borrow the first session's counts");

  host.getSession = async () => second;
  await h.remount({ session: second.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.sessionStats.sessionId, "session-b", "the counts that appear belong to the second session");
  assert.equal(h.state.sessionStats.totalMessages, 7, "the second session reports its own total");
  assert.equal(h.state.sessionStats.sessionFile, "/fixture/session-b.jsonl", "the counts name the second session file");
});
