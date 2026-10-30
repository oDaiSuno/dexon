import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName, act, byRole, click, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { conversation, distanceFromBottom, installChatGeometry } from "../support/chat-geometry.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  QUESTION,
  FOLLOW_UP_QUESTION,
  assistantReply,
  at,
  followUpUserTurn,
  textBlock,
  thinkingBlock,
  turnDetail,
  userTurn,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "chat-earlier-block-auto-follow",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const EARLIER_THINKING = "上一轮里的思考";
const LIVE_THINKING = "这一轮的思考";
const FIRST_SENTENCE = "正在写的第一句";
const SECOND_SENTENCE = "接着又写一句";
const VIEW_HEIGHT = 300;
const ROW_HEIGHT = 200;
const SCROLL_TO_BOTTOM = "Scroll to bottom";

function messagesArea(container) {
  const area = byRole(container, "group", "Messages");
  assert.ok(area, "the conversation shows its message area");
  return area;
}

function processGroups(container) {
  return [...messagesArea(container).querySelectorAll("button[aria-expanded]")].filter((node) =>
    /process details|processed/i.test(node.textContent),
  );
}

function jumpButton(container) {
  return [...container.querySelectorAll("button")].find((node) => accessibleName(node) === SCROLL_TO_BOTTOM);
}

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
}

async function scene(t, id) {
  installChatGeometry(t, {
    markers: [QUESTION, EARLIER_THINKING, FOLLOW_UP_QUESTION, FIRST_SENTENCE, SECOND_SENTENCE],
    viewHeight: VIEW_HEIGHT,
    rowHeight: ROW_HEIGHT,
  });
  const detail = turnDetail(id, [
    { ...userTurn(), timestamp: at(0) },
    assistantReply([thinkingBlock(EARLIER_THINKING)], "stop", at(5)),
    { ...followUpUserTurn(), timestamp: at(10) },
  ]);
  const host = createSessionTestHost({
    getSession: async () => detail,
    agentState: async () => ({ running: false }),
    sendAgentCommand: async () => ({}),
  });
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
  const emit = async (event) => {
    await act(async () => {
      for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
    });
    await settle();
  };
  const stream = (content) => emit({ type: "message_update", message: assistantReply(content, "stop", at(10)) });
  const chat = { container: view.container };
  assert.ok(conversation(chat), "the conversation has a scroll area");
  return { root: view.container, emit, stream, chat };
}

test("while a reply is in progress, opening the Processed block of an earlier turn stops the page following the reply", async (t) => {
  const { root, emit, stream, chat } = await scene(t, "earlier-block-follow");
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(10)) });
  await stream([thinkingBlock(LIVE_THINKING), textBlock(FIRST_SENTENCE)]);
  assert.equal(
    processGroups(root).length,
    2,
    "the earlier turn keeps its block above the block of the reply being written",
  );
  assert.equal(distanceFromBottom(chat), 0, "the page follows a growing reply while the reader does nothing");
  assert.equal(jumpButton(root), undefined, "there is nothing to jump back to while the page follows");

  await click(processGroups(root)[0]);
  await settle();
  assert.ok(
    distanceFromBottom(chat) > 0,
    `opening the block of the earlier turn leaves the page where it is (it moved ${distanceFromBottom(chat)}px away)`,
  );

  const readingScroll = conversation(chat).scrollTop;
  await stream([thinkingBlock(LIVE_THINKING), textBlock(`${FIRST_SENTENCE}\n${SECOND_SENTENCE}`)]);
  assert.equal(
    conversation(chat).scrollTop,
    readingScroll,
    "the growing reply no longer drags the page down once the reader opened that block",
  );
  assert.ok(distanceFromBottom(chat) > 0, "the reply keeps growing without being followed");
  assert.ok(jumpButton(root), "the reader is offered the way back to the newest content");

  await click(jumpButton(root));
  await settle();
  assert.equal(distanceFromBottom(chat), 0, "asking for the newest content shows it");
  assert.equal(jumpButton(root), undefined, "the way back is gone once the reader is there again");
});
