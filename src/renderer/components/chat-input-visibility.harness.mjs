import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import { act } from "react";
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { click, mouseDown } from "../../../tests/support/dom-events.mjs";

// The visibility contract is tested with the same real contenteditable harness
// as the attachment and skill journeys. The imported DOM must exist before the
// ChatInput bundle is evaluated.
const dom = harness.dom;
const { ChatInput, resetDraftCache, installApiShims, resetRpc } = await importTestBundle(
  "src/renderer/components/chat-input-visibility",
  {
    stdin: {
      contents:
        'export { ChatInput } from "./ChatInput.tsx"; export { resetDraftCache } from "../lib/draft-store.ts"; export {installApiShims} from "../lib/api-fetch.ts"; export {resetRpc} from "../lib/api-client.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "chat-input-visibility-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);
harness.connectApi({ installApiShims, resetRpc });

export const editorEl = () => rootEl.querySelector('[role="textbox"][aria-multiline="true"]');
export const modelPortal = () =>
  Array.from(dom.window.document.body.querySelectorAll(".composer-pop-in")).find((node) => !rootEl.contains(node));

let mounted = null;
let activeRef = null;
let currentProps = {};

function elementFor(props, ref) {
  currentProps = props;
  return createElement(ChatInput, {
    cwd: "/workspace/project",
    visible: props.visible ?? true,
    draftKey: props.draftKey,
    isStreaming: props.isStreaming ?? false,
    model: props.model ?? { provider: "test", modelId: "model-a" },
    modelList: props.modelList ?? [{ id: "model-a", name: "Model A", provider: "test" }],
    onModelChange() {},
    onModelsRefresh() {},
    onAbort() {},
    onSend: props.onSend ?? (() => {}),
    onFollowUp: props.onFollowUp,
    thinkingLevel: props.thinkingLevel,
    onThinkingLevelChange: props.onThinkingLevelChange,
    availableThinkingLevels: props.availableThinkingLevels,
    ref,
  });
}

export async function mount(props = {}) {
  const ref = createRef();
  currentProps = props;
  activeRef = ref;
  mounted = createRoot(rootEl);
  await act(async () => mounted.render(elementFor(props, ref)));
  return ref;
}

export async function rerender(props = {}) {
  assert.ok(mounted, "the visibility harness must be mounted");
  const next = { ...currentProps, ...props };
  await act(async () => mounted.render(elementFor(next, activeRef)));
}

export async function unmount() {
  if (!mounted) return;
  const root = mounted;
  mounted = null;
  activeRef = null;
  await act(async () => root.unmount());
  rootEl.textContent = "";
}

export async function setEditorText(text, caret = text.length) {
  const editor = editorEl();
  assert.ok(editor, "the composer editor must be mounted");
  editor.textContent = text;
  const selection = dom.window.getSelection();
  const range = dom.window.document.createRange();
  if (editor.firstChild) range.setStart(editor.firstChild, caret);
  else range.setStart(editor, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  await act(async () => editor.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true })));
}

export async function pressKey(key, options = {}) {
  await act(async () =>
    editorEl().dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    ),
  );
}

export { click, mouseDown, dom, harness, rootEl, restoreGlobals, resetDraftCache };
