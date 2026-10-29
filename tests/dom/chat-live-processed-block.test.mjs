import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  accessibleName,
  act,
  byRole,
  click,
  dom,
  loadRenderer,
  mount,
  restoreGlobals,
  text,
} from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  ANALYSIS,
  CONCLUSION,
  FAILURE_DETAIL,
  REANALYSIS,
  TOOL_OUTPUT,
  at,
  assistantReply,
  readStep,
  textBlock,
  thinkingBlock,
  toolOutput,
  turnDetail,
  userTurn,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "chat-live-processed-block",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const FOLLOWING = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
const QUESTION = { ...userTurn(), timestamp: at(0) };

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

function copyControls(container) {
  return [...messagesArea(container).querySelectorAll("button")].filter(
    (node) => accessibleName(node) === "Copy message",
  );
}

function isBefore(earlier, later, label) {
  assert.ok(earlier.compareDocumentPosition(later) & FOLLOWING, label);
}

function durationToken(node) {
  return [...node.querySelectorAll("*")]
    .map((candidate) => (candidate.children.length === 0 ? candidate.textContent.trim() : ""))
    .find((value) => /^(\d+\.\d+s|\d+m\d+s|\d+s)$/.test(value));
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

async function scene(t, id, { now, messages = [QUESTION] } = {}) {
  if (now !== undefined) t.mock.timers.enable({ apis: ["Date", "setInterval"], now });
  let current = turnDetail(id, messages);
  let runActive = true;
  const host = createSessionTestHost({
    getSession: async () => current,
    agentState: async () => (runActive ? { running: true, state: { isStreaming: true } } : { running: false }),
    sendAgentCommand: async () => ({}),
  });
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  const props = {
    session: current.info,
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
  const show = async () => {
    view = await mount(t, ChatWindow, props);
    await settle();
  };
  await show();
  const emit = async (event) => {
    await act(async () => {
      for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
    });
    await settle();
  };
  return {
    host,
    emit,
    root: view.container,
    setDetail: (next) => (current = turnDetail(id, next)),
    endRun: () => {
      runActive = false;
    },
    reopen: async () => {
      await view.unmount();
      await show();
      return view.container;
    },
  };
}

test("when a live reply starts thinking and then calls a tool, its whole process waits behind one collapsed Processed block", async (t) => {
  const { root, emit } = await scene(t, "live-one-block", { now: at(5) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({ type: "message_update", message: assistantReply([thinkingBlock(ANALYSIS)], "stop", at(0)) });

  assert.equal(processGroups(root).length, 1, "the thinking waits behind one Processed block");
  assert.equal(processGroups(root)[0].getAttribute("aria-expanded"), "false", "the block is closed");
  assert.equal(
    text(messagesArea(root), ANALYSIS),
    undefined,
    "the raw thinking text is not spread over the conversation",
  );

  await emit({
    type: "message_end",
    message: assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "toolUse", at(0)),
  });
  await emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "read" });
  assert.equal(processGroups(root).length, 1, "the tool call joins the same block");
  await emit({ type: "tool_execution_end", toolCallId: "c1" });
  await emit({ type: "message_end", message: toolOutput("c1", TOOL_OUTPUT, at(2)) });
  await emit({ type: "message_start", message: assistantReply([], "toolUse", at(2)) });
  await emit({ type: "message_update", message: assistantReply([thinkingBlock(REANALYSIS)], "toolUse", at(2)) });

  assert.equal(processGroups(root).length, 1, "thinking after the tool result joins the same block again");
  assert.equal(text(messagesArea(root), REANALYSIS), undefined, "the later thinking text is not spread either");
});

test("while a live reply is thinking, its Processed block counts the seconds since the question was sent", async (t) => {
  const { root, emit } = await scene(t, "live-counting", { now: at(21) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "toolUse", at(0)) });
  await emit({ type: "message_update", message: assistantReply([thinkingBlock(ANALYSIS)], "toolUse", at(0)) });

  assert.match(labelOf(root), /Processed 21s/, "the block counts from the moment the question was sent");
  await tick(t, 4000);
  assert.match(labelOf(root), /Processed 25s/, "the number keeps up while the reply goes on");
});

