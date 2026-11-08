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
import { useState, createElement } from "react";
import { byRole } from "../../../tests/support/dom-queries.mjs";
import { installApiHostBridge } from "../../../tests/support/api-host.mjs";

const { UserMessageView, resetRpc } = await loadRenderer(
  "user-message-edit-attachments",
  'export {UserMessageView} from "./src/renderer/components/messages/UserMessage.tsx";',
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
  const boundary = installApiHostBridge(
    dom.window,
    () => ({ call: async () => ({}), readFile: async () => null, ...host }),
    resetRpc,
  );
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
