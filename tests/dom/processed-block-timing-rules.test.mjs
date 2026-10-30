import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, byRole, click, dom, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";
import {
  ANALYSIS,
  CONCLUSION,
  MIDWAY,
  OPENING,
  REANALYSIS,
  TOOL_OUTPUT,
  at,
  assistantReply,
  readStep,
  textBlock,
  thinkingBlock,
  toolOutput,
  userTurn,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "processed-block-timing-rules",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const QUESTION = { ...userTurn(), timestamp: at(0) };
const STATUS = /^(Waiting for model…|Thinking…|Running .+…)$/;

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

function labelOf(container, index = 0) {
  const groups = processGroups(container);
  assert.ok(groups[index], `the conversation shows a Processed block number ${index + 1}`);
  return groups[index].textContent.trim();
}

function thinkingRows(container) {
  return [...messagesArea(container).querySelectorAll("button")].filter((node) =>
    /Deep thinking/.test(node.textContent),
  );
}

function toolRow(container) {
  const row = [...messagesArea(container).querySelectorAll("button")].find((node) =>
    /src\/app\.ts/.test(node.textContent),
  );
  assert.ok(row, "the conversation shows the tool that was called");
  return row;
}

function durationToken(node) {
  return [...node.querySelectorAll("*")]
    .map((candidate) => (candidate.children.length === 0 ? candidate.textContent.trim() : ""))
    .find((value) => /^(\d+\.\d+s|\d+m\d+s|\d+s)$/.test(value));
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

async function tick(t, milliseconds) {
  await act(async () => t.mock.timers.tick(milliseconds));
  await settle();
}

async function scene(t, id, { now, messages, restored } = {}) {
  if (now !== undefined) t.mock.timers.enable({ apis: ["Date", "setInterval"], now });
  const detailOf = (next) =>
    createSessionDetail(id, {
      messages: next,
      entryIds: next.map((_message, index) => `${id}-entry-${index}`),
      ...(restored ? { agentState: { running: true, state: { isStreaming: true, streamingMessage: restored } } } : {}),
    });
  let current = detailOf(messages ?? [QUESTION]);
  const host = createSessionTestHost({
    getSession: async () => current,
    agentState: async () => current.agentState,
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
  const emit = async (event) => {
    await act(async () => {
      for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
    });
    await settle();
  };
  return { root: view.container, emit, setDetail: (next) => (current = detailOf(next)) };
}

test("when a timed thinking step lasted less than a second, its row reports that step alone instead of the whole reply", async (t) => {
  const { root } = await scene(t, "short-thinking", {
    messages: [
      QUESTION,
      {
        ...assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "toolUse", at(30)),
        dexonTiming: {
          blocks: [
            { startedAt: at(1), endedAt: at(1.2) },
            { startedAt: at(1.2), endedAt: at(30) },
          ],
        },
      },
      toolOutput("c1", TOOL_OUTPUT, at(32)),
    ],
  });
  await click(processGroups(root)[0]);
  await settle();
  const rows = thinkingRows(root);
  assert.equal(rows.length, 1, "the thinking keeps a row of its own");
  assert.match(rows[0].textContent, /0s/, "the row counts the 0.2s record of its own step");
  assert.doesNotMatch(rows[0].textContent, /30s/, "the row does not borrow the length of the whole reply");
});

test("while a reply is still thinking, the block it waits behind keeps that thinking readable and gives it no finished length", async (t) => {
  const { root, emit } = await scene(t, "open-thinking", { now: at(5) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({
    type: "message_update",
    message: {
      ...assistantReply([thinkingBlock(ANALYSIS)], "stop", at(3)),
      dexonTiming: { blocks: [{ startedAt: at(1) }] },
    },
  });
  await click(processGroups(root)[0]);
  await settle();
  const [row] = thinkingRows(root);
  assert.ok(row, "the live thinking has a row inside the open block");
  assert.equal(row.getAttribute("aria-expanded"), "true", "the thinking that is still going on stays readable");
  assert.ok(text(messagesArea(root), ANALYSIS), "the live thinking text is on screen");
  assert.doesNotMatch(row.textContent, /\ds$/, "a thinking step without an end reports no finished length");
});

test("when a reply freezes, its block shows the number the live block was showing", async (t) => {
  const { root, emit, setDetail } = await scene(t, "frozen-number", { now: at(40.6) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({
    type: "message_update",
    message: {
      ...assistantReply([thinkingBlock(ANALYSIS)], "stop", at(3)),
      dexonTiming: { blocks: [{ startedAt: at(1) }] },
    },
  });
  const live = labelOf(root);
  assert.match(live, /Processed 40s/, "the live block counts whole seconds since the question was sent");

  setDetail([
    QUESTION,
    {
      ...assistantReply([thinkingBlock(ANALYSIS)], "aborted", at(41)),
      dexonTiming: { blocks: [{ startedAt: at(1), endedAt: at(40.6) }] },
    },
  ]);
  await emit({ type: "agent_end" });
  assert.equal(labelOf(root), live, "the frozen block keeps the number the live one showed");
});

test("a timed block that lasted less than a second still shows its number", async (t) => {
  const { root } = await scene(t, "short-block", {
    messages: [
      QUESTION,
      {
        ...assistantReply([thinkingBlock(ANALYSIS)], "aborted", at(0.5)),
        dexonTiming: { blocks: [{ startedAt: at(0.1), endedAt: at(0.4) }] },
      },
    ],
  });
  assert.match(labelOf(root), /Processed 0s/, "a recorded block of 0s reports 0s rather than losing its number");
});

test("when a step comes after the answer text, its block counts from that step, not from the question", async (t) => {
  const { root, emit } = await scene(t, "step-after-text", { now: at(30) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "toolUse", at(0)) });
  await emit({
    type: "message_update",
    message: {
      ...assistantReply([textBlock(CONCLUSION), readStep("c1")], "toolUse", at(0)),
      dexonTiming: {
        blocks: [{ startedAt: at(1), endedAt: at(10) }, { startedAt: at(10) }],
      },
    },
  });
  assert.equal(processGroups(root).length, 1, "the step after the answer text opens a block of its own");
  assert.match(labelOf(root), /Processed 20s/, "the block counts the 20s since its own first step began");
});

test("while the model thinks after writing answer text, the status line says it is thinking", async (t) => {
  const { root, emit } = await scene(t, "thinking-after-text", { now: at(30) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({
    type: "message_update",
    message: assistantReply([textBlock(CONCLUSION), thinkingBlock(REANALYSIS)], "stop", at(0)),
  });
  assert.deepEqual(statusLine(root), ["Thinking…"], "thinking after the answer text is reported as thinking");
});

test("while the answer text is written, the speed hint stays with the text it belongs to", async (t) => {
  const { root, emit } = await scene(t, "speed-hint", { now: at(1) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({ type: "message_update", message: assistantReply([textBlock(CONCLUSION)], "stop", at(0)) });
  await tick(t, 1000);
  await tick(t, 1000);
  assert.match(messagesArea(root).textContent, /\d+ tok/, "the live answer reports its token estimate");
  assert.match(messagesArea(root).textContent, /t\/s/, "the live answer reports how fast the words arrive");
});

test("when the reader comes back to a reply that is still being written, its block keeps counting from the recorded start", async (t) => {
  const stillWriting = {
    ...assistantReply([textBlock(MIDWAY), thinkingBlock(REANALYSIS)], "stop", at(20)),
    dexonTiming: {
      blocks: [{ startedAt: at(16), endedAt: at(19) }, { startedAt: at(20) }],
    },
  };
  const { root } = await scene(t, "came-back", {
    now: at(40),
    restored: stillWriting,
    messages: [
      QUESTION,
      assistantReply([textBlock(OPENING), readStep("c1")], "toolUse", at(10)),
      toolOutput("c1", TOOL_OUTPUT, at(15)),
    ],
  });
  assert.equal(processGroups(root).length, 2, "the step after the answer text keeps a block of its own");
  assert.match(
    labelOf(root, 1),
    /Processed 20s/,
    "the block counts the 20s since the start the reply recorded, not the 25s since the tool result",
  );
});

test("when the answer text has begun but no word is on screen yet, the block takes that moment and never counts past it", async (t) => {
  const { root, emit } = await scene(t, "text-begun-no-word", { now: at(19) });
  const timing = { blocks: [{ startedAt: at(1), endedAt: at(10) }, { startedAt: at(14) }] };
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({
    type: "message_update",
    message: { ...assistantReply([thinkingBlock(ANALYSIS), textBlock("")], "stop", at(0)), dexonTiming: timing },
  });
  assert.match(
    labelOf(root),
    /Processed 14s/,
    "the block stops at the moment the answer text began, even though not a word of it is on screen yet",
  );

  await emit({
    type: "message_update",
    message: {
      ...assistantReply([thinkingBlock(ANALYSIS), textBlock(CONCLUSION)], "stop", at(0)),
      dexonTiming: timing,
    },
  });
  assert.match(labelOf(root), /Processed 14s/, "the first word arriving does not step the number back");
});

test("when the next reply begins its answer text but no word is on screen yet, the block before it stops at that moment", async (t) => {
  const firstRun = {
    ...assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "toolUse", at(10)),
    dexonTiming: {
      blocks: [
        { startedAt: at(1), endedAt: at(8) },
        { startedAt: at(8), endedAt: at(10) },
      ],
    },
  };
  const nextReply = {
    ...assistantReply([textBlock("")], "stop", at(19)),
    dexonTiming: { blocks: [{ startedAt: at(14) }] },
  };
  const { root, emit, setDetail } = await scene(t, "next-reply-text-begun", {
    now: at(19),
    messages: [QUESTION, firstRun, toolOutput("c1", TOOL_OUTPUT, at(12))],
  });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(14)) });
  await emit({ type: "message_update", message: nextReply });
  assert.match(
    labelOf(root),
    /Processed 14s/,
    "the block stops at the moment the next reply began its answer text, not at the moment the tool result arrived",
  );

  await emit({
    type: "message_update",
    message: { ...assistantReply([textBlock(CONCLUSION)], "stop", at(19)), dexonTiming: nextReply.dexonTiming },
  });
  assert.match(labelOf(root), /Processed 14s/, "the first word of the next reply does not step the number back");

  setDetail([
    QUESTION,
    firstRun,
    toolOutput("c1", TOOL_OUTPUT, at(12)),
    { ...assistantReply([textBlock(CONCLUSION)], "stop", at(20)), dexonTiming: nextReply.dexonTiming },
  ]);
  await emit({ type: "agent_end" });
  assert.match(labelOf(root), /Processed 14s/, "the finished block keeps the number the live block showed");
});

test("while a tool runs, its row counts from the moment the tool started, as the finished row does", async (t) => {
  const writingCall = { blocks: [{ startedAt: at(1), endedAt: at(2) }, { startedAt: at(2) }] };
  const running = {
    blocks: [
      { startedAt: at(1), endedAt: at(2) },
      { startedAt: at(2), endedAt: at(10) },
    ],
  };
  const { root, emit, setDetail } = await scene(t, "tool-row-clock", { now: at(10) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "toolUse", at(0)) });
  await emit({
    type: "message_update",
    message: {
      ...assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "toolUse", at(0)),
      dexonTiming: writingCall,
    },
  });
  await click(processGroups(root)[0]);
  await settle();
  assert.equal(
    durationToken(toolRow(root)),
    undefined,
    "a call whose arguments are still being written has not run for any time yet",
  );

  await emit({
    type: "message_update",
    message: { ...assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "toolUse", at(0)), dexonTiming: running },
  });
  assert.equal(durationToken(toolRow(root)), "0.0s", "a tool that has just started reports no time behind it");

  await tick(t, 1000);
  assert.equal(durationToken(toolRow(root)), "1.0s", "the running tool counts the second it has been running");

  setDetail([
    QUESTION,
    { ...assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "toolUse", at(10)), dexonTiming: running },
    toolOutput("c1", TOOL_OUTPUT, at(12)),
  ]);
  await emit({ type: "agent_end" });
  if (processGroups(root)[0].getAttribute("aria-expanded") !== "true") {
    await click(processGroups(root)[0]);
    await settle();
  }
  assert.equal(durationToken(toolRow(root)), "2.0s", "the finished tool reports the 2s it ran, as before");
});

test("when the reply has begun its answer text but no word is on screen yet, the status line still waits for the model", async (t) => {
  const { root, emit } = await scene(t, "text-started-no-word-status", { now: at(19) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({
    type: "message_update",
    message: {
      ...assistantReply([thinkingBlock(ANALYSIS), textBlock("")], "stop", at(0)),
      dexonTiming: { blocks: [{ startedAt: at(1), endedAt: at(10) }, { startedAt: at(14) }] },
    },
  });
  assert.deepEqual(
    statusLine(root),
    ["Waiting for model…"],
    "the reader is told the app is still waiting while not a word of the answer is on screen yet",
  );
});

test("while a live Processed block is open, the speed hint sits with the content it belongs to", async (t) => {
  const { root, emit } = await scene(t, "speed-hint-in-block", { now: at(1) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({ type: "message_update", message: assistantReply([thinkingBlock(ANALYSIS)], "stop", at(0)) });
  assert.equal(processGroups(root).length, 1, "the live thinking waits behind one Processed block");
  assert.doesNotMatch(
    messagesArea(root).textContent,
    /tok/,
    "a block that is closed keeps the speed hint out of sight",
  );

  await click(processGroups(root)[0]);
  await settle();
  await tick(t, 1000);
  await tick(t, 1000);
  const block = processGroups(root)[0].parentElement;
  const hint = [...block.querySelectorAll("span")].find((node) => / t\/s$/.test(node.textContent.trim()));
  assert.ok(hint, "the open block reports how fast the words arrive");
  assert.match(
    hint.parentElement.textContent,
    /\d+ tok/,
    "the token estimate stands beside it, as it does for answer text",
  );
  const [row] = thinkingRows(root);
  assert.ok(
    hint.compareDocumentPosition(row) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    "the hint comes before the content it belongs to inside the block",
  );
});
