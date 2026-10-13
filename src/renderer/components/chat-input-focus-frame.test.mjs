import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { act } from "react";
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";

// Queued focus-return frame cancellation (ASTRA-R5-G001.3): the composer
// schedules a rAF frame to return focus after the thinking menu closes on
// Escape. Hiding the page must cancel that frame so it cannot move focus or
// run hidden work. The harness rAF is synchronous by default; this suite opts
// into queue mode so the pending frame is observable and cancellable.
const dom = harness.dom;
const { ChatInput, resetDraftCache } = await importTestBundle("src/renderer/components/chat-input-focus-frame", {
  stdin: {
    contents: 'export { ChatInput } from "./ChatInput.tsx"; export { resetDraftCache } from "../lib/draft-store.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "chat-input-focus-frame-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
});

after(() => restoreGlobals());
beforeEach(() => {
  harness.resetRequests();
  harness.storedValues.clear();
  resetDraftCache();
});

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

async function mount(props = {}) {
  const ref = createRef();
  currentProps = props;
  activeRef = ref;
  mounted = createRoot(rootEl);
  await act(async () => {
    mounted.render(elementFor(props, ref));
  });
  return ref;
}

async function rerender(props = {}) {
  assert.ok(mounted, "the focus-frame harness must be mounted");
  const next = { ...currentProps, ...props };
  await act(async () => {
    mounted.render(elementFor(next, activeRef));
  });
}

async function unmount() {
  if (!mounted) return;
  const root = mounted;
  mounted = null;
  activeRef = null;
  await act(async () => root.unmount());
  rootEl.textContent = "";
}

async function click(node) {
  assert.ok(node, "the requested control must exist");
  await act(async () => node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
}

test("hiding cancels a queued focus-return frame before it can run", async (t) => {
  t.after(async () => unmount());
  harness.setRafQueue(true);
  try {
    await mount({
      thinkingLevel: "auto",
      availableThinkingLevels: ["low"],
      onThinkingLevelChange() {},
    });
    const thinkingButton = rootEl.querySelector('button[aria-label^="Change reasoning level"]');
    assert.ok(thinkingButton, "the thinking control must be mounted");
    await click(thinkingButton);
    assert.ok(rootEl.querySelector('[role="menu"][aria-label="Change reasoning level"]'));
    const escape = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => dom.window.document.dispatchEvent(escape));
    assert.equal(harness.rafSize(), 1, "Escape schedules exactly one focus-return frame");

    await rerender({ visible: false });
    assert.equal(harness.rafSize(), 0, "hiding cancels the queued focus-return frame");
    assert.notStrictEqual(
      dom.window.document.activeElement,
      thinkingButton,
      "the cancelled frame must not move focus while hidden",
    );

    await rerender({ visible: true });
    await click(thinkingButton);
    const escape2 = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => dom.window.document.dispatchEvent(escape2));
    assert.equal(harness.rafSize(), 1, "a visible page schedules the focus-return frame again");
    harness.flushRaf();
    assert.strictEqual(
      dom.window.document.activeElement,
      thinkingButton,
      "a flushed frame restores focus to the thinking control",
    );
  } finally {
    harness.setRafQueue(false);
  }
});
