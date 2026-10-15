import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach, beforeEach } from "node:test";
import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { allByRole, button, click, getByRole, mouseDown, text, waitFor } from "../../../tests/support/dom-events.mjs";

// The composer is a contenteditable surface; the jsdom harness (imported
// first) provides the real DOM environment before the bundle loads.
const dom = harness.dom;

const { ChatInput, resetDraftCache, installApiShims, resetRpc } = await importTestBundle(
  "src/renderer/components/chat-input-skill-reference",
  {
    stdin: {
      contents:
        'export { ChatInput } from "./ChatInput.tsx"; export { resetDraftCache } from "../lib/draft-store.ts"; export {installApiShims} from "../lib/api-fetch.ts"; export {resetRpc} from "../lib/api-client.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "chat-input-skill-reference-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);
harness.connectApi(
  { installApiShims, resetRpc },
  {
    skills: ["fast-context", "groksearch"].map((name) => ({
      name,
      description: "Installed skill",
      filePath: `/skills/${name}/SKILL.md`,
      baseDir: `/skills/${name}`,
      disableModelInvocation: false,
      sourceInfo: { scope: "user" },
    })),
  },
);

const editorEl = () => rootEl.querySelector('[role="textbox"][aria-multiline="true"]');

let mounted = null;

async function mount(props = {}) {
  const handle = createRef();
  const element = createElement(ChatInput, {
    cwd: props.cwd === undefined ? "/workspace/project" : props.cwd,
    isStreaming: false,
    onAbort() {},
    onSend(message) {
      (props.sent ?? []).push(message);
    },
    ref: handle,
  });
  await act(async () => {
    mounted = createRoot(rootEl);
    mounted.render(element);
  });
  return handle;
}

async function unmount() {
  if (!mounted) return;
  const root = mounted;
  mounted = null;
  await act(async () => {
    root.unmount();
  });
  rootEl.textContent = "";
}

/** Put plain text into the editor with the caret at `caret` (default: end). */
async function setEditorText(text, caret = text.length) {
  const el = editorEl();
  el.textContent = text;
  const sel = dom.window.getSelection();
  const range = dom.window.document.createRange();
  if (el.firstChild) range.setStart(el.firstChild, caret);
  else range.setStart(el, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  await act(async () => {
    el.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

async function typeText(text) {
  const el = editorEl();
  const sel = dom.window.getSelection();
  const range = sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
  assert.ok(range && range.collapsed, "typeText needs a collapsed caret inside the editor");
  const node = dom.window.document.createTextNode(text);
  range.insertNode(node);
  range.setStart(node, text.length);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  await act(async () => {
    el.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

async function pressKey(key, options = {}) {
  await act(async () => {
    editorEl().dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    );
  });
}

/** Pick through the same menu a user opens; only the Host's skill list is a fixture. */
async function pickSkill(name) {
  await click(button(rootEl, "Add images or local file references"));
  await mouseDown(getByRole(rootEl, "menuitem", /^Use a skill/));
  const item = await waitFor(() => {
    const menu = getByRole(rootEl, "menu", "Use a skill");
    const row = allByRole(menu, "menuitem").find((candidate) => text(candidate, name));
    assert.ok(row, `the skill picker lists ${name}`);
    return row;
  });
  await mouseDown(item);
}

// An interrupted case must not leave its mounted root alive past the shared
// environment restore (ASTRA-R10-F001).
afterEach(() => unmount());
after(restoreGlobals);
// Each case owns its request history, storage and draft cache (ASTRA-R5-F001).
beforeEach(() => {
  harness.resetRequests();
  harness.storedValues.clear();
  resetDraftCache();
});

test("a picked skill is displayed at message start and sent with the typed arguments", async () => {
  const sent = [];
  await mount({ sent });
  await pickSkill("fast-context");
  assert.ok(getByRole(editorEl(), "button", "fast-context"));
  assert.deepEqual(sent, [], "picking a skill must not submit the prompt");
  // The caret must be ready for arguments after the selected skill.
  const sel = dom.window.getSelection();
  assert.ok(sel.isCollapsed);
  await typeText("帮我梳理架构");
  assert.match(editorEl().textContent, /帮我梳理架构$/);

  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["/skill:fast-context 帮我梳理架构"]);
  assert.equal(editorEl().textContent, "");
  await unmount();
});

test("picking another skill sends only the replacement command and message text", async () => {
  const sent = [];
  await mount({ sent });
  await pickSkill("fast-context");
  assert.ok(getByRole(editorEl(), "button", "fast-context"));
  await pickSkill("groksearch");
  assert.equal(allByRole(editorEl(), "button", "Remove skill").length, 1);
  assert.equal(button(editorEl(), "fast-context"), undefined);
  assert.ok(getByRole(editorEl(), "button", "groksearch"));

  await typeText("查找参考资料");
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["/skill:groksearch 查找参考资料"]);
  await unmount();
});

test("a leading /skill command followed by a space displays a chip and sends with later text", async () => {
  const sent = [];
  await mount({ sent });
  await setEditorText("/skill:fast-context ");
  assert.ok(getByRole(editorEl(), "button", "fast-context"));

  await typeText("帮我梳理架构");
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["/skill:fast-context 帮我梳理架构"]);
  await unmount();
});

test("an open /skill query stays plain text so the slash palette keeps working", async () => {
  await mount();
  await setEditorText("/skill:fast");
  assert.equal(allByRole(editorEl(), "button", "Remove skill").length, 0, "the command is still open");
  assert.equal(editorEl().textContent, "/skill:fast");
  await unmount();
});

test("mid-message /skill text is prose, not a command chip", async () => {
  await mount();
  await setEditorText("请先读 /skill:fast-context 说明 ");
  assert.equal(allByRole(editorEl(), "button", "Remove skill").length, 0);
  assert.equal(editorEl().textContent, "请先读 /skill:fast-context 说明 ");
  await unmount();
});

test("an inserted leading skill command keeps its original text and later edits when sent", async () => {
  const sent = [];
  const handle = await mount({ sent });
  await act(async () => {
    handle.current.insertIfEmpty("/skill:refactoring-ui 优化按钮样式");
    await Promise.resolve();
  });
  assert.ok(getByRole(editorEl(), "button", "refactoring-ui"));

  await typeText("，突出重点");
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["/skill:refactoring-ui 优化按钮样式，突出重点"]);
  await unmount();
});

test("backspace removes the skill chip and sends only the remaining text", async () => {
  const sent = [];
  await mount({ sent });
  await pickSkill("fast-context");
  await typeText("more");
  const el = editorEl();
  const chip = getByRole(el, "button", "fast-context");
  const sel = dom.window.getSelection();
  const range = dom.window.document.createRange();
  range.setStartAfter(chip);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  const prevented = await act(async () =>
    el.dispatchEvent(
      new dom.window.InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
      }),
    ),
  );
  assert.equal(prevented, false, "the atomic delete must be prevented at the DOM level");
  assert.equal(button(el, "fast-context"), undefined);
  assert.equal(el.textContent, "more");

  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["more"]);
  await unmount();
});

test("a skill chip opens its details and removing it excludes the command from the next send", async () => {
  const sent = [];
  await mount({ sent });
  await pickSkill("fast-context");
  const chip = getByRole(editorEl(), "button", "fast-context");
  await click(chip);
  const dialog = await waitFor(() => getByRole(rootEl, "dialog", "Skill details"));
  assert.ok(dialog.textContent.includes("fast-context"), "the card names the skill");
  await click(button(chip, "Remove skill"));
  assert.equal(button(editorEl(), "fast-context"), undefined);
  assert.equal(editorEl().textContent, "");

  await typeText("只发送这句话");
  await click(button(rootEl, "Send"));
  assert.deepEqual(sent, ["只发送这句话"]);
  await unmount();
});

test("pressing Enter sends the selected skill command and message text", async () => {
  const sent = [];
  await mount({ sent });
  await pickSkill("fast-context");
  await typeText("帮我梳理架构");
  await pressKey("Enter");
  assert.deepEqual(sent, ["/skill:fast-context 帮我梳理架构"]);
  await unmount();
});
