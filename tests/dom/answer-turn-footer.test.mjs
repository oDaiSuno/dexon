import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName, allByRole } from "../support/dom-queries.mjs";
import { act, byRole, click, dom, hover, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  CONCLUSION,
  FAILURE_DETAIL,
  FOLLOW_UP_QUESTION,
  MIDWAY,
  OPENING,
  failureOnlyWithUsageTurn,
  timedFailureThenAnswerTurn,
  timedInterleavedTurn,
  timedSingleGroupTurn,
  timedToolEndedTurn,
  twoAnsweredTurns,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "answer-turn-footer",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const FOLLOWING = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
const BRANCH = /^Branch from here$/;
const COPY = /^Copy message$/;
const CLOCK = /\d{1,2}:\d{2}/;

const nameOf = (element) => accessibleName(element) || element.getAttribute("title") || "";

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

function comesBefore(earlier, later, label) {
  assert.ok(earlier.compareDocumentPosition(later) & FOLLOWING, label);
}

function answerActions(root) {
  return allByRole(root, "button").filter((node) => node.classList.contains("message-hover-action"));
}

function controlsNamed(controls, pattern) {
  return controls.filter((node) => pattern.test(nameOf(node)));
}

function answerBranchControls(root) {
  return controlsNamed(answerActions(root), BRANCH);
}

function answerCopyControls(root) {
  return controlsNamed(answerActions(root), COPY);
}

function processGroups(root) {
  return [...root.querySelectorAll("button[aria-expanded]")].filter((node) =>
    /process details|processed/i.test(node.textContent),
  );
}

function leafMatching(root, pattern) {
  return [...root.querySelectorAll("*")].filter(
    (node) => node.children.length === 0 && pattern.test(node.textContent.trim()),
  );
}

function isShown(element) {
  for (let current = element; current; current = current.parentElement) {
    const style = dom.window.getComputedStyle(current);
    if (current.hidden || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
  }
  return true;
}

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
    onSessionForked: () => {},
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  });
  await settle();
  return { view, host };
}

