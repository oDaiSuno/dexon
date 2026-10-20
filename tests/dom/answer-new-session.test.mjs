import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import { accessibleName, allByRole } from "../support/dom-queries.mjs";
import { act, byRole, click, dom, hover, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  CONCLUSION,
  FOLLOW_UP_QUESTION,
  OPENING,
  QUESTION,
  SECOND_ANSWER,
  failureOnlyTurn,
  silentAbortTurn,
  toolEndedTurn,
  toolThenAnswerTurn,
  twoAnsweredTurns,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "answer-new-session",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const FOLLOWING = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
const NEW_SESSION = /New session/;

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

function newSessionControls(root) {
  return controlsNamed(allByRole(root, "button"), NEW_SESSION);
}

function answerNewSessionControls(root) {
  return controlsNamed(answerActions(root), NEW_SESSION);
}

function answerCopyControls(root) {
  return controlsNamed(answerActions(root), /^Copy message$/);
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

async function mountConversation(t, detail, options = {}) {
  const forked = [];
  const host = createSessionTestHost({
    getSession: async () => detail,
    sendAgentCommand: async (sid, payload) => (payload.type === "fork" ? options.answerFork?.(sid, payload) : {}),
    ...options.hostOverrides,
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
  const props = {
    session: detail.info,
    newSessionCwd: null,
    onSessionForked: (sessionId) => forked.push(sessionId),
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  };
  view = await mount(t, ChatWindow, props);
  await settle();
  return { view, host, forked };
}

function forkCommands(host) {
  return host.sendCommands.filter((command) => command.payload?.type === "fork").map((command) => command.payload);
}

const answeredFork = () => Promise.resolve({ cancelled: false, newSessionId: "forked-session" });

test("when a conversation holds two answered turns, the reader finds one New session control at the end of each answer", async (t) => {
  const { view } = await mountConversation(t, twoAnsweredTurns());
  const root = messagesOf(view);
  const controls = newSessionControls(root);
  assert.equal(controls.length, 2, "each of the two answered turns offers exactly one New session control");
  for (const control of controls) {
    assert.equal(control.tagName, "BUTTON", "the control is a real button");
    assert.equal(control.getAttribute("type"), "button", "the control never submits a form");
    assert.match(nameOf(control), NEW_SESSION);
    assert.ok(control.classList.contains("message-hover-action"), "the control joins the hover actions of the answer");
  }
  const firstAnswer = onScreen(view, OPENING);
  const secondQuestion = onScreen(view, FOLLOW_UP_QUESTION);
  const secondAnswer = onScreen(view, SECOND_ANSWER);
  comesBefore(firstAnswer, controls[0], "the first turn's control follows the first answer");
  comesBefore(controls[0], secondQuestion, "the first turn's control sits before the next question");
  comesBefore(secondAnswer, controls[1], "the latest turn's control follows the latest answer");
  const copies = answerCopyControls(root);
  assert.equal(copies.length, 2, "both answers keep their copy control");
  comesBefore(copies[0], controls[0], "the first turn's control sits beside its copy control");
  comesBefore(copies[1], controls[1], "the latest turn's control sits beside its copy control");
  assert.equal(isShown(controls[0]), false, "the control stays out of the way until the reader points at the answer");
  await hover(firstAnswer);
  assert.equal(isShown(controls[0]), true, "pointing at the answer reveals its New session control");
  controls[0].focus();
  assert.equal(dom.window.document.activeElement, controls[0], "the revealed control takes keyboard focus");
});

test("when the reader clicks New session on an answer, the app asks for a new session that includes that answer", async (t) => {
  const { view, host, forked } = await mountConversation(t, twoAnsweredTurns(), { answerFork: answeredFork });
  const [control] = answerNewSessionControls(messagesOf(view));
  assert.ok(control, "the first answer offers a New session control");
  await hover(onScreen(view, OPENING));
  await click(control);
  await settle();
  assert.deepEqual(forkCommands(host), [
    { type: "fork", entryId: "answer-new-session-two-turns-entry-1", position: "at" },
  ]);
  assert.deepEqual(forked, ["forked-session"], "the app is told which new session to open");
});

test("when a turn answers through several replies around a tool call, the reader finds one New session control after the turn's last sentence", async (t) => {
  const { view, host } = await mountConversation(t, toolThenAnswerTurn(), { answerFork: answeredFork });
  const root = messagesOf(view);
  const controls = answerNewSessionControls(root);
  assert.equal(controls.length, 1, "a turn written in several replies still offers a single control");
  comesBefore(onScreen(view, CONCLUSION), controls[0], "the control follows the closing sentence of the turn");
  const copies = answerCopyControls(root);
  assert.equal(copies.length, 1, "the turn keeps a single copy control in its footer");
  comesBefore(copies[0], controls[0], "the copy control and New session share the turn's single footer");
  await hover(onScreen(view, CONCLUSION));
  await click(controls[0]);
  await settle();
  assert.deepEqual(forkCommands(host), [
    { type: "fork", entryId: "answer-new-session-tool-then-answer-entry-3", position: "at" },
  ]);
});

test("when a turn ends on a tool result, New session starts the new session at that result so the call keeps its answer", async (t) => {
  const { view, host } = await mountConversation(t, toolEndedTurn(), { answerFork: answeredFork });
  const [control] = answerNewSessionControls(messagesOf(view));
  assert.ok(control, "a turn that ends on a tool result still offers the control");
  await hover(onScreen(view, OPENING));
  await click(control);
  await settle();
  assert.deepEqual(forkCommands(host), [
    { type: "fork", entryId: "answer-visibility-tool-ended-entry-2", position: "at" },
  ]);
});

test("when a turn fails without any answer text, the reader finds no New session control to carry that failure away", async (t) => {
  const { view } = await mountConversation(t, failureOnlyTurn());
  const root = messagesOf(view);
  assert.equal(newSessionControls(root).length, 0, "a failed turn without an answer offers no New session control");
  assert.equal(answerCopyControls(root).length, 0, "a failed turn without an answer offers nothing to copy either");
});

test("when a turn is interrupted before it writes a sentence, the reader finds no New session control on it", async (t) => {
  const { view } = await mountConversation(t, silentAbortTurn());
  const root = messagesOf(view);
  assert.equal(
    newSessionControls(root).length,
    0,
    "an interrupted turn without a sentence offers no New session control",
  );
  assert.equal(
    answerCopyControls(root).length,
    0,
    "an interrupted turn without a sentence offers nothing to copy either",
  );
});

test("while the agent is still answering, no answer offers a New session control", async (t) => {
  const { view, host } = await mountConversation(t, twoAnsweredTurns());
  assert.equal(
    newSessionControls(messagesOf(view)).length,
    2,
    "both finished turns offer the control while the conversation rests",
  );
  await emit(host, { type: "agent_start" });
  assert.equal(newSessionControls(messagesOf(view)).length, 0, "a running conversation offers no New session control");
  await emit(host, { type: "agent_end" });
  assert.equal(newSessionControls(messagesOf(view)).length, 2, "the control returns once the run has finished");
});

test("while the request is being fulfilled, the control reports that it is creating the session and ignores further clicks", async (t) => {
  const answer = createDeferred();
  const { view, host, forked } = await mountConversation(t, twoAnsweredTurns(), { answerFork: () => answer.promise });
  const [control] = answerNewSessionControls(messagesOf(view));
  assert.ok(control, "the first answer offers a New session control");
  await hover(onScreen(view, OPENING));
  await click(control);
  await settle();
  assert.equal(nameOf(control), "Creating…", "the control says the new session is being created");
  assert.equal(control.disabled, true, "the control cannot be used again while the request runs");
  control.click();
  await settle();
  assert.equal(forkCommands(host).length, 1, "a second click during the request sends nothing more");
  answer.resolve({ cancelled: false, newSessionId: "forked-session" });
  await settle();
  assert.equal(nameOf(control), "New session", "the control returns to its usual name once the request is answered");
  assert.equal(control.disabled, false, "the control can be used again");
  assert.deepEqual(forked, ["forked-session"]);
});

test("when the host declines to start a new session, the app stays where it is", async (t) => {
  const { view, forked } = await mountConversation(t, twoAnsweredTurns(), {
    answerFork: () => Promise.resolve({ cancelled: true }),
  });
  const [control] = answerNewSessionControls(messagesOf(view));
  assert.ok(control, "the first answer offers a New session control");
  await hover(onScreen(view, OPENING));
  await click(control);
  await settle();
  assert.deepEqual(forked, [], "a declined request switches to no new session");
  assert.equal(nameOf(control), "New session", "the control returns to its usual name");
});

test("when the reader points at a later question, it offers Edit from here and keeps no New session of its own", async (t) => {
  const { view } = await mountConversation(t, twoAnsweredTurns());
  const root = messagesOf(view);
  await hover(onScreen(view, FOLLOW_UP_QUESTION));
  const editing = controlsNamed(allByRole(root, "button"), /^Edit from here/);
  assert.equal(editing.length, 1, "the later question still offers Edit from here");
  assert.equal(newSessionControls(root).length, 2, "only the two answers carry a New session control");
});

test("when the reader points at the first question of a conversation, no New session control appears on it", async (t) => {
  const { view } = await mountConversation(t, toolThenAnswerTurn("answer-new-session-first-question"));
  const root = messagesOf(view);
  await hover(onScreen(view, QUESTION));
  const controls = newSessionControls(root);
  assert.equal(controls.length, 1, "the single answer carries the only New session control");
  comesBefore(onScreen(view, QUESTION), controls[0], "the control sits after the question, not on it");
  comesBefore(onScreen(view, CONCLUSION), controls[0], "the control follows the answer");
});
