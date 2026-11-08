import assert from "node:assert/strict";
import { File } from "node:buffer";
import test, { after } from "node:test";
import {
  act,
  click,
  dom,
  hover,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
  settle,
  waitFor,
} from "../../../tests/support/renderer.mjs";
import { useState, createElement, createRef } from "react";
import { createSessionTestHost } from "../../../tests/fixtures/session-host.mjs";
import { turnDetail, assistantReply, textBlock } from "../../../tests/fixtures/chat-answer-turn.mjs";
import { byRole } from "../../../tests/support/dom-queries.mjs";
import { installRendererApi } from "../../../tests/support/renderer-api.mjs";

const { UserMessageView, ChatWindow, ThinkingExpansionStore, resetRpc, installApiShims } = await loadRenderer(
  "user-message-edit-attachments",
  'export {UserMessageView} from "./src/renderer/components/messages/UserMessage.tsx"; export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const PNG_DATA = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const GIF_DATA = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const OLD_IMAGE = { type: "image", data: PNG_DATA, mimeType: "image/png" };

function MessageFixture({ message, onSend, ...props }) {
  const [editDraft, setEditDraft] = useState(null);
  return createElement(UserMessageView, {
    message,
    entryId: "attachment-entry",
    sessionId: "attachment-session",
    cwd: "/project",
    ...props,
    editDraft,
    editHandlers: {
      environmentId: "primary",
      start(entryId, value, images) {
        setEditDraft({ entryId, text: value, images });
      },
      change(value) {
        setEditDraft((current) => ({ ...current, text: value }));
      },
      removeImage(index) {
        setEditDraft((current) => ({ ...current, images: current.images.filter((_, i) => i !== index) }));
      },
      cancel() {
        setEditDraft(null);
      },
      send() {
        return onSend(editDraft);
      },
    },
  });
}

async function mountMessage(t, { content = "before after", onSend, bridge = {}, host = {}, ...props } = {}) {
  const sent = [];
  dom.window.piBridge = {
    getPathForFile: (file) => file.testPath ?? "",
    inspectLocalFiles: async ({ paths }) => paths.map(() => ({ exists: true, isFile: true, insideCwd: true })),
    ...bridge,
  };
  const boundary = installRendererApi(dom.window, { resetRpc, installApiShims }, () => ({
    call: async (method) =>
      method === "files.index" ? { matches: [{ path: "src/issue98.ts", isDir: false }], truncated: false } : {},
    readFile: async () => null,
    ...host,
  }));
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      boundary.close();
    }
  });
  view = await mount(t, MessageFixture, {
    message: { role: "user", content, timestamp: 1000 },
    onSend: (draft) => {
      sent.push({ text: draft.text, images: draft.images });
      return onSend?.(draft);
    },
    ...props,
  });
  await openEditor(view);
  return { view, sent };
}

async function openEditor(view) {
  await hover(byRole(view.container, "button", "Edit").parentElement);
  await click(byRole(view.container, "button", "Edit"));
  await settle();
}

function editor(view) {
  const field = byRole(view.container, "textbox", "Edit message");
  assert.ok(field, "the sent message has an editable textbox");
  return field;
}

function control(view, name) {
  const found = byRole(view.container, "button", name);
  assert.ok(found, `the edit offers ${name}`);
  return found;
}

async function caretAt(field, offset) {
  await act(async () => {
    field.focus();
    const range = dom.window.document.createRange();
    if (field.firstChild) range.setStart(field.firstChild, offset);
    else range.setStart(field, 0);
    range.collapse(true);
    const selection = dom.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
  });
}

async function typeText(field, value) {
  field.textContent = value;
  await caretAt(field, value.length);
  await act(async () => field.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true })));
}

function localFile(path) {
  const file = new File(["file contents"], path.split("/").at(-1), { type: "text/plain" });
  file.testPath = path;
  return file;
}

function clipboardImage() {
  return new File([Buffer.from(GIF_DATA, "base64")], "clipboard.gif", { type: "image/gif" });
}

async function paste(field, { files = [], value = "" } = {}) {
  const event = new dom.window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
      getData: (type) => (type === "text/plain" ? value : ""),
    },
  });
  await act(async () => field.dispatchEvent(event));
  return event;
}

