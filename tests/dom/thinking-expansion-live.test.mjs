import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, byRole, click, dom, hover, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { allByRole } from "../support/dom-queries.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  assistantReply,
  readStep,
  textBlock,
  thinkingBlock,
  toolOutput,
  turnDetail,
  userTurn,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "thinking-expansion-live",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

async function emit(host, event) {
  await act(async () => {
    for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
  });
  await settle();
}

function rows(root, pattern) {
  return [...root.querySelectorAll("button[aria-expanded]")].filter((node) => pattern.test(node.textContent));
}

const thinkingRows = (root) => rows(root, /Deep thinking/);
const groupRows = (root) => rows(root, /Processed|Process details/);
const states = (buttons) =>
  buttons.map((node) => (node.getAttribute("aria-expanded") === "true" ? "open" : "closed")).join(",");

async function openGroup(root) {
  const [group] = groupRows(root);
  assert.ok(group, "the process of the reply waits behind a block the reader can open");
  if (group.getAttribute("aria-expanded") === "false") await click(group);
}

async function scene(t, id, initial = [userTurn()]) {
  let current = turnDetail(id, initial);
  const host = createSessionTestHost({
    getSession: async () => current,
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
    session: current.info,
    newSessionCwd: null,
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  });
  await settle();
  return {
    root: view.container,
    host,
    setDetail: (detail) => {
      current = detail;
    },
  };
}

const step = (number, last = false) =>
  assistantReply(
    last
      ? [thinkingBlock(`第${number}段思考`), textBlock("结论：配置正常。")]
      : [thinkingBlock(`第${number}段思考`), readStep(`call-${number}`, `file-${number}.ts`)],
    last ? "stop" : "toolUse",
    1000 + number * 4,
  );

async function finish(host, id, index, message) {
  await emit(host, { type: "message_start", message });
  await emit(host, { type: "message_end", message });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-${index}` });
  const call = message.content.find((block) => block.type === "toolCall");
  if (!call) return;
  await emit(host, { type: "message_end", message: toolOutput(call.toolCallId, "ok", 1000 + index * 4 + 1) });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-${index + 1}` });
}

const saved = (messages) =>
  messages.flatMap((message) => {
    const call = message.content.find((block) => block.type === "toolCall");
    return call ? [message, toolOutput(call.toolCallId, "ok", 1)] : [message];
  });

test("when only the first finished thinking segment is clicked mid-reply, only it opens, later segments arrive closed, and the choice survives the end of the reply", async (t) => {
  const id = "s1";
  const { root, host, setDetail } = await scene(t, id);
  const turn = [step(1), step(2), step(3), step(4, true)];
  await emit(host, { type: "agent_start" });
  await finish(host, id, 1, turn[0]);
  await finish(host, id, 3, turn[1]);
  await openGroup(root);
  await click(thinkingRows(root)[0]);
  assert.equal(states(thinkingRows(root)), "open,closed", "only the clicked segment opens");
  await finish(host, id, 5, turn[2]);
  await finish(host, id, 7, turn[3]);
  assert.equal(states(thinkingRows(root)), "open,closed,closed,closed", "segments that appear later stay closed");
  setDetail(turnDetail(id, [userTurn(), ...saved(turn)]));
  await emit(host, { type: "agent_end" });
  assert.equal(states(groupRows(root)), "open", "the block opened while the reply was written stays open");
  assert.equal(states(thinkingRows(root)), "open,closed,closed,closed", "the finished reply keeps what the reader did");
});