test("when the live reply starts writing its answer, the block stops counting, the text follows it and the next step opens a new block from zero", async (t) => {
  const { root, emit } = await scene(t, "live-answer-text", { now: at(50) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({
    type: "message_update",
    message: {
      ...assistantReply([thinkingBlock(ANALYSIS), textBlock(CONCLUSION)], "stop", at(0)),
      dexonTiming: { blocks: [{ startedAt: at(1), endedAt: at(40) }, { startedAt: at(40) }] },
    },
  });

  assert.match(labelOf(root), /Processed 40s/, "the block stops at the moment the answer text began");
  const answer = text(messagesArea(root), CONCLUSION);
  assert.ok(answer, "the answer text is on screen while it is written");
  isBefore(processGroups(root)[0], answer, "the answer text is read after the block");
  await tick(t, 5000);
  assert.match(labelOf(root), /Processed 40s/, "the number stays where the answer text took over");

  await emit({
    type: "message_update",
    message: {
      ...assistantReply([thinkingBlock(ANALYSIS), textBlock(CONCLUSION), readStep("c2")], "toolUse", at(0)),
      dexonTiming: {
        blocks: [{ startedAt: at(1), endedAt: at(40) }, { startedAt: at(40), endedAt: at(55) }, { startedAt: at(55) }],
      },
    },
  });

  assert.equal(processGroups(root).length, 2, "a step after the answer text opens a block of its own");
  assert.match(labelOf(root, 0), /Processed 40s/, "the first block keeps the number it stopped at");
  assert.match(labelOf(root, 1), /Processed 0s/, "the new block counts from the moment it appears");
});

test("when the live reply ends, its blocks keep their place and numbers and only the footer appears", async (t) => {
  const { root, emit, setDetail, endRun } = await scene(t, "live-then-finished", { now: at(40) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({
    type: "message_update",
    message: {
      ...assistantReply([thinkingBlock(ANALYSIS), textBlock(CONCLUSION)], "stop", at(0)),
      dexonTiming: { blocks: [{ startedAt: at(1), endedAt: at(40) }, { startedAt: at(40) }] },
    },
  });

  assert.match(labelOf(root), /Processed 40s/, "the block reports its number while the reply is being written");
  assert.equal(copyControls(root).length, 0, "a reply that is still being written offers no footer");
  setDetail([
    QUESTION,
    {
      ...assistantReply([thinkingBlock(ANALYSIS), textBlock(CONCLUSION)], "stop", at(65)),
      dexonTiming: {
        blocks: [
          { startedAt: at(1), endedAt: at(40) },
          { startedAt: at(40), endedAt: at(65) },
        ],
      },
    },
  ]);
  endRun();
  await emit({ type: "agent_end" });

  assert.equal(processGroups(root).length, 1, "the finished reply shows the same single block");
  assert.match(labelOf(root), /Processed 40s/, "the number does not change when the reply ends");
  assert.equal(copyControls(root).length, 1, "only now does the reply offer its footer");
  assert.ok(text(messagesArea(root), CONCLUSION), "the answer text stays on screen after the reply ends");
  isBefore(processGroups(root)[0], copyControls(root)[0], "the block stays above the footer");
});

test("when a live reply fails and is retried, it shows two Processed blocks before and after the failure", async (t) => {
  const { root, emit, setDetail, endRun } = await scene(t, "live-retried", { now: at(0) });
  const firstProcess = {
    ...assistantReply([thinkingBlock(ANALYSIS), readStep("call-read-1")], "toolUse", at(10)),
    dexonTiming: {
      blocks: [
        { startedAt: at(1), endedAt: at(9) },
        { startedAt: at(9), endedAt: at(10) },
      ],
    },
  };
  const failure = { ...assistantReply([], "error", at(13)), errorMessage: FAILURE_DETAIL, dexonTiming: { blocks: [] } };
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "toolUse", at(0)) });
  await tick(t, 10_000);
  await emit({ type: "message_end", message: firstProcess });
  await emit({ type: "tool_execution_start", toolCallId: "call-read-1", toolName: "read" });
  await tick(t, 2000);
  await emit({ type: "tool_execution_end", toolCallId: "call-read-1" });
  await emit({ type: "message_end", message: toolOutput("call-read-1", TOOL_OUTPUT, at(12)) });
  await tick(t, 1000);
  await emit({ type: "message_end", message: failure });
  await emit({ type: "agent_end", willRetry: true });
  await emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 60_000, errorMessage: FAILURE_DETAIL });

  assert.equal(processGroups(root).length, 1, "the work before the failure waits behind one block");
  const frozen = labelOf(root);
  assert.match(frozen, /Processed 12s/, "the block ends at the tool result of the failed attempt");

  await tick(t, 5000);
  assert.equal(
    labelOf(root),
    frozen,
    "the number stops while the app waits to retry, instead of growing with the wait",
  );

  await emit({ type: "auto_retry_end", success: true, attempt: 1 });
  await emit({ type: "message_start", message: assistantReply([], "toolUse", at(18)) });
  await emit({
    type: "message_update",
    message: {
      ...assistantReply([thinkingBlock(REANALYSIS), readStep("read-2", "src/main.ts")], "toolUse", at(18)),
      dexonTiming: { blocks: [{ startedAt: at(18), endedAt: at(18) }, { startedAt: at(18) }] },
    },
  });

  assert.equal(processGroups(root).length, 2, "the work after the failure opens a second block while it runs");
  assert.equal(labelOf(root, 0), frozen, "the first block keeps the number it froze at");
  assert.match(labelOf(root, 1), /Processed 0s/, "the second block counts from the moment it appears");

  await tick(t, 2000);
  setDetail([
    QUESTION,
    firstProcess,
    toolOutput("call-read-1", TOOL_OUTPUT, at(12)),
    failure,
    {
      ...assistantReply([thinkingBlock(REANALYSIS), readStep("read-2", "src/main.ts")], "toolUse", at(21)),
      dexonTiming: {
        blocks: [
          { startedAt: at(18), endedAt: at(21) },
          { startedAt: at(21), endedAt: at(22) },
        ],
      },
    },
    toolOutput("read-2", TOOL_OUTPUT, at(22)),
    {
      ...assistantReply([textBlock(CONCLUSION)], "stop", at(25)),
      dexonTiming: { blocks: [{ startedAt: at(23), endedAt: at(25) }] },
    },
  ]);
  endRun();
  await emit({ type: "agent_end" });

  assert.equal(processGroups(root).length, 2, "the finished reply keeps its two blocks and never merges them");
  assert.equal(
    labelOf(root, 0),
    frozen,
    "the block that froze during the wait keeps its number once the turn finishes",
  );
});