function pill(field, path) {
  return [...field.querySelectorAll("[title]")].find((node) => node.title === path);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("pasting a local file into a sent message inserts a removable attachment at the caret", async (t) => {
  const { view, sent } = await mountMessage(t);
  const field = editor(view);
  await caretAt(field, 7);
  await paste(field, { files: [localFile("/tmp/issue98-caret.txt")] });
  assert.ok(pill(field, "/tmp/issue98-caret.txt"), "the pasted file is shown as an attachment pill");
  await click(control(view, "Send"));
  assert.deepEqual(sent, [{ text: "before @/tmp/issue98-caret.txt after", images: [] }]);
});

test("clipboard image staging blocks Send and an attachment alone can replace the old question", async (t) => {
  const staged = deferred();
  const requests = [];
  const { view, sent } = await mountMessage(t, {
    bridge: {
      stageClipboardImage(request) {
        requests.push(request);
        return staged.promise;
      },
    },
  });
  await paste(editor(view), { files: [clipboardImage()] });
  await waitFor(() => assert.equal(requests.length, 1, "the desktop is staging the clipboard image"));
  assert.deepEqual(requests, [{ base64: GIF_DATA, ext: "gif" }]);
  assert.equal(control(view, "Send").disabled, true, "staging must finish before sending");
  await keyDown(editor(view), "Enter");
  assert.equal(sent.length, 0, "Enter cannot send an unfinished attachment");
  await typeText(editor(view), "");
  await act(async () => staged.resolve({ ok: true, staged: { path: "/tmp/issue98-staged.gif" } }));
  await waitFor(() => assert.ok(pill(editor(view), "/tmp/issue98-staged.gif")));
  assert.equal(control(view, "Send").disabled, false, "the new attachment needs no accompanying prose");
  await click(control(view, "Send"));
  assert.deepEqual(sent, [{ text: "@/tmp/issue98-staged.gif ", images: [] }]);
});

test("removing all prose, inline attachments and historical images disables Send", async (t) => {
  const { view, sent } = await mountMessage(t, { content: [OLD_IMAGE, { type: "text", text: "old question" }] });
  await typeText(editor(view), "");
  assert.equal(control(view, "Send").disabled, false, "a historical image is still sendable");
  await paste(editor(view), { files: [localFile("/tmp/issue98-last-file.txt")] });
  assert.ok(pill(editor(view), "/tmp/issue98-last-file.txt"));
  await click(control(view, "Remove image"));
  assert.equal(control(view, "Send").disabled, false, "an inline attachment is still sendable");
  await click(byRole(pill(editor(view), "/tmp/issue98-last-file.txt"), "button", "Remove"));
  assert.equal(control(view, "Send").disabled, true, "nothing remains to send");
  await keyDown(editor(view), "Enter");
  assert.deepEqual(sent, []);
});

test("plain text paste keeps normalized line breaks", async (t) => {
  const { view, sent } = await mountMessage(t);
  await typeText(editor(view), "");
  await paste(editor(view), { value: "first\r\nsecond\rthird\n" });
  await click(control(view, "Send"));
  assert.deepEqual(sent, [{ text: "first\nsecond\nthird\n", images: [] }]);
});

test("a pending edit cannot be sent twice", async (t) => {
  const pending = deferred();
  const { view, sent } = await mountMessage(t, { onSend: () => pending.promise });
  await click(control(view, "Send"));
  assert.equal(control(view, "Send").disabled, true, "Send is disabled while the edit is being accepted");
  await keyDown(editor(view), "Enter");
  assert.equal(sent.length, 1);
  await act(async () => pending.resolve());
  assert.equal(control(view, "Send").disabled, false, "a settled send no longer blocks the editor");
});

for (const key of ["Enter", "Tab"]) {
  test(`${key} completes a file below the sent-message editor without submitting`, async (t) => {
    const requests = [];
    const { view, sent } = await mountMessage(t, {
      host: {
        call: async (method, params) => {
          if (method !== "files.index") return {};
          requests.push(params);
          return { matches: [{ path: "src/issue98.ts", isDir: false }], truncated: false };
        },
      },
    });
    await typeText(editor(view), "review @");
    await waitFor(() => assert.ok(byRole(view.container, "group", "Files · 1 match")));
    const menu = byRole(view.container, "group", "Files · 1 match");
    assert.equal(menu.style.top, "calc(100% + 8px)", "the file menu opens below the editor");
    assert.equal(menu.parentElement.style.position, "relative", "the editor anchors its own menu");
    assert.equal(requests[0].root, "/project");
    assert.equal(requests[0].query, "");
    await keyDown(editor(view), key);
    assert.ok(pill(editor(view), "src/issue98.ts"), "the chosen file becomes a pill");
    assert.equal(byRole(view.container, "group", /^Files ·/), undefined);
    assert.deepEqual(sent, [], "completion is not Send");
    await click(control(view, "Send"));
    assert.deepEqual(sent, [{ text: "review @src/issue98.ts ", images: [] }]);
  });
}

test("the first Escape dismisses file suggestions and the second discards new text and attachments", async (t) => {
  const { view, sent } = await mountMessage(t);
  await paste(editor(view), { files: [localFile("/tmp/issue98-cancel.txt")] });
  await paste(editor(view), { value: " @" });
  await waitFor(() => assert.ok(byRole(view.container, "group", "Files · 1 match")));
  await keyDown(editor(view), "Escape");
  assert.equal(byRole(view.container, "group", /^Files ·/), undefined);
  assert.ok(pill(editor(view), "/tmp/issue98-cancel.txt"), "closing the menu does not discard the edit");
  await act(async () => dom.window.document.dispatchEvent(new dom.window.Event("selectionchange")));
  assert.equal(
    byRole(view.container, "group", /^Files ·/),
    undefined,
    "caret observation does not reopen a dismissed query",
  );
  await keyDown(editor(view), "Escape");
  assert.equal(byRole(view.container, "textbox", "Edit message"), undefined);
  assert.ok(view.container.textContent.includes("before after"), "the original bubble is restored");
  assert.equal(view.container.textContent.includes("issue98-cancel.txt"), false);
  assert.deepEqual(sent, []);
});

test("composition Enter and Escape do not complete a file, send or cancel the edit", async (t) => {
  const { view, sent } = await mountMessage(t);
  await typeText(editor(view), "review @");
  await waitFor(() => assert.ok(byRole(view.container, "group", "Files · 1 match")));
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  await act(async () => editor(view).dispatchEvent(new dom.window.Event("compositionstart", { bubbles: true })));
  await keyDown(editor(view), "Enter", { isComposing: true });
  await keyDown(editor(view), "Escape", { isComposing: true });
  assert.ok(byRole(view.container, "group", "Files · 1 match"));
  assert.equal(pill(editor(view), "src/issue98.ts"), undefined);
  assert.deepEqual(sent, []);
  await act(async () => editor(view).dispatchEvent(new dom.window.Event("compositionend", { bubbles: true })));
  await keyDown(editor(view), "Enter");
  assert.equal(pill(editor(view), "src/issue98.ts"), undefined, "the composition-end Enter is not a completion");
  now += 101;
  await keyDown(editor(view), "Enter");
  assert.ok(pill(editor(view), "src/issue98.ts"));
  assert.deepEqual(sent, []);
});

test("restored queries stay closed while caret changes can reopen a newly edited query", async (t) => {
  const { view } = await mountMessage(t, { content: "review @" });
  assert.equal(byRole(view.container, "group", /^Files ·/), undefined);
  await caretAt(editor(view), 8);
  assert.equal(byRole(view.container, "group", /^Files ·/), undefined, "restoring text does not pop open a menu");
  await typeText(editor(view), "review @s note");
  assert.equal(byRole(view.container, "group", /^Files ·/), undefined);
  await caretAt(editor(view), 9);
  await waitFor(() => assert.ok(byRole(view.container, "group", "Files · 1 match")));
});

function conversation(id, value = "old question") {
  return turnDetail(id, [
    { role: "user", content: [OLD_IMAGE, textBlock(value)], timestamp: 1000 },
    assistantReply([textBlock("old answer")]),
  ]);
}

async function mountConversation(t, { id = "attachment-drop", bridge = {}, host: overrides = {} } = {}) {
  const details = new Map([[id, conversation(id)]]);
  const host = createSessionTestHost({
    getSession: async (sid) => details.get(sid),
    sendAgentCommand: async () => ({}),
    ...overrides,
  });
  dom.window.piBridge = {
    getPathForFile: (file) => file.testPath ?? "",
    inspectLocalFiles: async ({ paths }) => paths.map(() => ({ exists: true, isFile: true, insideCwd: true })),
    ...bridge,
  };
  const boundary = installRendererApi(dom.window, { resetRpc, installApiShims }, () => host);
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      boundary.close();
    }
  });
  const props = {
    session: details.get(id).info,
    newSessionCwd: null,
    chatInputRef: createRef(),
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  };
  view = await mount(t, ChatWindow, props);
  await waitFor(() => assert.ok(byRole(view.container, "button", "Edit")));
  return { view, host, details, props };
}

