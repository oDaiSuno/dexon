import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, byRole, click, dom, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  CONCLUSION,
  retriedBlocksTurn,
  timedBlocksTurn,
  timedToolEndedBlocksTurn,
  untimedBlocksTurn,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "answer-turn-timing",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const FOLLOWING = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;

function messagesOf(view) {
  const area = byRole(view.container, "group", "Messages");
  assert.ok(area, "the conversation shows its message area");
  return area;
}

function processGroups(root) {
  return [...root.querySelectorAll("button[aria-expanded]")].filter((node) =>
    /process details|processed/i.test(node.textContent),
  );
}

function thinkingRows(root) {
  return [...root.querySelectorAll("button")].filter((node) => /Deep thinking/.test(node.textContent));
}

function durationOf(row) {
  const value = [...row.querySelectorAll("*")]
    .map((node) => (node.children.length === 0 ? node.textContent.trim() : ""))
    .find((candidate) => /^(\d+m\d+s|\d+h\d+m|\d+s)$/.test(candidate));
  assert.ok(value, `the row “${row.textContent.trim()}” reports how long it took`);
  return value;
}

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

async function mountConversation(t, detail) {
  const host = createSessionTestHost({ getSession: async () => detail });
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      boundary.close();
    }
  });
  view = await mount(t, ChatWindow, {
    session: detail.info,
    newSessionCwd: null,
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  });
  await settle();
  return { view };
}

test("when a finished reply was timed, its Processed block stops counting at the moment the answer text began", async (t) => {
  const { view } = await mountConversation(t, timedBlocksTurn());
  const root = messagesOf(view);
  const groups = processGroups(root);
  assert.equal(groups.length, 1, "the whole process of the turn waits behind one Processed block");
  assert.match(groups[0].textContent, /Processed 40s/, "the block reports the 40s recorded for it");
  assert.doesNotMatch(root.textContent, /1m5s/, "the writing of the answer is not counted as processing");
});

test("when the reader opens a timed Processed block, each thinking row reports only its own length", async (t) => {
  const { view } = await mountConversation(t, timedBlocksTurn());
  const root = messagesOf(view);
  const [group] = processGroups(root);
  await click(group);
  await settle();
  const rows = thinkingRows(root);
  assert.equal(rows.length, 2, "both thinking steps keep a row of their own");
  assert.deepEqual(rows.map(durationOf), ["19s", "7s"], "each row counts from its own start to its own end");
});

test("when a timed turn stops after its tool result, the block ends at the tool result because it comes after the last content", async (t) => {
  const { view } = await mountConversation(t, timedToolEndedBlocksTurn());
  const root = messagesOf(view);
  const groups = processGroups(root);
  assert.equal(groups.length, 1, "the process of the turn waits behind one Processed block");
  assert.match(
    groups[0].textContent,
    /Processed 32s/,
    "the block reaches the tool result at 32s, which is later than its last content ending at 25s",
  );
  await click(groups[0]);
  await settle();
  assert.deepEqual(thinkingRows(root).map(durationOf), ["19s"], "the thinking row still counts only its own length");
});

test("when an older reply was never timed, its Processed block keeps the duration it always showed", async (t) => {
  const { view } = await mountConversation(t, untimedBlocksTurn());
  const groups = processGroups(messagesOf(view));
  assert.equal(groups.length, 1, "the process of the turn waits behind one Processed block");
  assert.match(groups[0].textContent, /Processed 1m5s/, "a reply without recorded times falls back to the old count");
});

test("when a turn failed and was answered after a retry, each of its two Processed blocks keeps its own duration", async (t) => {
  const { view } = await mountConversation(t, retriedBlocksTurn());
  const root = messagesOf(view);
  const groups = processGroups(root);
  assert.equal(groups.length, 2, "the process before the failure and the one after it stay apart");
  assert.match(groups[0].textContent, /Processed 12s/, "the first block stops at its tool result");
  assert.match(
    groups[1].textContent,
    /Processed 18s/,
    "the second block counts from the failure to its own tool result",
  );
  assert.ok(groups[0].compareDocumentPosition(groups[1]) & FOLLOWING, "the second block is read after the first");
  assert.ok(text(root, CONCLUSION), "the answer of the retry is readable");
});
