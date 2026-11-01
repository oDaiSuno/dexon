import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_ID,
  announceSessionChanged,
  conversation,
  mountHeldSession,
  settle,
  snapshot,
} from "./model-choice-sync-fixtures.mjs";

const USAGE_OLD = { percent: 10, contextWindow: 1000, tokens: 100 };
const USAGE_NEW = { percent: 40, contextWindow: 1000, tokens: 400 };

async function mountWithHistory(t, bundleName, options = {}) {
  const setup = await mountHeldSession(t, { bundleName, ...options });
  await settle(setup.h, () => setup.reads.calls[0].resolve(snapshot(conversation(1))));
  assert.equal(setup.h.state.messages.length, 2, "the session opens with one turn");
  return setup;
}

test("an older routine refresh that resolves last does not roll the conversation back", async (t) => {
  const { h, reads } = await mountWithHistory(t, "snapshot-order-history");

  await announceSessionChanged(h);
  await announceSessionChanged(h);
  await settle(h, () => reads.calls[2].resolve(snapshot(conversation(2))));
  assert.equal(h.state.messages.length, 4, "the newer refresh shows the second turn");

  await settle(h, () => reads.calls[1].resolve(snapshot(conversation(1))));
  assert.equal(h.state.messages.length, 4, "the older refresh does not remove the second turn");
  assert.deepEqual(h.state.entryIds, ["u-1", "a-1", "u-2", "a-2"]);
});

test("an older routine refresh that resolves last does not restore stale context usage", async (t) => {
  const { h, reads } = await mountWithHistory(t, "snapshot-order-usage");

  await announceSessionChanged(h);
  await announceSessionChanged(h);
  await settle(h, () => reads.calls[2].resolve(snapshot({ ...conversation(2), contextUsage: USAGE_NEW })));
  assert.deepEqual(h.state.contextUsage, USAGE_NEW);

  await settle(h, () => reads.calls[1].resolve(snapshot({ ...conversation(1), contextUsage: USAGE_OLD })));
  assert.deepEqual(h.state.contextUsage, USAGE_NEW, "the older refresh does not overwrite newer usage");
});

test("an opening load that fails with not found after a newer refresh succeeded keeps the newer conversation", async (t) => {
  const { h, reads } = await mountHeldSession(t, { bundleName: "snapshot-order-stale-not-found" });

  await announceSessionChanged(h);
  await settle(h, () => reads.calls[1].resolve(snapshot(conversation(2))));
  assert.equal(h.state.messages.length, 4);

  await settle(h, () => reads.calls[0].reject(new Error(`Session not found: ${SESSION_ID}`)));
  assert.equal(h.state.messages.length, 4, "the stale failure does not empty the conversation");
  assert.equal(h.state.data?.sessionId, SESSION_ID, "the stale failure does not drop the session detail");
});

test("the opening load restores a running turn even when a newer history-only refresh resolved first", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { h, reads } = await mountHeldSession(t, { bundleName: "snapshot-order-mount-restore" });
  await h.flush();

  h.emit({ type: "auto_retry_end", success: false, attempt: 3, finalError: "503 overloaded" });
  await h.flush();
  assert.equal(reads.calls.length, 2, "the failed retry asked for a history-only refresh");
  await settle(h, () => reads.calls[1].resolve(snapshot(conversation(2))));
  assert.equal(h.state.messages.length, 4);

  await settle(h, () =>
    reads.calls[0].resolve(
      snapshot({ ...conversation(1), agentState: { running: true, state: { isStreaming: true } } }),
    ),
  );
  assert.equal(h.state.agentRunning, true, "the running turn is restored from the opening load");
  assert.equal(h.state.streamState.isStreaming, true);
  assert.equal(h.state.messages.length, 4, "the older opening load does not roll the conversation back");
});

test("the opening load does not restore a turn that a newer refresh already reported finished", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { h, reads } = await mountHeldSession(t, { bundleName: "snapshot-order-mount-finished" });

  await announceSessionChanged(h);
  await settle(h, () => reads.calls[1].resolve(snapshot({ ...conversation(2), agentState: { running: false } })));

  await settle(h, () =>
    reads.calls[0].resolve(
      snapshot({ ...conversation(1), agentState: { running: true, state: { isStreaming: true } } }),
    ),
  );
  assert.equal(h.state.agentRunning, false, "the stale running state is not restored");
  assert.equal(h.state.messages.length, 4);
});

async function mountWithBranchNavigation(t, bundleName, navigateReply) {
  const branch = {};
  const setup = await mountWithHistory(t, bundleName, {
    hookOptions: {
      onBranchDataChange: (_tree, _leafId, onLeafChange) => {
        branch.navigate = onLeafChange;
      },
    },
    hostOverrides: {
      sendAgentCommand: async (_sid, payload) => (payload.type === "navigate_tree" ? navigateReply : {}),
      getSessionContext: async (_sid, leafId) => ({
        context: {
          messages: [],
          entryIds: [],
          historyRevision: `context-${leafId}`,
          previousCursor: null,
        },
      }),
    },
  });
  return { ...setup, branch };
}

test("navigating to a user message adopts the leaf the host actually moved to", async (t) => {
  const { h, host, branch } = await mountWithBranchNavigation(t, "snapshot-order-host-leaf", {
    cancelled: false,
    leafId: "a-0",
  });

  await settle(h, () => branch.navigate("u-1"));
  assert.equal(h.state.activeLeafId, "a-0", "the active leaf is the one the host reports");
  const contextReads = host.getCommands.filter((c) => c.rpc === "getSessionContext");
  assert.deepEqual(
    contextReads.map((c) => c.args[0]),
    ["a-0"],
    "history is loaded for the host leaf",
  );
});

test("a navigation the host cancelled leaves the leaf and the conversation alone", async (t) => {
  const { h, host, branch } = await mountWithBranchNavigation(t, "snapshot-order-cancelled-leaf", {
    cancelled: true,
    leafId: "a-1",
  });
  const leafBefore = h.state.activeLeafId;

  await settle(h, () => branch.navigate("u-1"));
  assert.equal(h.state.activeLeafId, leafBefore);
  assert.equal(h.state.messages.length, 2);
  assert.ok(!host.getCommands.some((c) => c.rpc === "getSessionContext"), "no history is loaded");
});