test("when the reader stops a reply while it is still thinking, the block freezes, keeps what it already holds and shows the same number when the conversation is opened again", async (t) => {
  const { root, emit, host, setDetail, endRun, reopen } = await scene(t, "live-stopped", { now: at(20) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "toolUse", at(0)) });
  await emit({
    type: "message_update",
    message: assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "toolUse", at(0)),
  });

  const before = labelOf(root);
  assert.match(before, /Processed 20s/, "the block counts up to the moment of the stop");

  await click(byRole(root, "button", "Stop agent"));
  await settle();
  assert.deepEqual(
    host.sendCommands.map((command) => command.payload.type),
    ["abort"],
    "the stop button asks the host to stop the run",
  );

  const stopped = {
    ...assistantReply([thinkingBlock(ANALYSIS), readStep("c1")], "aborted", at(20)),
    dexonTiming: {
      blocks: [
        { startedAt: at(1), endedAt: at(20) },
        { startedAt: at(20), endedAt: at(20) },
      ],
    },
  };
  setDetail([QUESTION, stopped]);
  endRun();
  await emit({ type: "message_end", message: stopped });
  await emit({ type: "agent_end" });

  assert.equal(labelOf(root), before, "stopping keeps the number the block had");
  await tick(t, 30_000);
  assert.equal(labelOf(root), before, "the number never grows after the reply stopped");
  await click(processGroups(root)[0]);
  await settle();
  assert.equal(thinkingRows(root).length, 1, "what was already thought stays inside the block");

  const reopened = await reopen();
  assert.equal(labelOf(reopened), before, "opening the conversation again shows the same number");
});

test("when the model fails in the middle of a reply, its block freezes and the failure is shown below it", async (t) => {
  const { root, emit, setDetail, endRun } = await scene(t, "live-failed", { now: at(12) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({ type: "message_update", message: assistantReply([thinkingBlock(ANALYSIS)], "stop", at(0)) });

  const before = labelOf(root);
  assert.match(before, /Processed 12s/, "the block counts up to the moment the model failed");

  const failed = {
    ...assistantReply([thinkingBlock(ANALYSIS)], "error", at(0)),
    errorMessage: FAILURE_DETAIL,
    dexonTiming: { blocks: [{ startedAt: at(1), endedAt: at(12) }] },
  };
  setDetail([QUESTION, failed]);
  endRun();
  await emit({ type: "message_end", message: failed });
  await emit({ type: "agent_end" });
  await tick(t, 30_000);

  assert.equal(labelOf(root), before, "the failure stops the number for good");
  const failure = text(messagesArea(root), FAILURE_DETAIL);
  assert.ok(failure, "the failure itself is readable");
  isBefore(processGroups(root)[0], failure, "the failure is read below the block");
});

test("when the reader opens the block that is still running, the live thinking is readable and its tool row keeps counting", async (t) => {
  const { root, emit } = await scene(t, "live-open", { now: at(5) });
  await emit({ type: "agent_start" });
  await emit({ type: "message_start", message: assistantReply([], "stop", at(0)) });
  await emit({ type: "message_update", message: assistantReply([thinkingBlock(ANALYSIS)], "stop", at(0)) });

  assert.ok(processGroups(root)[0], "the thinking waits behind a Processed block the reader can open");
  await click(processGroups(root)[0]);
  await settle();
  assert.ok(text(messagesArea(root), ANALYSIS), "the thinking that is still going on is readable inside the block");
  const grown = `${ANALYSIS}\n再想一句`;
  await emit({ type: "message_update", message: assistantReply([thinkingBlock(grown)], "stop", at(0)) });
  assert.ok(text(messagesArea(root), grown), "the live thinking keeps growing inside the open block");

  await emit({
    type: "message_update",
    message: assistantReply([thinkingBlock(grown), readStep("c1")], "toolUse", at(0)),
  });
  await emit({
    type: "message_end",
    message: assistantReply([thinkingBlock(grown), readStep("c1")], "toolUse", at(0)),
  });
  await emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "read" });
  const [row] = [...messagesArea(root).querySelectorAll("button")].filter((node) =>
    /src\/app\.ts/.test(node.textContent),
  );
  assert.ok(row, "the running tool has a row inside the block");
  const started = Number.parseFloat(durationToken(row));
  assert.ok(Number.isFinite(started), "the running tool reports how long it has been running");
  await tick(t, 2000);
  const later = Number.parseFloat(durationToken(row));
  assert.ok(later > started, `the running tool keeps counting: ${started}s became ${later}s`);
});
