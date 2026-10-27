import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, byRole, click, dom, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  ANALYSIS,
  ANSWER_TEXTS,
  CONCLUSION,
  FAILURE_DETAIL,
  MIDWAY,
  OPENING,
  QUESTION,
  REANALYSIS,
  SECOND_TOOL_OUTPUT,
  TOOL_OUTPUT,
  abortedTurn,
  assistantReply,
  consecutiveProcessAcrossMessagesTurn,
  consecutiveProcessInOneMessageTurn,
  failedTurn,
  interleavedMultiMessageTurn,
  interleavedSingleMessageTurn,
  plainReplyTurn,
  readStep,
  textBlock,
  thinkingBlock,
  toolEndedTurn,
  toolOutput,
  turnDetail,
  userTurn,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "chat-answer-visibility",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const FOLLOWING = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;

function messagesOf(view) {
  const area = byRole(view.container, "group", "Messages");
  assert.ok(area, "the conversation shows its message area");
  return area;
}

function onScreen(view, value) {
  const node = text(messagesOf(view), value);
  assert.ok(node, `“${value}” is readable as ordinary reply text`);
  return node;
}

function occurrences(view, value) {
  return messagesOf(view).textContent.split(value).length - 1;
}

function comesBefore(earlier, later, label) {
  assert.ok(earlier.compareDocumentPosition(later) & FOLLOWING, label);
}

function processGroups(root) {
  return [...root.querySelectorAll("button[aria-expanded]")].filter((node) =>
    /process details|processed/i.test(node.textContent),
  );
}

function collapsedGroups(root) {
  return processGroups(root).filter((node) => node.getAttribute("aria-expanded") === "false");
}

function buttonsNamed(root, pattern) {
  return [...root.querySelectorAll("button")].filter((node) => pattern.test(node.textContent));
}

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

async function mountAnswerTurn(t, detail, hostOverrides = {}) {
  const host = createSessionTestHost({ getSession: async () => detail, ...hostOverrides });
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
  return { view, host };
}

function assertAnswersInOrder(view) {
  const conclusion = onScreen(view, CONCLUSION);
  const opening = onScreen(view, OPENING);
  const midway = onScreen(view, MIDWAY);
  comesBefore(opening, midway, "the first sentence is read before the second");
  comesBefore(midway, conclusion, "the second sentence is read before the last");
  for (const value of ANSWER_TEXTS) assert.equal(occurrences(view, value), 1, `“${value}” appears exactly once`);
  return { opening, midway, conclusion };
}

function assertCanonicalLayout(view, { groupsOpen = false } = {}) {
  const { opening, midway, conclusion } = assertAnswersInOrder(view);
  const groups = processGroups(messagesOf(view));
  assert.equal(groups.length, 2, "the tool call and the thinking each keep one group of their own");
  for (const group of groups) {
    assert.equal(
      group.getAttribute("aria-expanded"),
      groupsOpen ? "true" : "false",
      groupsOpen ? "the group reports that it is open" : "the group reports that it is closed",
    );
  }
  comesBefore(opening, groups[0], "the first sentence is read before the tool-call group");
  comesBefore(groups[0], midway, "the tool-call group ends before the second sentence");
  comesBefore(midway, groups[1], "the second sentence is read before the thinking group");
  comesBefore(groups[1], conclusion, "the thinking group ends before the last sentence");
}

function assertReadingOrder(view, values) {
  const content = messagesOf(view).textContent;
  const positions = values.map((value) => content.indexOf(value));
  values.forEach((value, index) => assert.notEqual(positions[index], -1, `“${value}” is on screen`));
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index], `“${values[index]}” is read after “${values[index - 1]}”`);
  }
}

async function emit(host, event) {
  await act(async () => {
    for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
  });
  await settle();
}

