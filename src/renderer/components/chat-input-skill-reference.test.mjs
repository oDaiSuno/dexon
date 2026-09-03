import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";

// The composer is a contenteditable surface; the jsdom harness (imported
// first) provides the real DOM environment before the bundle loads.
const dom = harness.dom;

const { ChatInput } = await importTestBundle("src/renderer/components/chat-input-skill-reference", {
  stdin: {
    contents: 'export { ChatInput } from "./ChatInput.tsx";',
    resolveDir: import.meta.dirname,
    sourcefile: "chat-input-skill-reference-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
});

const editorEl = () => rootEl.querySelector(".composer-editor");
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

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

/** Serialized value of the editable surface, skill chips included. */
function serializedValue() {
  const el = editorEl();
  const parts = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === dom.window.Node.TEXT_NODE) parts.push(child.textContent);
    else if (child.hasAttribute?.("data-skill-token")) parts.push(`/skill:${child.dataset.skillName}`);
    else if (child.hasAttribute?.("data-attachment-token")) {
      parts.push(child.dataset.path.includes(" ") ? `@"${child.dataset.path}"` : `@${child.dataset.path}`);
    } else if (child.tagName === "BR") parts.push("\n");
  }
  return parts.join("");
}

const skillChip = () => rootEl.querySelector("[data-skill-token]");

after(async () => {
  await harness.restoreGlobals?.();
  restoreGlobals();
});

test("a picked skill becomes a chip at message start, serialized as /skill:name", async () => {
  const handle = await mount();
  await act(async () => {
    handle.current.insertSkill("fast-context");
    await Promise.resolve();
  });
  const chip = skillChip();
  assert.ok(chip, "the skill chip must be rendered");
  assert.equal(chip.dataset.skillName, "fast-context");
  assert.equal(serializedValue(), "/skill:fast-context ");
  // caret sits after the separator space, ready for arguments
  const sel = dom.window.getSelection();
  assert.ok(sel.isCollapsed);
  await typeText("帮我梳理架构");
  assert.equal(serializedValue(), "/skill:fast-context 帮我梳理架构");
  await unmount();
});

test("picking another skill replaces the existing leading skill chip", async () => {
  const handle = await mount();
  await act(async () => {
    handle.current.insertSkill("fast-context");
    await Promise.resolve();
  });
  await act(async () => {
    handle.current.insertSkill("groksearch");
    await Promise.resolve();
  });
  assert.equal(rootEl.querySelectorAll("[data-skill-token]").length, 1);
  assert.equal(skillChip().dataset.skillName, "groksearch");
  assert.equal(serializedValue(), "/skill:groksearch ");
  await unmount();
});

test("typing a leading /skill command materializes on the closing space", async () => {
  await mount();
  await setEditorText("/skill:fast-context ");
  assert.ok(skillChip(), "the closed command must materialize into a chip");
  assert.equal(skillChip().dataset.skillName, "fast-context");
  assert.equal(serializedValue(), "/skill:fast-context ");
  await unmount();
});

test("an open /skill query stays plain text so the slash palette keeps working", async () => {
  await mount();
  await setEditorText("/skill:fast");
  assert.equal(skillChip(), null, "no chip while the command is still open");
  assert.equal(serializedValue(), "/skill:fast");
  await unmount();
});

test("mid-message /skill text is prose, not a command chip", async () => {
  await mount();
  await setEditorText("请先读 /skill:fast-context 说明 ");
  assert.equal(skillChip(), null);
  assert.equal(serializedValue(), "请先读 /skill:fast-context 说明 ");
  await unmount();
});

test("draft-restore style setValue materializes the leading command (rebuild path)", async () => {
  const handle = await mount();
  await act(async () => {
    handle.current.insertIfEmpty("/skill:refactoring-ui 优化按钮样式");
    await Promise.resolve();
  });
  assert.ok(skillChip());
  assert.equal(skillChip().dataset.skillName, "refactoring-ui");
  assert.equal(serializedValue(), "/skill:refactoring-ui 优化按钮样式");
  await unmount();
});

test("backspace at the chip boundary removes the whole skill chip atomically", async () => {
  const handle = await mount();
  await act(async () => {
    handle.current.insertSkill("fast-context");
    await Promise.resolve();
  });
  await typeText("more");
  const el = editorEl();
  const chip = skillChip();
  const sel = dom.window.getSelection();
  const range = dom.window.document.createRange();
  range.setStart(el, Array.from(el.childNodes).indexOf(chip) + 1);
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
  assert.equal(rootEl.querySelectorAll("[data-skill-token]").length, 0);
  assert.equal(serializedValue(), "more");
  await unmount();
});

test("clicking the skill chip opens the details card and ✕ removes the chip", async () => {
  const handle = await mount();
  await act(async () => {
    handle.current.insertSkill("fast-context");
    await Promise.resolve();
  });
  const chip = skillChip();
  await act(async () => {
    chip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
  const dialog = rootEl.querySelector('[role="dialog"]');
  assert.ok(dialog, "the skill details card must open");
  assert.ok(dialog.textContent.includes("fast-context"), "the card names the skill");
  await act(async () => {
    chip
      .querySelector("[data-chip-remove]")
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  assert.equal(rootEl.querySelectorAll("[data-skill-token]").length, 0);
  assert.equal(serializedValue(), "");
  await unmount();
});

test("sending submits the serialized /skill command text", async () => {
  const sent = [];
  const handle = await mount({ sent });
  await act(async () => {
    handle.current.insertSkill("fast-context");
    await Promise.resolve();
  });
  await typeText("帮我梳理架构");
  await pressKey("Enter");
  assert.deepEqual(sent, ["/skill:fast-context 帮我梳理架构"]);
  await unmount();
});
