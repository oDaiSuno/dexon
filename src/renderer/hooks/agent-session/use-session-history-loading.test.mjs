import assert from "node:assert/strict";
import test from "node:test";
import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

test("a late initial-history response cannot overwrite a newer version switch", async (t) => {
  const detailA = createSessionDetail("s-1", {
    historyRevision: "rev-a",
    messages: [
      { role: "user", content: "a-initial", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "a reply" }], timestamp: 2 },
    ],
    entryIds: ["a-user", "a-assistant"],
  });
  let resolveA;
  const host = createSessionTestHost({
    getSession: () => new Promise((resolve) => (resolveA = resolve)),
    getSessionContext: async () => ({
      context: {
        messages: [{ role: "user", content: "nav-context", timestamp: 9 }],
        entryIds: ["nav-1"],
        historyRevision: "rev-nav",
        previousCursor: null,
      },
    }),
    agentState: async () => ({ running: false, state: {} }),
    sendAgentCommand: async (sid, payload) =>
      payload.type === "switch_version" ? { cancelled: false, leafId: "nav-1" } : {},
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-stale", host });

  await h.mount({ session: detailA.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.messages.length, 0, "the initial load is still in flight");

  await h.act(async () => {
    await h.state.handleSwitchVersion("nav-1");
  });
  await h.flush();
  assert.deepEqual(
    h.state.messages.map((m) => m.content),
    ["nav-context"],
    "the switch committed",
  );

  resolveA(detailA);
  await h.flush();
  assert.deepEqual(
    h.state.messages.map((m) => (typeof m.content === "string" ? m.content : "assistant")),
    ["nav-context"],
    "the stale initial response did not replace the newer version switch",
  );
});

test("a session that no longer exists clears the view without an error banner", async (t) => {
  const detail = createSessionDetail("gone");
  const host = createSessionTestHost({
    getSession: async () => {
      throw new Error("Session not found: gone");
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-gone", host });

  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.data, null, "detail cleared");
  assert.equal(h.state.error, null, "not-found is a defined outcome, not an error");
  assert.deepEqual(h.state.messages, []);
});
