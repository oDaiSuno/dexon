import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, byRole, click, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import {
  createSessionDetail,
  createSessionTestHost,
} from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  ANALYSIS,
  CONCLUSION,
  FAILURE_DETAIL,
  TOOL_OUTPUT,
  assistantReply,
  readStep,
  textBlock,
  thinkingBlock,
  toolOutput,
  turnDetail,
  userTurn,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "chat-status-line",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const STATUS = /^(Waiting for model…|Thinking…|Running .+…)$/;
const WAITING = "Waiting for model…";
const THINKING = "Thinking…";
const NEXT_QUESTION = "再查一次这个配置。";
const FIRST_QUESTION = "帮我看看这个项目的配置。";
const NEW_SESSION = "status-first-message";

function messagesArea(container) {
  const area = byRole(container, "group", "Messages");
  assert.ok(area, "the conversation shows its message area");
  return area;
}

function statusLine(container) {
  return [...messagesArea(container).querySelectorAll("*")]
    .filter((node) => node.children.length === 0)
    .map((node) => node.textContent.trim())
    .filter((value) => STATUS.test(value));
}

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

async function scene(t, id) {
  const detail = turnDetail(id, [{ ...userTurn(), timestamp: 1 }]);
  const host = createSessionTestHost({
    getSession: async () => detail,
    agentState: async () => ({ running: false }),
    sendAgentCommand: async () => ({}),
  });
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  const props = {
    session: detail.info,
    newSessionCwd: null,
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  };
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      boundary.close();
    }
  });
  view = await mount(t, ChatWindow, props);
  await settle();
  const emit = async (event) => {
    await act(async () => {
      for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
    });
    await settle();
  };
  return { view, root: view.container, host, emit, show: (visible) => view.update({ ...props, visible }) };
}

async function freshScene(t) {
  const detail = createSessionDetail(NEW_SESSION, { messages: [], entryIds: [], messageCount: 0 });
  const host = createSessionTestHost({
    getSession: async () => detail,
    agentState: async () => ({ running: false }),
    newAgent: async () => ({ sessionId: NEW_SESSION, data: null }),
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
    session: null,
    newSessionCwd: "/fixture",
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
  return { view, root: view.container, host, emit };
}

async function ask(view, question) {
  const box = byRole(view.container, "textbox");
  assert.ok(box, "the chat offers a place to write a message");
  await act(async () => {
    box.focus();
    box.textContent = question;
    const range = dom.window.document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    box.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  await settle();
  await click(byRole(view.container, "button", "Send"));
  await settle();
}

test("when the first question of a new conversation is sent, the status line says the app is waiting for the model before the model has written anything", async (t) => {
  const { view, root, host, emit } = await freshScene(t);
  await ask(view, FIRST_QUESTION);
  assert.deepEqual(
    host.sendCommands.filter((command) => command.payload.type === "prompt").map((command) => command.payload.message),
    [FIRST_QUESTION],
    "the question the reader typed was really sent",
  );
  assert.deepEqual(
    statusLine(root),
    [WAITING],
    "the wait shows up as soon as the question leaves the composer, before any word comes back from the host",
  );

  await emit({ type: "agent_start" });
  assert.deepEqual(statusLine(root), [WAITING], "the run has begun, but the model is still being waited for");

  await emit({ type: "message_start", message: assistantReply([], "stop", 1) });
  assert.deepEqual(
    statusLine(root),
    [WAITING],
    "the model has connected with nothing written yet, so the wait stays on screen instead of leaving it blank",
  );
});

test("when the question has just been sent, the status line says the app is waiting for the model", async (t) => {
  const { root, emit } = await scene(t, "status-sent");
  await emit({ type: "agent_start" });
  assert.deepEqual(statusLine(root), [WAITING], "the reader is told the question is on its way");
});

test("when the model has connected but nothing has been written yet, the status line still says the app is waiting for the model", async (t) => {
  const { root, emit } = await scene(t, "status-connected");
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", 1) });
  assert.deepEqual(statusLine(root), [WAITING], "the wait for the first words never leaves the screen blank");
});

test("when a tool has finished and the app waits for the next step, the status line says it is waiting for the model", async (t) => {
  const { root, emit } = await scene(t, "status-between-steps");
  await emit({ type: "agent_start" });
  await emit({ type: "message_end", message: assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "toolUse", 1) });
  await emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "read" });
  assert.deepEqual(statusLine(root), ["Running read…"], "a running tool is named while it runs");
  await emit({ type: "tool_execution_end", toolCallId: "c1" });
  assert.deepEqual(statusLine(root), [WAITING], "after the tool the reader is told the next step is waited for");
  await emit({ type: "message_end", message: toolOutput("c1", TOOL_OUTPUT, 2) });
  assert.deepEqual(statusLine(root), [WAITING], "the status line never blinks away between the steps");
});

test("when the reader leaves the conversation while waiting and comes back, the status line is still there", async (t) => {
  const { root, emit, show } = await scene(t, "status-away");
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", 1) });
  await show(false);
  await settle();
  await show(true);
  await settle();
  assert.deepEqual(statusLine(root), [WAITING], "coming back shows the wait, not an empty conversation");
});

test("while the model thinks or writes the arguments of a tool call, the status line says it is thinking", async (t) => {
  const { root, emit } = await scene(t, "status-thinking");
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "toolUse", 1) });
  await emit({ type: "message_update", message: assistantReply([thinkingBlock(ANALYSIS)], "toolUse", 1) });
  assert.deepEqual(statusLine(root), [THINKING], "thinking is what the reader is told while the model thinks");
  await emit({
    type: "message_update",
    message: assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "toolUse", 1),
  });
  assert.deepEqual(statusLine(root), [THINKING], "writing a tool call is still the model thinking");
});

