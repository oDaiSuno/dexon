import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName, allByRole, byRole, text } from "../support/dom-queries.mjs";
import { act, click, dom, hover, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { OPENING, QUESTION, assistantReply, textBlock, turnDetail, userTurn } from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "message-inline-edit-saved-id",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const SESSION = "inline-edit-saved-id";
const REWRITTEN = "那第三处问题呢？";
const NEW_ANSWER = "第三处问题也修好了。";

const nameOf = (element) => accessibleName(element) || element.getAttribute("title") || "";

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

function messagesOf(view) {
  const area = byRole(view.container, "group", "Messages");
  assert.ok(area, "the conversation shows its message area");
  return area;
}

function bubbleOf(root, fragment) {
  return [...root.querySelectorAll("[data-reading-anchor]")].find((node) => node.textContent.includes(fragment));
}

function shownEditControls(root) {
  return allByRole(root, "button")
    .filter((node) => nameOf(node) === "Edit")
    .filter((node) => {
      for (let current = node; current; current = current.parentElement) {
        const style = dom.window.getComputedStyle(current);
        if (current.hidden || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return false;
        }
      }
      return true;
    });
}

function outsideComposer(view, node) {
  const group = byRole(view.container, "group", "Message input");
  assert.ok(group, "the page keeps its bottom composer");
  return !group.contains(node);
}

function dialogControl(view, pattern) {
  const matches = allByRole(view.container, "button").filter(
    (node) => pattern.test(nameOf(node)) && outsideComposer(view, node),
  );
  assert.equal(matches.length, 1, `the open editor offers exactly one ${pattern} control`);
  return matches[0];
}

function editBox(view) {
  const group = byRole(view.container, "group", "Message input");
  const composer = byRole(group, "textbox");
  const candidates = allByRole(view.container, "textbox").filter((node) => node !== composer);
  assert.equal(candidates.length, 1, "the message being edited shows exactly one textbox of its own");
  return candidates[0];
}

function editorValue(element) {
  return element.tagName === "TEXTAREA" || element.tagName === "INPUT" ? element.value : element.textContent;
}

async function setEditorText(element, value) {
  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
    element.value = value;
    await act(async () => element.dispatchEvent(new dom.window.Event("input", { bubbles: true })));
    return;
  }
  element.textContent = value;
  const selection = dom.window.getSelection();
  const range = dom.window.document.createRange();
  if (element.firstChild) range.setStart(element.firstChild, value.length);
  else range.setStart(element, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  await act(async () => element.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true })));
}

test("when the reader rewrites the first question and sends it, the bubble it was typed in answers to the saved id and can be edited again once the reply ends", async (t) => {
  let current = turnDetail(SESSION, [userTurn(), assistantReply([textBlock(OPENING)], "stop", 1004)]);
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

  const root = messagesOf(view);
  const asked = bubbleOf(root, QUESTION);
  assert.ok(asked, "the question of the conversation is on screen");
  await hover(text(root, QUESTION));
  const [edit] = shownEditControls(root);
  assert.ok(edit, "the question offers an Edit control of its own");
  await click(edit);
  await settle();
  await setEditorText(editBox(view), REWRITTEN);
  await click(dialogControl(view, /^Send$/));
  await settle();

  const sent = bubbleOf(root, REWRITTEN);
  assert.ok(sent, "the rewritten question is on screen right after sending it");

  const reloaded = turnDetail(SESSION, [
    { role: "user", content: REWRITTEN, timestamp: 2000 },
    assistantReply([textBlock(NEW_ANSWER)], "stop", 2008),
  ]);
  const [delivered, reply] = reloaded.context.messages;

  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_start", message: delivered });
  await emit(host, { type: "message_end", message: delivered });
  await emit(host, { type: "message_saved", entryId: `${SESSION}-entry-0` });
  assert.ok(bubbleOf(root, REWRITTEN) === sent && sent.isConnected, "the saved id does not rebuild the question");
  assert.equal(
    sent.getAttribute("data-reading-anchor"),
    `entry:${SESSION}-entry-0:message`,
    "the question answers to the id the session saved it under",
  );

  await emit(host, { type: "message_start", message: reply });
  await emit(host, { type: "message_end", message: reply });
  await emit(host, { type: "message_saved", entryId: `${SESSION}-entry-1` });
  current = reloaded;
  await emit(host, { type: "agent_end" });

  assert.ok(
    bubbleOf(root, REWRITTEN) === sent && sent.isConnected,
    "reading the reply again does not rebuild the question",
  );
  assert.equal(
    sent.getAttribute("data-reading-anchor"),
    `entry:${SESSION}-entry-0:message`,
    "the reloaded conversation still knows the question by its saved id",
  );

  await hover(text(root, REWRITTEN));
  const [again] = shownEditControls(root);
  assert.ok(again, "the question can be edited again once the reply has ended");
  await click(again);
  await settle();
  assert.equal(editorValue(editBox(view)), REWRITTEN, "the editor opens with the text the reader sent");
});