function fakeClipboard(t) {
  const state = { written: "" };
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(value) {
        state.written = value;
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
  return state;
}

test("when a turn interleaves sentences with a tool call and thinking, each process group reports its own processing time", async (t) => {
  const { view } = await mountConversation(t, timedInterleavedTurn());
  const groups = processGroups(messagesOf(view));
  assert.equal(groups.length, 2, "the tool call and the thinking keep one group each");
  assert.match(
    groups[0].textContent,
    /Processed 16s/,
    "the tool-call group counts from the question to its tool result",
  );
  assert.match(groups[1].textContent, /Processed 40s/, "the thinking group counts from the tool result to its reply");
  assert.doesNotMatch(groups[0].textContent, /Process details/, "the tool-call group reports a duration, not counts");
  assert.doesNotMatch(groups[1].textContent, /Process details/, "the thinking group reports a duration, not counts");
});

test("when a turn has a single process group, the group reports the time from the question until its tool finished", async (t) => {
  const { view } = await mountConversation(t, timedSingleGroupTurn());
  const groups = processGroups(messagesOf(view));
  assert.equal(groups.length, 1, "the tool call keeps one group");
  assert.match(
    groups[0].textContent,
    /Processed 12s/,
    "the closing sentence's writing time is no longer counted as processing",
  );
});

test("when a turn is written in several passages, the reader finds a single footer after the last passage and no copy controls between passages", async (t) => {
  const { view } = await mountConversation(t, timedInterleavedTurn());
  const root = messagesOf(view);
  const copies = answerCopyControls(root);
  const controls = answerBranchControls(root);
  assert.equal(copies.length, 1, "the turn offers exactly one copy control");
  assert.equal(controls.length, 1, "the turn offers exactly one Branch from here control");
  const opening = onScreen(view, OPENING);
  const midway = onScreen(view, MIDWAY);
  const conclusion = onScreen(view, CONCLUSION);
  comesBefore(opening, midway, "the first passage is read before the second");
  comesBefore(midway, conclusion, "the second passage is read before the closing passage");
  comesBefore(conclusion, copies[0], "the copy control follows the closing passage of the turn");
  comesBefore(copies[0], controls[0], "the copy control sits beside Branch from here in the turn's single footer");
  for (const action of answerActions(root)) {
    comesBefore(conclusion, action, "every footer action of the turn comes after its closing passage");
  }
});

test("when the reader copies a turn's answer, the clipboard receives every passage of the turn in reading order", async (t) => {
  const clipboard = fakeClipboard(t);
  const { view } = await mountConversation(t, timedInterleavedTurn());
  const [copyControl] = answerCopyControls(messagesOf(view));
  assert.ok(copyControl, "the turn offers a copy control");
  await hover(onScreen(view, CONCLUSION));
  await click(copyControl);
  await settle();
  assert.equal(
    clipboard.written,
    `${OPENING}\n\n${MIDWAY}\n\n${CONCLUSION}`,
    "the clipboard holds every passage of the turn in the order the reader read them",
  );
});

test("when a turn calls the model several times, the footer reports the turn's total usage and cost", async (t) => {
  const { view } = await mountConversation(t, timedInterleavedTurn());
  const content = messagesOf(view).textContent;
  assert.match(content, /3,000 in/, "the footer adds up the input tokens of every model call");
  assert.match(content, /600 out/, "the footer adds up the output tokens of every model call");
  assert.match(content, /800 cache/, "the footer adds up the cached tokens of every model call");
  assert.match(content, /\$0\.0350/, "the footer adds up the cost of every model call");
  assert.match(content, /fixture-model/, "the footer names the model of the turn");
  assert.doesNotMatch(content, /2,000 in/, "the footer never reports only the last model call");
  assert.doesNotMatch(content, /1,000 in/, "the footer never reports only the first model call");
  assert.doesNotMatch(content, /\$0\.0250/, "the footer never reports only the last model call's cost");
});

test("when a model call fails mid-turn, its usage still counts toward the turn's total", async (t) => {
  const { view } = await mountConversation(t, timedFailureThenAnswerTurn());
  const content = messagesOf(view).textContent;
  assert.match(content, /1,000 in/, "the footer adds the failed call's input tokens to the answered one's");
  assert.match(content, /80 out/, "the footer keeps the output tokens of the answering call");
  assert.match(content, /\$0\.0050/, "the footer adds the failed call's cost to the answered one's");
  assert.doesNotMatch(content, /900 in/, "the footer ignores neither the failed call nor the answering one");
});

test("when a turn ends on a tool result after writing a sentence, the footer still offers copy, Branch from here and the time", async (t) => {
  const { view } = await mountConversation(t, timedToolEndedTurn());
  const root = messagesOf(view);
  const copies = answerCopyControls(root);
  const controls = answerBranchControls(root);
  assert.equal(copies.length, 1, "the turn offers a copy control");
  assert.equal(controls.length, 1, "the turn offers a Branch from here control");
  const opening = onScreen(view, OPENING);
  comesBefore(opening, copies[0], "the copy control follows the sentence the turn wrote");
  comesBefore(copies[0], controls[0], "the copy control sits beside Branch from here in the turn's footer");
  const clock = leafMatching(root, CLOCK).find((node) => controls[0].compareDocumentPosition(node) & FOLLOWING);
  assert.ok(clock, "the turn's footer reports its clock time after Branch from here");
  assert.match(root.textContent, /700 in/, "the footer reports the usage recorded before the tool call");
});

test("when a turn only fails, the reader finds no footer for it", async (t) => {
  const { view } = await mountConversation(t, failureOnlyWithUsageTurn());
  const root = messagesOf(view);
  assert.equal(answerActions(root).length, 0, "a turn without a single passage offers no footer actions");
  assert.ok(onScreen(view, FAILURE_DETAIL), "the failure itself stays on screen");
  assert.doesNotMatch(root.textContent, /100 in/, "a turn without a passage reports no usage");
  assert.doesNotMatch(root.textContent, /\$0\.0010/, "a turn without a passage reports no cost");
});

test("when the reader points at a turn's process group, the footer actions appear", async (t) => {
  const { view } = await mountConversation(t, timedInterleavedTurn());
  const root = messagesOf(view);
  const [group] = processGroups(root);
  const [copyControl] = answerCopyControls(root);
  const [control] = answerBranchControls(root);
  assert.ok(copyControl, "the turn offers a copy control");
  assert.ok(control, "the turn offers a Branch from here control");
  assert.equal(isShown(copyControl), false, "the copy control stays out of the way until the reader points");
  assert.equal(isShown(control), false, "Branch from here stays out of the way until the reader points");
  await hover(group);
  assert.equal(isShown(copyControl), true, "pointing at the process group reveals the copy control");
  assert.equal(isShown(control), true, "pointing at the process group reveals Branch from here");
});

test("while the latest turn is still being answered, it offers no footer, and earlier turns keep theirs", async (t) => {
  const { view, host } = await mountConversation(t, twoAnsweredTurns());
  assert.equal(
    answerCopyControls(messagesOf(view)).length,
    2,
    "both finished turns offer a copy control while the conversation rests",
  );
  await emit(host, { type: "agent_start" });
  const running = answerCopyControls(messagesOf(view));
  assert.equal(running.length, 1, "the turn being answered offers no copy control");
  comesBefore(running[0], onScreen(view, FOLLOW_UP_QUESTION), "the remaining copy control belongs to the earlier turn");
  await emit(host, { type: "agent_end" });
  assert.equal(answerCopyControls(messagesOf(view)).length, 2, "the copy control returns once the run has finished");
});
