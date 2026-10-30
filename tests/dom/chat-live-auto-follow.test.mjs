import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName, act, byRole, click, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { conversation, distanceFromBottom, installChatGeometry, topOf } from "../support/chat-geometry.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  CONCLUSION,
  QUESTION,
  assistantReply,
  textBlock,
  thinkingBlock,
  turnDetail,
  userTurn,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "chat-live-auto-follow",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const FIRST_THINKING = "第一段思考";
const SECOND_THINKING = "第二段思考";
const SECOND_SENTENCE = "第二句正文";
const LAST_SENTENCE = "最后再说一句";
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

async function letBlockFinishClosing() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await settle();
}

async function scene(t, id) {
  installChatGeometry(t, {
    markers: [QUESTION, FIRST_THINKING, SECOND_THINKING, CONCLUSION, SECOND_SENTENCE, LAST_SENTENCE],
    viewHeight: VIEW_HEIGHT,
    rowHeight: ROW_HEIGHT,
  });
  const detail = turnDetail(id, [{ ...userTurn(), timestamp: 1 }]);
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
  const stream = (content) => emit({ type: "message_update", message: assistantReply(content, "stop", 1) });
  const scene = { container: view.container };
  assert.ok(conversation(scene), "the conversation has a scroll area");
  return { view, root: view.container, host, emit, stream, scene };
}

test("when the reader opens a live Processed block, the page stops following the reply until the reader asks for the newest content", async (t) => {
  const { root, emit, stream, scene: chat } = await scene(t, "live-follow");
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", 1) });
  await stream([thinkingBlock(FIRST_THINKING)]);
  assert.equal(processGroups(root).length, 1, "the live reply folds its thinking into one Processed block");
  assert.equal(distanceFromBottom(chat), 0, "the page follows a growing reply while the reader does nothing");
  assert.equal(jumpButton(root), undefined, "there is nothing to jump back to while the page follows");

  await stream([thinkingBlock(FIRST_THINKING), textBlock(CONCLUSION)]);
  assert.equal(distanceFromBottom(chat), 0, "the answer text is followed as well");
  assert.equal(jumpButton(root), undefined, "the reader is still at the newest content");

  await click(processGroups(root)[0]);
  await settle();
  assert.ok(
    distanceFromBottom(chat) > 0,
    `opening the block leaves the page where it is instead of chasing the content (it moved ${distanceFromBottom(chat)}px away)`,
  );
  assert.ok(jumpButton(root), "the reader is offered the way back to the newest content");

  const readingTop = topOf(chat, CONCLUSION);
  const readingScroll = conversation(chat).scrollTop;
  await stream([thinkingBlock(FIRST_THINKING), textBlock(`${CONCLUSION}\n${SECOND_SENTENCE}`)]);
  assert.equal(
    conversation(chat).scrollTop,
    readingScroll,
    "the page stays where the reader put it while the answer keeps growing below",
  );
  assert.equal(topOf(chat, CONCLUSION), readingTop, "the sentence the reader is reading keeps its place on screen");
  assert.ok(distanceFromBottom(chat) > 0, "the answer keeps growing without dragging the page down");
  assert.ok(jumpButton(root), "the way back stays on offer while the reader reads");

  await click(jumpButton(root));
  await settle();
  assert.equal(distanceFromBottom(chat), 0, "asking for the newest content shows it");
  assert.equal(jumpButton(root), undefined, "the way back is gone once the reader is there again");

  await stream([thinkingBlock(SECOND_THINKING), textBlock(`${CONCLUSION}\n${SECOND_SENTENCE} ${LAST_SENTENCE}`)]);
  assert.equal(distanceFromBottom(chat), 0, "following resumes after the reader asked for the newest content");
  assert.equal(jumpButton(root), undefined, "the reader is not left behind by the following reply");
});

test("when the reader closes a live Processed block again, the page stops following the reply just as opening it did", async (t) => {
  const { root, emit, stream, scene: chat } = await scene(t, "live-follow-close");
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", 1) });
  await stream([thinkingBlock(FIRST_THINKING), textBlock(CONCLUSION)]);
  assert.equal(distanceFromBottom(chat), 0, "the page follows a growing reply while the reader does nothing");
  assert.equal(processGroups(root).length, 1, "the live reply folds its process into one Processed block");

  const block = () => processGroups(root)[0];
  await click(block());
  await settle();
  assert.ok(distanceFromBottom(chat) > 0, "opening the block leaves the page where it is");

  await click(jumpButton(root));
  await settle();
  assert.equal(distanceFromBottom(chat), 0, "the reader asked for the newest content and got it");
  assert.equal(jumpButton(root), undefined, "there is nothing to jump back to while the page follows");

  await click(block());
  await letBlockFinishClosing();
  const readingScroll = conversation(chat).scrollTop;
  const readingTop = topOf(chat, CONCLUSION);

  await stream([thinkingBlock(FIRST_THINKING), textBlock(`${CONCLUSION}\n${SECOND_SENTENCE}`)]);
  assert.equal(
    conversation(chat).scrollTop,
    readingScroll,
    "closing the block stops the page from following: the scroll offset stays exactly where it was",
  );
  assert.equal(topOf(chat, CONCLUSION), readingTop, "the sentence the reader is reading keeps its place on screen");
  assert.ok(jumpButton(root), "the reader is offered the way back to the newest content");

  await click(jumpButton(root));
  await settle();
  assert.equal(distanceFromBottom(chat), 0, "asking for the newest content shows it again");
});