test("while the answer text is being written the status line steps aside, and it comes back for a tool call after the text", async (t) => {
  const { root, emit } = await scene(t, "status-answer-text");
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", 1) });
  await emit({ type: "message_update", message: assistantReply([textBlock(CONCLUSION)], "stop", 1) });
  assert.deepEqual(statusLine(root), [], "the status line never competes with the answer being written");
  assert.ok(messagesArea(root).textContent.includes(CONCLUSION), "the answer text itself is on screen");
  await emit({
    type: "message_update",
    message: assistantReply([textBlock(CONCLUSION), readStep("c1")], "toolUse", 1),
  });
  assert.deepEqual(statusLine(root), [THINKING], "a tool call after the text brings the status line back");
});

test("when the app is waiting to retry, the retry line keeps its place and no status line competes with it", async (t) => {
  const { root, emit } = await scene(t, "status-retry-wait");
  await emit({ type: "agent_start" });
  await emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 60_000, errorMessage: FAILURE_DETAIL });
  assert.deepEqual(statusLine(root), [], "the retry line speaks for the wait");
  const content = messagesArea(root).textContent;
  assert.match(content, /Retrying/, "the retry line is on screen");
  assert.match(content, /1\/3/, "the retry line says which attempt is being made");
});

test("when the reader stops while waiting for the model, the status line goes away and the composer sends the next question", async (t) => {
  const { root, host, emit } = await scene(t, "status-stop");
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", 1) });
  assert.deepEqual(statusLine(root), [WAITING], "the app says it is waiting before the stop");

  await click(byRole(root, "button", "Stop agent"));
  await settle();
  assert.deepEqual(
    host.sendCommands.map((command) => command.payload.type),
    ["abort"],
    "the stop button asks the host to stop the run",
  );
  await emit({ type: "agent_end" });
  assert.deepEqual(statusLine(root), [], "the status line is gone once the reply is stopped");

  const composer = byRole(root, "textbox");
  await act(async () => {
    composer.focus();
    composer.textContent = NEXT_QUESTION;
    const range = dom.window.document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    composer.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  await settle();
  await click(byRole(root, "button", "Send"));
  await settle();
  assert.deepEqual(
    host.sendCommands.filter((command) => command.payload.type === "prompt").map((command) => command.payload.message),
    [NEXT_QUESTION],
    "the reader can type and send the next question after the stop",
  );
});
