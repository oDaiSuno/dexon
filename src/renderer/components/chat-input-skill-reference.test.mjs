import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach, beforeEach } from "node:test";
import { createElement, createRef } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { allByRole } from "../../../tests/support/dom-events.mjs";

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