function bottomEditor(view) {
  return byRole(byRole(view.container, "group", "Message input"), "textbox");
}

function editCommands(host) {
  return host.sendCommands.map((request) => request.payload).filter((payload) => payload.type === "edit_message");
}

async function drop(target, files) {
  const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files, items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })) },
  });
  await act(async () => target.dispatchEvent(event));
}

test("window drops edit only the historical message, explicitly remove its old image and return to the bottom after Send", async (t) => {
  const { view, host } = await mountConversation(t);
  await typeText(bottomEditor(view), "bottom draft");
  await openEditor(view);
  await typeText(editor(view), "left right");
  await caretAt(editor(view), 5);
  await drop(byRole(view.container, "group", "Messages"), [localFile("/tmp/issue98-dropped.txt")]);
  assert.ok(pill(editor(view), "/tmp/issue98-dropped.txt"), "a window drop reaches the active editor caret");
  assert.equal(
    editor(view).textContent,
    "left issue98-dropped.txt right",
    "the drop preserves text on both sides of the caret",
  );
  assert.equal(bottomEditor(view).textContent, "bottom draft", "the bottom draft is untouched");
  await click(control(view, "Remove image"));
  await typeText(editor(view), "");
  await drop(byRole(view.container, "group", "Messages"), [localFile("/tmp/issue98-replacement.txt")]);
  await click(control(view, "Send"));
  await waitFor(() => assert.equal(editCommands(host).length, 1));
  assert.deepEqual(editCommands(host), [
    { type: "edit_message", entryId: "attachment-drop-entry-0", message: "@/tmp/issue98-replacement.txt", images: [] },
  ]);
  await waitFor(() => assert.equal(byRole(view.container, "textbox", "Edit message"), undefined));
  await caretAt(bottomEditor(view), "bottom draft".length);
  await drop(byRole(view.container, "group", "Messages"), [localFile("/tmp/issue98-after-send.txt")]);
  assert.ok(pill(bottomEditor(view), "/tmp/issue98-after-send.txt"), "Send restores bottom-composer drop routing");
  assert.ok(bottomEditor(view).textContent.startsWith("bottom draft"));
});