test("when the reader clicks the segment that is still thinking, it closes at once, keeps shimmering and updating its preview, stays closed after thinking ends, and reopens on the next click", async (t) => {
  const id = "s2";
  const { root, host } = await scene(t, id);
  await emit(host, { type: "agent_start" });
  await emit(host, {
    type: "message_start",
    message: assistantReply([thinkingBlock("第1段思考")], "toolUse", 1004),
  });
  await openGroup(root);
  assert.equal(states(thinkingRows(root)), "open", "an untouched live segment shows its live text");
  await click(thinkingRows(root)[0]);
  assert.equal(states(thinkingRows(root)), "closed", "one click closes it immediately");
  assert.ok(root.querySelector(".chat-shimmer-text"), "the label still shimmers while it is closed");
  await emit(host, {
    type: "message_update",
    message: assistantReply([thinkingBlock("第1段思考，又多想了一句")], "toolUse", 1004),
  });
  assert.match(thinkingRows(root)[0].textContent, /又多想了一句/, "the preview keeps updating while closed");
  await emit(host, { type: "message_end", message: step(1) });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-1` });
  assert.equal(states(thinkingRows(root)), "closed", "it stays closed after thinking ends");
  await click(thinkingRows(root)[0]);
  assert.equal(states(thinkingRows(root)), "open", "the next click opens it again");
});

test("when the reader never touches the live segment, it is open while thinking and closes by itself when thinking ends", async (t) => {
  const { root, host } = await scene(t, "s3");
  await emit(host, { type: "agent_start" });
  await emit(host, {
    type: "message_start",
    message: assistantReply([thinkingBlock("第1段思考")], "toolUse", 1004),
  });
  await openGroup(root);
  assert.equal(states(thinkingRows(root)), "open", "the live segment shows its text without being asked");
  await emit(host, { type: "message_end", message: step(1) });
  assert.equal(states(thinkingRows(root)), "closed", "it closes by itself once thinking ends");
});

test("when the reader opened things in the first reply, the second reply's segments and Processed block still start closed", async (t) => {
  const id = "s4";
  const { root, host, setDetail } = await scene(t, id);
  const first = [step(1), step(9, true)];
  await emit(host, { type: "agent_start" });
  await finish(host, id, 1, first[0]);
  await openGroup(root);
  await click(thinkingRows(root)[0]);
  await finish(host, id, 3, first[1]);
  setDetail(turnDetail(id, [userTurn(), ...saved(first)]));
  await emit(host, { type: "agent_end" });
  await openGroup(root);
  const followUp = { role: "user", content: "再查一次", timestamp: 2000 };
  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_start", message: step(2) });
  await emit(host, { type: "message_end", message: step(2) });
  assert.equal(states(thinkingRows(root)).split(",").at(-1), "closed", "the second reply's segment is not pre-opened");
  setDetail(turnDetail(id, [userTurn(), ...saved(first), followUp, ...saved([step(2), step(8, true)])]));
  await emit(host, { type: "agent_end" });
  assert.equal(states(groupRows(root)), "open,closed", "only the first reply's block stays open");
});

test("when the reader opens a tool row while the reply is generating, it is still open after the reply ends", async (t) => {
  const id = "s5";
  const { root, host, setDetail } = await scene(t, id);
  const turn = [
    assistantReply([readStep("call-1", "config.json")], "toolUse", 1004),
    assistantReply([textBlock("好了。")], "stop", 1010),
  ];
  const toolRow = () => rows(root, /config\.json/)[0];
  await emit(host, { type: "agent_start" });
  await finish(host, id, 1, turn[0]);
  await openGroup(root);
  await click(toolRow());
  await finish(host, id, 3, turn[1]);
  setDetail(turnDetail(id, [userTurn(), ...saved(turn)]));
  await emit(host, { type: "agent_end" });
  await openGroup(root);
  assert.equal(toolRow().getAttribute("aria-expanded"), "true", "the row the reader opened stays open");
});

test("when the reader sends a question, the same bubble stays on screen from sending until the reply ends, and then answers to its saved id and can be edited", async (t) => {
  const id = "s6";
  const QUESTION = "请把这份很长的反馈整理成清单。";
  const { root, host, setDetail } = await scene(t, id, []);
  const box = byRole(root, "textbox");
  await act(async () => {
    box.focus();
    box.textContent = QUESTION;
    const range = dom.window.document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    box.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  await settle();
  await click(byRole(root, "button", "Send"));
  await settle();
  const bubble = () =>
    [...root.querySelectorAll("[data-reading-anchor]")].find((node) => node.textContent.includes(QUESTION));
  const sent = bubble();
  assert.ok(sent, "the question shows a bubble right after sending");
  const delivered = { role: "user", content: QUESTION, timestamp: Date.now() };
  const answer = assistantReply([textBlock("整理好了。")], "stop", 1010);
  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_start", message: delivered });
  await emit(host, { type: "message_end", message: delivered });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-0` });
  await finish(host, id, 1, answer);
  setDetail(turnDetail(id, [delivered, answer]));
  await emit(host, { type: "agent_end" });
  assert.ok(bubble() === sent && sent.isConnected, "the bubble on screen is the same one, not rebuilt");
  assert.equal(
    sent.getAttribute("data-reading-anchor"),
    `entry:${id}-entry-0:message`,
    "it now answers to its saved id",
  );
  const editControl = [...sent.querySelectorAll("button")].find((node) =>
    /^edit$/i.test((node.getAttribute("aria-label") ?? node.title ?? "").trim()),
  );
  assert.ok(editControl, "it can be edited");
  await hover(sent);
  await click(editControl);
  await settle();
  const editing = allByRole(root, "textbox")
    .map((node) => (node.value ?? node.textContent).trim())
    .find((value) => value === QUESTION);
  assert.equal(editing, QUESTION, "the edit box holds the question as it was sent");
});

test("when the reader opens a row for another session while the reply is generating, it is still open after the reply ends", async (t) => {
  const id = "s7";
  const { root, host, setDetail } = await scene(t, id);
  const call = {
    type: "toolCall",
    toolCallId: "call-session",
    toolName: "session_new",
    input: { message: "整理配色" },
  };
  const handedOver = assistantReply([call], "toolUse", 1004);
  const launched = {
    role: "toolResult",
    toolCallId: "call-session",
    toolName: "session_new",
    content: [textBlock('{"sessionId":"child-1","status":"running"}')],
    isError: false,
    timestamp: 1006,
  };
  const closing = assistantReply([textBlock("已经交给另一个会话。")], "stop", 1010);
  const sessionRow = () => byRole(root, "button", /New session/);
  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_start", message: handedOver });
  await emit(host, { type: "message_end", message: handedOver });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-1` });
  await emit(host, { type: "message_end", message: launched });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-2` });
  await openGroup(root);
  assert.ok(sessionRow(), "the row for the other session is on screen while the reply goes on");
  await click(sessionRow());
  assert.equal(sessionRow().getAttribute("aria-expanded"), "true", "the reader opened it");
  await emit(host, { type: "message_start", message: closing });
  await emit(host, { type: "message_end", message: closing });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-3` });
  setDetail(turnDetail(id, [userTurn(), handedOver, launched, closing]));
  await emit(host, { type: "agent_end" });
  await openGroup(root);
  assert.equal(sessionRow().getAttribute("aria-expanded"), "true", "the row the reader opened stays open");
});
