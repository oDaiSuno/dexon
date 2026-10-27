import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  accessibleName,
  act,
  button,
  byRole,
  click,
  dom,
  hover,
  input,
  restoreGlobals,
  text,
} from "../support/renderer.mjs";
import { allByRole } from "../support/dom-queries.mjs";
import { openConversation } from "../support/session-reading-scene.mjs";
import { layOutConversation, scrollConversationTo } from "../support/turn-outline-scene.mjs";
import { createSessionTestHost } from "../fixtures/session-host.mjs";
import {
  CONTENT_HEIGHT,
  QUESTIONS,
  QUESTION_TOPS,
  TURN_NAMES,
  VERSION_BRANCH_NAMES,
  VIEW_HEIGHT,
  fiveQuestionHistory,
  userMessage,
  versionedQuestionHistory,
} from "../fixtures/turn-outline-history.mjs";

after(restoreGlobals);

const LIVE_QUESTION = "Where does the outline come from?";

const conversationOf = (view) => byRole(view.container, "region", /^(Conversation|对话内容)$/);
const navigatorOf = (view) => byRole(view.container, "navigation", "Conversation navigator");
const olderPageRequests = (host) =>
  host.getCommands.filter((command) => command.rpc === "getSessionContextPage").map((command) => command.args[0]);

function turnNames(view) {
  const navigator = navigatorOf(view);
  assert.ok(navigator, "the long conversation shows its turn navigator");
  return allByRole(navigator, "button").map(accessibleName);
}

async function emit(host, event) {
  await act(async () => {
    for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
  });
}

const nameOf = (element) => accessibleName(element) || element.getAttribute("title") || "";

async function editQuestion(view, question, replacement) {
  const messages = byRole(view.container, "group", "Messages");
  const bubble = text(messages, question);
  assert.ok(bubble, `“${question}” is on screen`);
  await hover(bubble);
  const edit = allByRole(messages, "button").find((node) => nameOf(node) === "Edit");
  assert.ok(edit, "pointing at the question reveals its Edit control");
  await click(edit);
  const composer = byRole(byRole(view.container, "group", "Message input"), "textbox");
  const editor = allByRole(view.container, "textbox").find((node) => node !== composer);
  assert.ok(editor, "the question turns into a textbox of its own");
  if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
    await input(editor, replacement);
  } else {
    await act(async () => {
      editor.textContent = replacement;
      editor.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
    });
  }
  const send = allByRole(view.container, "button").find(
    (node) => nameOf(node) === "Send" && !byRole(view.container, "group", "Message input").contains(node),
  );
  assert.ok(send, "the open editor offers Send");
  await click(send);
}

async function openLaidOut(t, host, detail) {
  const scene = await openConversation(t, { host, props: { session: detail.info } });
  const container = conversationOf(scene.view);
  assert.ok(container, "the loaded conversation has its scroll area");
  layOutConversation(t, container, {
    viewHeight: VIEW_HEIGHT,
    contentHeight: CONTENT_HEIGHT,
    questionTops: QUESTION_TOPS,
  });
  await scrollConversationTo(container, 0);
  return { ...scene, container };
}

test("when the conversation opens with only its newest turn loaded, the navigator lists every question in order without reading older pages", async (t) => {
  const { detail } = fiveQuestionHistory("outline-on-open");
  const host = createSessionTestHost({ getSession: async () => detail });
  const scene = await openLaidOut(t, host, detail);
  assert.deepEqual(turnNames(scene.view), TURN_NAMES);
  assert.deepEqual(olderPageRequests(host), [], "listing the questions reads no older page");
});

test("when the reader switches to another version of a question, the navigator lists exactly the new version's questions", async (t) => {
  const { detail, otherBranch } = versionedQuestionHistory("outline-on-version-switch");
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async (_sid, cursor) => {
      throw new Error(`No fixture page for cursor ${cursor}`);
    },
    sendAgentCommand: async (_sid, payload) => (payload.type === "switch_version" ? { leafId: "leaf-other" } : {}),
    getSessionContext: async (_sid, leafId) => ({ context: leafId === "leaf-other" ? otherBranch : detail.context }),
  });
  const scene = await openLaidOut(t, host, detail);
  assert.deepEqual(turnNames(scene.view), TURN_NAMES.slice(0, 3), "the open version lists its own questions");

  await click(button(scene.view.container, "Next version"));
  await scene.settle(() => assert.deepEqual(turnNames(scene.view), VERSION_BRANCH_NAMES));
  assert.equal(
    VERSION_BRANCH_NAMES.length,
    3,
    "the chosen version has three questions, only the newest of them loaded",
  );
  assert.deepEqual(olderPageRequests(host), [], "listing the chosen version's questions reads no older page");
  const names = turnNames(scene.view);
  for (const old of TURN_NAMES.slice(0, 3)) {
    assert.equal(names.includes(old), false, `“${old}” belongs to the version the reader left`);
  }
  assert.ok(
    host.getCommands.some((command) => command.rpc === "getSessionContext" && command.args[0] === "leaf-other"),
    "the navigator follows the conversation onto the version the reader chose",
  );
});

test("when a question arrives while a reply is generating, it appears at the end of the navigator right away", async (t) => {
  const { detail } = fiveQuestionHistory("outline-live-question");
  const host = createSessionTestHost({ getSession: async () => detail });
  const scene = await openLaidOut(t, host, detail);
  assert.deepEqual(turnNames(scene.view), TURN_NAMES);

  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_end", message: userMessage(LIVE_QUESTION, 21) });
  await scene.settle(() => assert.deepEqual(turnNames(scene.view), [...TURN_NAMES, `Turn 6: ${LIVE_QUESTION}`]));
  assert.deepEqual(olderPageRequests(host), [], "a newly delivered question needs no older page");
});

test("when the reader edits the newest question and sends it, the navigator lists the earlier questions followed by the new text", async (t) => {
  const { detail } = fiveQuestionHistory("outline-after-edit");
  const edited = "Summarize the bugs fixed this week";
  const host = createSessionTestHost({ getSession: async () => detail });
  const scene = await openLaidOut(t, host, detail);
  assert.deepEqual(turnNames(scene.view), TURN_NAMES);

  await editQuestion(scene.view, QUESTIONS[4], edited);
  await scene.settle(() =>
    assert.ok(
      host.sendCommands.some((command) => command.payload.type === "edit_message"),
      "the edit is sent to the host",
    ),
  );
  await scene.settle(() => assert.deepEqual(turnNames(scene.view), [...TURN_NAMES.slice(0, 4), `Turn 5: ${edited}`]));
  assert.equal(turnNames(scene.view).includes(TURN_NAMES[4]), false, "the question as it was before the edit is gone");
});