test("cancel restores bottom drop routing without carrying the edited attachment into the original bubble", async (t) => {
  const { view, host } = await mountConversation(t, { id: "attachment-cancel-drop" });
  await typeText(bottomEditor(view), "keep this draft");
  await openEditor(view);
  await drop(byRole(view.container, "group", "Messages"), [localFile("/tmp/issue98-discarded.txt")]);
  assert.ok(pill(editor(view), "/tmp/issue98-discarded.txt"));
  assert.equal(bottomEditor(view).textContent, "keep this draft");
  await click(control(view, "Cancel"));
  assert.equal(view.container.textContent.includes("issue98-discarded.txt"), false);
  assert.ok(view.container.textContent.includes("old question"));
  await caretAt(bottomEditor(view), "keep this draft".length);
  await drop(byRole(view.container, "group", "Messages"), [localFile("/tmp/issue98-after-cancel.txt")]);
  assert.ok(pill(bottomEditor(view), "/tmp/issue98-after-cancel.txt"));
  assert.deepEqual(editCommands(host), []);
});

for (const transition of ["cancel", "session", "unmount"]) {
  test(`late clipboard staging cannot leak after editor ${transition}`, async (t) => {
    const staged = deferred();
    let requested = false;
    const { view, host, props, details } = await mountConversation(t, {
      id: `attachment-late-${transition}`,
      bridge: {
        stageClipboardImage() {
          requested = true;
          return staged.promise;
        },
      },
    });
    await typeText(bottomEditor(view), "untouched bottom");
    await openEditor(view);
    await paste(editor(view), { files: [clipboardImage()] });
    await waitFor(() => assert.equal(requested, true));
    if (transition === "cancel") {
      await click(control(view, "Cancel"));
      await openEditor(view);
    } else if (transition === "session") {
      const next = conversation("attachment-next-session");
      details.set(next.info.id, next);
      await view.update({ ...props, session: next.info });
      await waitFor(() => assert.ok(byRole(view.container, "button", "Edit")));
      await openEditor(view);
    } else {
      await view.unmount();
    }
    await act(async () => staged.resolve({ ok: true, staged: { path: `/tmp/issue98-late-${transition}.gif` } }));
    await settle();
    assert.equal(view.container.textContent.includes(`issue98-late-${transition}.gif`), false);
    assert.deepEqual(editCommands(host), []);
    if (transition !== "unmount") {
      assert.ok(editor(view).textContent.includes("old question"));
      assert.equal(control(view, "Send").disabled, false, "the new editor does not inherit an old processing gate");
      assert.equal(pill(bottomEditor(view), `/tmp/issue98-late-${transition}.gif`), undefined);
    }
  });
}

test("replacing the historical image with a text attachment sends an explicit empty image list to Host", async (t) => {
  const { view, host } = await mountConversation(t, { id: "attachment-explicit-image-removal" });
  await openEditor(view);
  await typeText(editor(view), "");
  await paste(editor(view), { files: [localFile("/tmp/issue98-new-reference.txt")] });
  await click(control(view, "Remove image"));
  await click(control(view, "Send"));
  await waitFor(() => assert.equal(editCommands(host).length, 1));
  assert.deepEqual(editCommands(host), [
    {
      type: "edit_message",
      entryId: "attachment-explicit-image-removal-entry-0",
      message: "@/tmp/issue98-new-reference.txt",
      images: [],
    },
  ]);
});
