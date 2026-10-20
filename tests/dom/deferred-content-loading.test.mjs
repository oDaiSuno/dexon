import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, byRole, restoreGlobals, text } from "../support/renderer.mjs";
import {
  createSessionDetail,
  createSessionTestHost,
} from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { openConversation } from "../support/session-reading-scene.mjs";

after(restoreGlobals);

const BLOCK_COUNT = 6;

function deferredMessage(index) {
  return {
    role: "assistant",
    provider: "fixture-provider",
    model: "fixture-model",
    content: [
      {
        type: "text",
        text: `Preview of block ${index}`,
        deferredContent: { entryId: `entry-${index}`, blockIndex: 0, originalBytes: 400_000 },
      },
    ],
    stopReason: "stop",
    timestamp: index,
  };
}

function deferredHistory(id) {
  const messages = [0, 1, 2, 3, 4, 5].map(deferredMessage);
  return createSessionDetail(id, {
    messages,
    entryIds: messages.map((_message, index) => `entry-${index}`),
  });
}

test("when a long session opens with many oversized blocks, only a couple of full bodies are read at once and all of them arrive without a click", async (t) => {
  const detail = deferredHistory("deferred-blocks");
  const started = [];
  const waiting = [];
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionEntryContent: async (_sid, entryId) => {
      started.push(entryId);
      return new Promise((resolve) => {
        waiting.push(() => resolve({ content: { type: "text", text: `Full text of ${entryId}` } }));
      });
    },
  });
  const scene = await openConversation(t, { host, props: { session: detail.info } });

  let resolved = 0;
  await scene.settle(() => assert.equal(started.length, 2));
  assert.deepEqual(started, ["entry-0", "entry-1"], "the first bodies are read in reading order");
  assert.equal(started.length - resolved, 2, "a long session does not read every large body at once");

  while (started.length < BLOCK_COUNT || waiting.length > 0) {
    const batch = waiting.splice(0, waiting.length);
    assert.ok(batch.length > 0, "the remaining bodies keep loading without a click");
    for (const release of batch) {
      await act(async () => release());
      resolved += 1;
      await scene.settle(() =>
        assert.ok(started.length - resolved <= 2, "no more than two bodies are ever read at once"),
      );
    }
  }

  const root = byRole(scene.view.container, "group", "Messages");
  for (let index = 0; index < BLOCK_COUNT; index += 1) {
    assert.ok(
      text(root, `Full text of entry-${index}`),
      `the full body of block ${index} is readable without clicking`,
    );
  }
});