test("when a reopened turn interleaves a sentence, a tool call, a sentence and thinking in one reply, the reader sees all the sentences where they were written", async (t) => {
  const { view } = await mountAnswerTurn(t, interleavedSingleMessageTurn());
  assertCanonicalLayout(view);
});

test("when a turn keeps its sentences in several replies around tool results, the reader sees every sentence in the order it was written", async (t) => {
  const { view } = await mountAnswerTurn(t, interleavedMultiMessageTurn());
  assertCanonicalLayout(view);
});

test("when a turn ends on a tool call with no closing sentence, the sentences written before it stay readable", async (t) => {
  const { view } = await mountAnswerTurn(t, toolEndedTurn());
  onScreen(view, QUESTION);
  const groups = collapsedGroups(messagesOf(view));
  assert.equal(groups.length, 1, "the unfinished tool call waits behind one collapsed group");
  const opening = onScreen(view, OPENING);
  comesBefore(opening, groups[0], "the sentence is read before the tool-call group");
  assert.equal(occurrences(view, OPENING), 1, "the sentence appears exactly once");
});

test("when the reader interrupts a turn after a sentence, the sentences written before the interruption stay readable", async (t) => {
  const { view } = await mountAnswerTurn(t, abortedTurn());
  onScreen(view, QUESTION);
  const opening = onScreen(view, OPENING);
  const midway = onScreen(view, MIDWAY);
  const groups = collapsedGroups(messagesOf(view));
  assert.equal(groups.length, 2, "each interrupted tool call waits behind its own collapsed group");
  comesBefore(opening, groups[0], "the first sentence is read before the first tool-call group");
  comesBefore(groups[0], midway, "the interrupted sentence follows the first tool call");
  comesBefore(midway, groups[1], "the interrupted sentence is read before the second tool-call group");
});

test("when one reply holds nothing but thinking and a tool call, the reader finds them behind a single group that opens to its details", async (t) => {
  const { view } = await mountAnswerTurn(t, consecutiveProcessInOneMessageTurn());
  const root = messagesOf(view);
  const groups = collapsedGroups(root);
  assert.equal(groups.length, 1, "consecutive thinking and tool rows share one group");
  await click(groups[0]);
  assert.equal(groups[0].getAttribute("aria-expanded"), "true", "the group reports that it is open");
  const thinkingRows = buttonsNamed(root, /Deep thinking/);
  assert.equal(thinkingRows.length, 2, "both thinking steps keep a row of their own");
  const toolRow = byRole(root, "button", /Read.*src\/app\.ts/);
  assert.ok(toolRow, "the tool call has a row of its own");
  await click(toolRow);
  assert.ok(text(root, TOOL_OUTPUT), "the tool result text is readable");
  await click(thinkingRows[0]);
  assert.ok(text(root, ANALYSIS), "the first thinking trace is readable");
  await click(thinkingRows[1]);
  assert.ok(text(root, REANALYSIS), "the later thinking trace is readable");
});

