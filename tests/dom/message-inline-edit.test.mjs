import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName, allByRole, byRole } from "../support/dom-queries.mjs";
import {
  act,
  click,
  dom,
  hover,
  input,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
  text,
  waitFor,
} from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  FOLLOW_UP_QUESTION,
  OPENING,
  QUESTION,
  SECOND_ANSWER,
  assistantReply,
  followUpUserTurn,
  textBlock,
  turnDetail,
  userTurn,
} from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "message-inline-edit",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const PNG_DATA = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const nameOf = (element) => accessibleName(element) || element.getAttribute("title") || "";

function messagesOf(view) {
  const area = byRole(view.container, "group", "Messages");
  assert.ok(area, "the conversation shows its message area");
  return area;
}

function onScreen(container, value) {
  const node = text(container, value);
  assert.ok(node, `“${value}” is readable as ordinary message text`);
  return node;
}

function nodeShowing(container, fragment) {
  const candidates = [...container.querySelectorAll("*")].filter((element) => element.textContent.includes(fragment));
  assert.ok(candidates.length > 0, `“${fragment}” is readable in the conversation`);
  return candidates[candidates.length - 1];
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

function showsText(container, fragment) {
  return [...container.querySelectorAll("*")].some((element) => element.textContent.includes(fragment));
}

function composerGroup(view) {
  const group = byRole(view.container, "group", "Message input");
  assert.ok(group, "the page keeps its bottom composer");
  return group;
}

function composerEditor(view) {
  const editor = byRole(composerGroup(view), "textbox");
  assert.ok(editor, "the bottom composer offers a textbox");
  return editor;
}

function isPlainField(element) {
  return element.tagName === "TEXTAREA" || element.tagName === "INPUT";
}

function editorValue(element) {
  return isPlainField(element) ? element.value : element.textContent;
}

async function setEditorText(element, value) {
  if (isPlainField(element)) {
    await input(element, value);
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

function editControls(container) {
  return allByRole(container, "button").filter((node) => nameOf(node) === "Edit");
}

function shownEditControls(container) {
  return editControls(container).filter(isShown);
}

function outsideComposer(view, node) {
  return !composerGroup(view).contains(node);
}

function dialogControls(view, pattern) {
  return allByRole(view.container, "button").filter(
    (node) => pattern.test(nameOf(node)) && outsideComposer(view, node),
  );
}

function dialogControl(view, pattern) {
  const matches = dialogControls(view, pattern);
  assert.equal(matches.length, 1, `the open editor offers exactly one ${pattern} control`);
  return matches[0];
}

function editBox(view) {
  const composer = composerEditor(view);
  const candidates = allByRole(view.container, "textbox").filter((node) => node !== composer);
  assert.equal(candidates.length, 1, "the message being edited shows exactly one textbox of its own");
  return candidates[0];
}

function versionControls(container, name) {
  return allByRole(container, "button").filter((node) => nameOf(node) === name);
}

function arrow(container, name) {
  const matches = versionControls(container, name);
  assert.equal(matches.length, 1, `the edited question offers one ${name} control`);
  return matches[0];
}

async function openEditor(view, anchor) {
  const root = messagesOf(view);
  await hover(anchor);
  const [edit] = shownEditControls(root);
  assert.ok(edit, "pointing at a question reveals an Edit control of its own");
  await click(edit);
  await settle();
}

function imagesWith(container, data) {
  return [...container.querySelectorAll("img")].filter((node) => node.getAttribute("src")?.includes(data));
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

async function mountConversation(t, detail, overrides = {}) {
  const host = createSessionTestHost({
    getSession: async () => detail,
    sendAgentCommand: async () => ({}),
    ...overrides,
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
  return { view, host };
}

function commandsOf(host, type) {
  return host.sendCommands.map((command) => command.payload).filter((payload) => payload?.type === type);
}

const TWO_TURNS = "inline-edit-two-turns";

function twoTurnDetail(id = TWO_TURNS, options = {}) {
  const messages = [
    userTurn(),
    assistantReply([textBlock(OPENING)], "stop", 1004),
    { ...followUpUserTurn(), ...(options.secondVersions ? { versions: options.secondVersions } : {}) },
    assistantReply([textBlock(SECOND_ANSWER)], "stop", 1008),
  ];
  return turnDetail(id, messages);
}

function twoVersionsOfTheSecondQuestion(id = TWO_TURNS) {
  return { entryIds: [`${id}-older-version`, `${id}-entry-2`], index: 1 };
}

const OLDER_QUESTION = "那第一处问题呢？";
const OLDER_ANSWER = "第一处问题也修好了。";

function olderVersionDetail(id = TWO_TURNS) {
  const messages = [
    userTurn(),
    assistantReply([textBlock(OPENING)], "stop", 1004),
    {
      role: "user",
      content: OLDER_QUESTION,
      timestamp: 1005,
      versions: { entryIds: [`${id}-older-version`, `${id}-entry-2`], index: 0 },
    },
    assistantReply([textBlock(OLDER_ANSWER)], "stop", 1008),
  ];
  return turnDetail(id, messages);
}

const switchingToOlderVersion = (leafId) => async (_sid, payload) =>
  payload.type === "switch_version" ? { cancelled: false, leafId, leftVersionChangedFiles: false } : {};

test("when the reader clicks Edit on a later question, its bubble turns into a textbox holding the original text", async (t) => {
  const { view } = await mountConversation(t, twoTurnDetail());
  await openEditor(view, onScreen(messagesOf(view), FOLLOW_UP_QUESTION));
  const editor = editBox(view);
  assert.equal(nameOf(editor), "Edit message", "the textbox says which message it edits");
  assert.equal(editorValue(editor), FOLLOW_UP_QUESTION, "the textbox holds the question as it was sent");
  dialogControl(view, /^Cancel$/);
  dialogControl(view, /^Send$/);
  assert.equal(editorValue(composerEditor(view)).trim(), "", "the bottom composer is left untouched and empty");
});

test("when the reader cancels the edit, the question returns unchanged and nothing is sent", async (t) => {
  const { view, host } = await mountConversation(t, twoTurnDetail());
  const root = messagesOf(view);
  await openEditor(view, onScreen(root, FOLLOW_UP_QUESTION));
  await setEditorText(editBox(view), "a draft that must not be sent");
  await click(dialogControl(view, /^Cancel$/));
  await settle();
  assert.ok(text(root, FOLLOW_UP_QUESTION), "the question is readable again exactly as it was sent");
  assert.deepEqual(
    commandsOf(host, "edit_message").concat(commandsOf(host, "switch_version"), commandsOf(host, "navigate_tree")),
    [],
    "cancelling sends no command at all",
  );
  assert.equal(editorValue(composerEditor(view)).trim(), "", "cancelling leaves the bottom composer empty");
});

test("when the reader presses Escape in the editor, the question returns unchanged and nothing is sent", async (t) => {
  const { view, host } = await mountConversation(t, twoTurnDetail());
  const root = messagesOf(view);
  await openEditor(view, onScreen(root, FOLLOW_UP_QUESTION));
  await setEditorText(editBox(view), "a draft that must not be sent");
  await keyDown(editBox(view), "Escape");
  await settle();
  assert.ok(text(root, FOLLOW_UP_QUESTION), "the question is readable again after Escape");
  assert.deepEqual(commandsOf(host, "edit_message"), [], "Escape sends no edit");
  assert.equal(editorValue(composerEditor(view)).trim(), "", "Escape leaves the bottom composer empty");
});

test("when the reader changes the text and sends it, an edit_message command carries the question and the new text is shown", async (t) => {
  const { view, host } = await mountConversation(t, twoTurnDetail());
  const root = messagesOf(view);
  const edited = "那第三处问题呢？";
  await openEditor(view, onScreen(root, FOLLOW_UP_QUESTION));
  await setEditorText(editBox(view), edited);
  await click(dialogControl(view, /^Send$/));
  await settle();
  assert.deepEqual(commandsOf(host, "edit_message"), [
    { type: "edit_message", entryId: `${TWO_TURNS}-entry-2`, message: edited },
  ]);
  assert.ok(text(root, edited), "the edited question is shown in place of the old one");
  assert.equal(text(root, FOLLOW_UP_QUESTION), undefined, "the question as it was sent is gone from the screen");
  assert.equal(text(root, SECOND_ANSWER), undefined, "the answer written for the old text is gone too");
  assert.ok(text(root, OPENING), "the answer of the earlier question stays on screen");
});

test("when the reader presses Enter in the editor, the edited question is sent as if Send was clicked", async (t) => {
  const { view, host } = await mountConversation(t, twoTurnDetail());
  const root = messagesOf(view);
  const edited = "那第四处问题呢？";
  await openEditor(view, onScreen(root, FOLLOW_UP_QUESTION));
  await setEditorText(editBox(view), edited);
  await keyDown(editBox(view), "Enter");
  await settle();
  assert.deepEqual(commandsOf(host, "edit_message"), [
    { type: "edit_message", entryId: `${TWO_TURNS}-entry-2`, message: edited },
  ]);
  assert.ok(text(root, edited), "the edited question is shown in place of the old one");
});

test("when the reader empties the editor, Send cannot be used", async (t) => {
  const { view } = await mountConversation(t, twoTurnDetail());
  const root = messagesOf(view);
  await openEditor(view, onScreen(root, FOLLOW_UP_QUESTION));
  const send = dialogControl(view, /^Send$/);
  assert.equal(send.disabled, false, "Send is available while the editor still holds the question");
  for (const empty of ["", "   "]) {
    await setEditorText(editBox(view), empty);
    await settle();
    assert.equal(send.disabled, true, `Send is unavailable for the empty text “${empty}”`);
  }
});

test("when the reader points at the first question of a conversation, it also offers Edit", async (t) => {
  const { view } = await mountConversation(t, twoTurnDetail());
  const root = messagesOf(view);
  await openEditor(view, onScreen(root, QUESTION));
  assert.equal(editorValue(editBox(view)), QUESTION, "the first question opens with its own text");
});

test("when a question has two versions, it reports its position with arrows that stop at the ends", async (t) => {
  const { view } = await mountConversation(
    t,
    twoTurnDetail(TWO_TURNS, {
      secondVersions: twoVersionsOfTheSecondQuestion(),
    }),
  );
  const root = messagesOf(view);
  assert.ok(text(root, "2 / 2"), "the edited question reports itself as the second of two versions");
  const previous = arrow(root, "Previous version");
  const next = arrow(root, "Next version");
  assert.equal(previous.disabled, false, "the second version can go back");
  assert.equal(next.disabled, true, "the second version is the last one");
  assert.equal(isShown(previous), true, "the arrows stay visible without pointing at the question");
});

test("when a question has no versions, no version control appears anywhere", async (t) => {
  const { view } = await mountConversation(t, twoTurnDetail());
  const root = messagesOf(view);
  assert.equal(
    versionControls(root, "Previous version").length + versionControls(root, "Next version").length,
    0,
    "an unedited conversation shows no version controls at all",
  );
  assert.equal(showsText(root, " / "), false, "an unedited conversation shows no version count");
});

test("when the reader asks for the previous version, the conversation shown is the one the host returns", async (t) => {
  const { view, host } = await mountConversation(
    t,
    twoTurnDetail(TWO_TURNS, { secondVersions: twoVersionsOfTheSecondQuestion() }),
    {
      getSessionContext: async () => ({ context: olderVersionDetail().context }),
      sendAgentCommand: switchingToOlderVersion("older-version-leaf"),
    },
  );
  const root = messagesOf(view);
  await click(arrow(root, "Previous version"));
  await settle();
  assert.deepEqual(commandsOf(host, "switch_version"), [
    { type: "switch_version", entryId: `${TWO_TURNS}-older-version` },
  ]);
  assert.ok(text(root, OLDER_QUESTION), "the question of the chosen version is shown");
  assert.ok(text(root, OLDER_ANSWER), "the answer of the chosen version is shown");
  assert.equal(text(root, FOLLOW_UP_QUESTION), undefined, "the question of the version that was left is gone");
  assert.ok(text(root, "1 / 2"), "the chosen version reports itself as the first of two");
  assert.equal(arrow(root, "Previous version").disabled, true, "the first version cannot go back any further");
  assert.equal(arrow(root, "Next version").disabled, false, "the first version can go forward");
});

test("when the version that was left changed files, the reader is told those file changes remain", async (t) => {
  const { view } = await mountConversation(
    t,
    twoTurnDetail(TWO_TURNS, { secondVersions: twoVersionsOfTheSecondQuestion() }),
    {
      getSessionContext: async () => ({ context: olderVersionDetail().context }),
      sendAgentCommand: async (_sid, payload) =>
        payload.type === "switch_version"
          ? { cancelled: false, leafId: "older-version-leaf", leftVersionChangedFiles: true }
          : {},
    },
  );
  const root = messagesOf(view);
  await click(arrow(root, "Previous version"));
  await settle();
  assert.ok(
    showsText(view.container, "File changes made by the previous version were not undone"),
    "the reader is told that switching versions does not undo the files the other version changed",
  );
});

test("when the version that was left changed no files, no file-change notice appears", async (t) => {
  const { view } = await mountConversation(
    t,
    twoTurnDetail(TWO_TURNS, { secondVersions: twoVersionsOfTheSecondQuestion() }),
    {
      getSessionContext: async () => ({ context: olderVersionDetail().context }),
      sendAgentCommand: switchingToOlderVersion("older-version-leaf"),
    },
  );
  const root = messagesOf(view);
  await click(arrow(root, "Previous version"));
  await settle();
  assert.ok(text(root, OLDER_QUESTION), "the switch itself happened");
  assert.equal(
    showsText(view.container, "File changes made by the previous version were not undone"),
    false,
    "nothing is said about file changes when the version that was left changed none",
  );
});

test("while a reply is being written, the version arrows are disabled and no Edit control is offered", async (t) => {
  const { view, host } = await mountConversation(
    t,
    twoTurnDetail(TWO_TURNS, { secondVersions: twoVersionsOfTheSecondQuestion() }),
  );
  const root = messagesOf(view);
  assert.equal(arrow(root, "Previous version").disabled, false, "the arrows work while the conversation rests");
  await emit(host, { type: "agent_start" });
  assert.equal(
    arrow(root, "Previous version").disabled,
    true,
    "the arrows are disabled while a reply is being written",
  );
  await hover(onScreen(root, FOLLOW_UP_QUESTION));
  assert.equal(shownEditControls(root).length, 0, "no Edit control is offered while a reply is being written");
  await emit(host, { type: "agent_end" });
  assert.equal(arrow(root, "Previous version").disabled, false, "the arrows work again once the reply is finished");
  await hover(onScreen(root, FOLLOW_UP_QUESTION));
  assert.equal(shownEditControls(root).length, 1, "the Edit control comes back once the reply is finished");
});

const SKILL_MESSAGE =
  '<skill name="groksearch" location="/fixtures/skills/groksearch/SKILL.md">\nSearch the web for recent news.\n</skill>\n\ntell me the news';

function skillDetail(id = "inline-edit-skill") {
  return turnDetail(id, [
    { role: "user", content: SKILL_MESSAGE, timestamp: 1000 },
    assistantReply([textBlock(OPENING)], "stop", 1004),
  ]);
}

test("when the stored question starts with a skill, the editor shows the skill and Send sends the skill command", async (t) => {
  const { view, host } = await mountConversation(t, skillDetail());
  const root = messagesOf(view);
  await openEditor(view, nodeShowing(root, "tell me the news"));
  const editor = editBox(view);
  assert.equal(showsText(editor, "groksearch"), true, "the editor shows the skill by name");
  assert.equal(
    editorValue(editor).includes("<skill"),
    false,
    "the editor shows the skill as a chip instead of the expanded block",
  );
  assert.equal(editorValue(editor).includes("tell me the news"), true, "the text after the skill stays editable");
  await click(dialogControl(view, /^Send$/));
  await settle();
  const [command] = commandsOf(host, "edit_message");
  assert.ok(command, "sending the edited question emits an edit_message command");
  assert.ok(
    command.message.startsWith("/skill:groksearch "),
    `the sent text starts with the skill command, but was “${command.message}”`,
  );
});

test("when the edited question had an image, the editor shows it and Send keeps it", async (t) => {
  const id = "inline-edit-image-kept";
  const detail = turnDetail(id, [
    {
      role: "user",
      content: [
        { type: "image", data: PNG_DATA, mimeType: "image/png" },
        { type: "text", text: "what is in the picture" },
      ],
      timestamp: 1000,
    },
    assistantReply([textBlock(OPENING)], "stop", 1004),
  ]);
  const { view, host } = await mountConversation(t, detail);
  const root = messagesOf(view);
  await openEditor(view, nodeShowing(root, "what is in the picture"));
  assert.equal(imagesWith(root, PNG_DATA).length, 1, "the image of the question is shown while editing it");
  dialogControl(view, /^Remove image$/);
  await click(dialogControl(view, /^Send$/));
  await settle();
  const [command] = commandsOf(host, "edit_message");
  assert.ok(command, "sending the edited question emits an edit_message command");
  assert.deepEqual(command.images, [{ type: "image", data: PNG_DATA, mimeType: "image/png" }]);
  assert.equal(command.message, "what is in the picture", "the text beside the image is sent with it");
});

test("when the reader removes the image from the editor, the sent question carries no image", async (t) => {
  const id = "inline-edit-image-removed";
  const detail = turnDetail(id, [
    {
      role: "user",
      content: [
        { type: "image", data: PNG_DATA, mimeType: "image/png" },
        { type: "text", text: "what is in the picture" },
      ],
      timestamp: 1000,
    },
    assistantReply([textBlock(OPENING)], "stop", 1004),
  ]);
  const { view, host } = await mountConversation(t, detail);
  const root = messagesOf(view);
  await openEditor(view, nodeShowing(root, "what is in the picture"));
  await click(dialogControl(view, /^Remove image$/));
  await settle();
  assert.equal(imagesWith(root, PNG_DATA).length, 0, "the removed image is no longer shown in the editor");
  assert.equal(dialogControls(view, /^Remove image$/).length, 0, "there is no image left to remove");
  await click(dialogControl(view, /^Send$/));
  await settle();
  const [command] = commandsOf(host, "edit_message");
  assert.ok(command, "sending the edited question emits an edit_message command");
  assert.deepEqual(command.images ?? [], [], "the removed image is not sent back with the question");
});

test("when a question arrived from Telegram, it offers no Edit control", async (t) => {
  const id = "inline-edit-channel";
  const detail = turnDetail(id, [
    userTurn(),
    assistantReply([textBlock(OPENING)], "stop", 1004),
    { ...followUpUserTurn(), timestamp: 1005, channelSource: "telegram" },
    assistantReply([textBlock(SECOND_ANSWER)], "stop", 1008),
  ]);
  const { view } = await mountConversation(t, detail);
  const root = messagesOf(view);
  await hover(onScreen(root, QUESTION));
  assert.equal(shownEditControls(root).length, 1, "a question typed in the app still offers Edit");
  await hover(onScreen(root, FOLLOW_UP_QUESTION));
  assert.equal(
    shownEditControls(root).length,
    1,
    "a question that arrived from Telegram adds no Edit control of its own",
  );
});

test("when sending the edit fails, the editor stays open with the reader's text and the conversation is unchanged", async (t) => {
  const { view } = await mountConversation(t, twoTurnDetail(), {
    sendAgentCommand: async (_sid, payload) => {
      if (payload.type === "edit_message") throw new Error("The host refused the edit");
      return {};
    },
  });
  const root = messagesOf(view);
  const edited = "那第五处问题呢？";
  await openEditor(view, onScreen(root, FOLLOW_UP_QUESTION));
  await setEditorText(editBox(view), edited);
  await click(dialogControl(view, /^Send$/));
  await settle();
  assert.equal(editorValue(editBox(view)), edited, "the editor stays open and keeps the text the reader typed");
  assert.ok(text(root, SECOND_ANSWER), "the answer of that question is still on screen");
  assert.equal(
    showsText(view.container, "The host refused the edit"),
    true,
    "the reader is told why the edit did not go through",
  );
  await click(dialogControl(view, /^Cancel$/));
  await settle();
  assert.ok(text(root, FOLLOW_UP_QUESTION), "the question is back exactly as it was sent");
  assert.equal(showsText(root, edited), false, "the text that failed to send is not left on screen");
});

test("when a question's image is not loaded yet, Edit appears only after the image arrives", async (t) => {
  const id = "inline-edit-deferred-image";
  const detail = turnDetail(id, [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64" },
          deferredContent: { entryId: `${id}-entry-0`, blockIndex: 0, originalBytes: 900_000 },
        },
        { type: "text", text: "what is in the picture" },
      ],
      timestamp: 1000,
    },
    assistantReply([textBlock(OPENING)], "stop", 1004),
  ]);
  let releaseImage;
  const { view } = await mountConversation(t, detail, {
    getSessionEntryContent: () =>
      new Promise((resolve) => {
        releaseImage = () => resolve({ content: { type: "image", data: PNG_DATA, mimeType: "image/png" } });
      }),
  });
  const root = messagesOf(view);
  await settle();
  assert.ok(releaseImage, "the bubble asked for the missing image on its own");
  await hover(onScreen(root, "what is in the picture"));
  assert.equal(editControls(root).length, 0, "a question whose image is still missing offers no Edit control");
  await act(async () => releaseImage());
  await settle();
  await waitFor(() => assert.equal(shownEditControls(root).length, 1, "Edit appears once the image has arrived"));
  assert.equal(imagesWith(root, PNG_DATA).length, 1, "the loaded image is shown in the bubble");
});

test("when the reader is composing a character with an input method, Enter does not send the edit", async (t) => {
  const { view, host } = await mountConversation(t, twoTurnDetail());
  const root = messagesOf(view);
  const edited = "那第六处问题呢？";
  await openEditor(view, onScreen(root, FOLLOW_UP_QUESTION));
  await setEditorText(editBox(view), edited);
  const editor = editBox(view);
  await act(async () => editor.dispatchEvent(new dom.window.Event("compositionstart", { bubbles: true })));
  await keyDown(editBox(view), "Enter");
  await settle();
  assert.equal(commandsOf(host, "edit_message").length, 0, "Enter that confirms a composition sends nothing");
  await keyDown(editBox(view), "Escape");
  await settle();
  assert.equal(editorValue(editBox(view)), edited, "Escape that dismisses a composition keeps the editor open");
  await act(async () => editBox(view).dispatchEvent(new dom.window.Event("compositionend", { bubbles: true })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
  await keyDown(editBox(view), "Enter");
  await settle();
  assert.deepEqual(commandsOf(host, "edit_message"), [
    { type: "edit_message", entryId: `${TWO_TURNS}-entry-2`, message: edited },
  ]);
});

test("when the reader empties the text but keeps the image, Send sends the edit with only that image", async (t) => {
  const id = "inline-edit-image-only";
  const detail = turnDetail(id, [
    {
      role: "user",
      content: [
        { type: "image", data: PNG_DATA, mimeType: "image/png" },
        { type: "text", text: "what is in the picture" },
      ],
      timestamp: 1000,
    },
    assistantReply([textBlock(OPENING)], "stop", 1004),
  ]);
  const { view, host } = await mountConversation(t, detail);
  const root = messagesOf(view);
  await openEditor(view, nodeShowing(root, "what is in the picture"));
  await setEditorText(editBox(view), "");
  await settle();
  const send = dialogControl(view, /^Send$/);
  assert.equal(send.disabled, false, "Send stays available while an image is kept");
  await click(send);
  await settle();
  assert.deepEqual(commandsOf(host, "edit_message"), [
    {
      type: "edit_message",
      entryId: `${id}-entry-0`,
      message: "",
      images: [{ type: "image", data: PNG_DATA, mimeType: "image/png" }],
    },
  ]);
});