test("when consecutive replies hold only thinking and tool calls, the reader finds them all behind one group that opens to every row", async (t) => {
  const { view } = await mountAnswerTurn(t, consecutiveProcessAcrossMessagesTurn());
  const root = messagesOf(view);
  const groups = collapsedGroups(root);
  assert.equal(groups.length, 1, "thinking and tool rows from neighbouring replies share one group");
  await click(groups[0]);
  assert.equal(groups[0].getAttribute("aria-expanded"), "true", "the group reports that it is open");
  const thinkingRows = buttonsNamed(root, /Deep thinking/);
  assert.equal(thinkingRows.length, 2, "both thinking steps keep a row of their own");
  const toolRows = buttonsNamed(root, /Read.*src\//);
  assert.equal(toolRows.length, 2, "both tool calls keep a row of their own");
  await click(toolRows[0]);
  assert.ok(text(root, TOOL_OUTPUT), "the first tool result text is readable");
  await click(toolRows[1]);
  assert.ok(text(root, SECOND_TOOL_OUTPUT), "the second tool result text is readable");
  await click(thinkingRows[0]);
  assert.ok(text(root, ANALYSIS), "the first thinking trace is readable");
  await click(thinkingRows[1]);
  assert.ok(text(root, REANALYSIS), "the second thinking trace is readable");
});

test("when the reader opens and closes the process groups, every sentence stays in place exactly once", async (t) => {
  const { view } = await mountAnswerTurn(t, interleavedMultiMessageTurn());
  const root = messagesOf(view);
  assertCanonicalLayout(view);
  const groups = processGroups(root);
  await click(groups[0]);
  await click(groups[1]);
  assertCanonicalLayout(view, { groupsOpen: true });
  assert.ok(byRole(root, "button", /Read.*src\/app\.ts/), "the open tool-call group shows its row");
  assert.ok(byRole(root, "button", /Deep thinking/), "the open thinking group shows its row");
  await click(groups[0]);
  await click(groups[1]);
  assertCanonicalLayout(view);
});

test("when a turn streams its sentences one after another, they are readable while streaming and stay so once the turn completes", async (t) => {
  const sessionId = "answer-visibility-live";
  const before = turnDetail(sessionId, [userTurn()]);
  const completed = interleavedMultiMessageTurn(sessionId);
  let current = before;
  const { view, host } = await mountAnswerTurn(t, before, { getSession: async () => current });

  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_start", message: assistantReply([textBlock(OPENING)], "toolUse") });
  await emit(host, {
    type: "message_update",
    message: assistantReply([textBlock(OPENING), readStep("call-read-1", "src/app.ts")], "toolUse"),
  });
  assertReadingOrder(view, [OPENING]);
  await emit(host, {
    type: "message_end",
    message: assistantReply([textBlock(OPENING), readStep("call-read-1", "src/app.ts")], "toolUse"),
  });
  await emit(host, { type: "message_end", message: toolOutput("call-read-1", TOOL_OUTPUT, Date.now()) });
  await emit(host, { type: "message_update", message: assistantReply([textBlock(MIDWAY)], "stop") });
  assertReadingOrder(view, [OPENING, MIDWAY]);
  await emit(host, {
    type: "message_update",
    message: assistantReply([textBlock(MIDWAY), thinkingBlock(ANALYSIS), textBlock(CONCLUSION)], "stop"),
  });
  assertReadingOrder(view, [OPENING, MIDWAY, CONCLUSION]);
  await emit(host, {
    type: "message_end",
    message: assistantReply([textBlock(MIDWAY), thinkingBlock(ANALYSIS), textBlock(CONCLUSION)], "stop"),
  });
  assertReadingOrder(view, [OPENING, MIDWAY, CONCLUSION]);

  current = completed;
  await emit(host, { type: "agent_end" });
  assertCanonicalLayout(view);
});

test("when a reply is nothing but a sentence, the reader sees a plain reply with nothing to open", async (t) => {
  const { view } = await mountAnswerTurn(t, plainReplyTurn());
  assert.ok(onScreen(view, CONCLUSION), "the sentence is readable as the reply");
  assert.equal(collapsedGroups(messagesOf(view)).length, 0, "a plain reply offers no process group to open");
});

test("when a provider failure in the middle of a turn is later answered, the reader sees the process details and the reply but no failure", async (t) => {
  const { view } = await mountAnswerTurn(t, failedTurn());
  const root = messagesOf(view);
  const opening = onScreen(view, OPENING);
  const conclusion = onScreen(view, CONCLUSION);
  const groups = collapsedGroups(root);
  assert.equal(groups.length, 1, "the tool call before the failure waits behind one collapsed group");
  comesBefore(opening, groups[0], "the sentence written before the failure is read before the tool-call group");
  comesBefore(groups[0], conclusion, "the reply that ends the turn is read after the process details");
  assert.ok(!text(root, FAILURE_DETAIL), "a failure the turn later answered is not shown");
});
