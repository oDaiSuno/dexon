import { harness, restoreGlobals, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { act } from "react";
import { createElement, createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";

const { ChatInput, resetDraftCache, installApiShims, resetRpc } = await importTestBundle(
  "src/renderer/components/chat-input-draft-migration",
  {
    stdin: {
      contents:
        'export { ChatInput } from "./ChatInput.tsx"; export { resetDraftCache } from "../lib/draft-store.ts"; export {installApiShims} from "../lib/api-fetch.ts"; export {resetRpc} from "../lib/api-client.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "chat-input-draft-migration-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);
harness.connectApi({ installApiShims, resetRpc });

after(() => restoreGlobals());
// Each case owns its storage and draft cache (ASTRA-R5-F001).
beforeEach(() => {
  harness.storedValues.clear();
  resetDraftCache();
});

let mounted = null;
let activeRef = null;
let currentProps = {};

function editor() {
  return rootEl.querySelector('[role="textbox"][aria-multiline="true"]');
}

function elementFor(props, ref) {
  currentProps = props;
  const input = createElement(ChatInput, {
    cwd: "/workspace/project",
    visible: props.visible ?? true,
    draftKey: props.draftKey,
    isStreaming: false,
    model: { provider: "test", modelId: "model-a" },
    modelList: [{ id: "model-a", name: "Model A", provider: "test" }],
    onAbort() {},
    onSend() {},
    ref,
  });
  return props.strictMode ? createElement(StrictMode, null, input) : input;
}

async function mount(props) {
  activeRef = createRef();
  currentProps = props;
  mounted = createRoot(rootEl);
  await act(async () => mounted.render(elementFor(props, activeRef)));
  return activeRef;
}

async function rerender(props) {
  const next = { ...currentProps, ...props };
  await act(async () => mounted.render(elementFor(next, activeRef)));
}

async function settlePromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
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

function clearDraft(key) {
  harness.storedValues.delete(`dexon-draft:${key}`);
}

function legacyDraft(key, images) {
  harness.storedValues.set(
    `dexon-draft:${key}`,
    JSON.stringify({
      schemaVersion: 2,
      value: "legacy draft",
      images,
    }),
  );
}

function image(data = "ZmFrZQ==") {
  return { data, mimeType: "image/png" };
}

test("an initial v3 draft is materialized before the first edit", async (t) => {
  t.after(async () => unmount());
  const key = "phase-8-initial-v3-draft";
  clearDraft(key);
  harness.storedValues.set(
    `dexon-draft:${key}`,
    JSON.stringify({ schemaVersion: 3, value: "saved unsent draft", updatedAt: 1 }),
  );
  try {
    await mount({ draftKey: key });
    assert.equal(editor().textContent, "saved unsent draft", "the stored draft must materialize on the initial mount");
    editor().textContent = "saved unsent draft!";
    await act(async () => editor().dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true })));
    await unmount();
    assert.equal(JSON.parse(harness.storedValues.get(`dexon-draft:${key}`)).value, "saved unsent draft!");
  } finally {
    clearDraft(key);
  }
});

test("hidden plain-text insertion preserves attachment token separation", async (t) => {
  t.after(async () => unmount());
  const key = "phase-8-hidden-text-separator";
  clearDraft(key);
  try {
    const handle = await mount({ draftKey: key, visible: false });
    await act(async () => handle.current.insertIfEmpty("explain"));
    await act(async () => handle.current.insertText("@src/main.ts "));
    assert.equal(editor().querySelector("[data-attachment-token]")?.dataset.path, "src/main.ts");
    await unmount();
    assert.equal(JSON.parse(harness.storedValues.get(`dexon-draft:${key}`)).value, "explain @src/main.ts ");
  } finally {
    clearDraft(key);
  }
});

test("StrictMode replay keeps legacy attachments restartable until migration completes", async (t) => {
  t.after(async () => unmount());
  const key = "phase-8-migration-strict-mode";
  clearDraft(key);
  legacyDraft(key, [image()]);
  const previousStage = harness.getStageClipboardImage();
  const resolvers = [];
  harness.setStageClipboardImage(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );
  try {
    await mount({ draftKey: key, strictMode: true });
    await settlePromises();
    assert.equal(resolvers.length, 2, "StrictMode replay must restart from the preserved legacy source");
    assert.equal(
      JSON.parse(harness.storedValues.get(`dexon-draft:${key}`)).schemaVersion,
      2,
      "pending migration must not be finalized as text-only v3 during cleanup",
    );
    resolvers[0]({ ok: true, staged: { path: "/tmp/stale-strict-migration.png" } });
    resolvers[1]({ ok: true, staged: { path: "/tmp/strict-migration.png" } });
    await settlePromises();
    assert.deepEqual(
      Array.from(editor().querySelectorAll("[data-attachment-token]"), (node) => node.dataset.path),
      ["/tmp/strict-migration.png"],
    );
    await unmount();
    const stored = JSON.parse(harness.storedValues.get(`dexon-draft:${key}`));
    assert.equal(stored.schemaVersion, 3);
    assert.match(stored.value, /@\/tmp\/strict-migration\.png/);
    assert.doesNotMatch(stored.value, /stale-strict-migration/);
  } finally {
    harness.setStageClipboardImage(previousStage);
    clearDraft(key);
  }
});

test("same-key edits own the draft when legacy migration resolves late", async (t) => {
  t.after(async () => unmount());
  const key = "phase-8-migration-same-key";
  clearDraft(key);
  legacyDraft(key, [image()]);
  const previousStage = harness.getStageClipboardImage();
  let resolveStage;
  harness.setStageClipboardImage(
    () =>
      new Promise((resolve) => {
        resolveStage = resolve;
      }),
  );
  try {
    const handle = await mount({ draftKey: key, visible: false });
    await settlePromises();
    await rerender({});
    assert.equal(typeof resolveStage, "function", "migration reached the deferred staging boundary");
    await act(async () => handle.current.prependText("newer draft"));
    await settlePromises();
    resolveStage({ ok: true, staged: { path: "/tmp/stale-migration.png" } });
    await settlePromises();
    assert.equal(editor().textContent, "newer draft\n\nlegacy draft");
    assert.equal(editor().querySelectorAll("[data-attachment-token]").length, 0);
    await unmount();
    const stored = JSON.parse(harness.storedValues.get(`dexon-draft:${key}`));
    assert.equal(stored.value, "newer draft\n\nlegacy draft", "unmount commits the newer same-key edit");
    assert.doesNotMatch(stored.value, /stale-migration/);
  } finally {
    harness.setStageClipboardImage(previousStage);
    clearDraft(key);
  }
});

test("unmount invalidates a pending legacy migration before it can publish", async () => {
  const key = "phase-8-migration-unmount";
  clearDraft(key);
  legacyDraft(key, [image()]);
  const previousStage = harness.getStageClipboardImage();
  let resolveStage;
  harness.setStageClipboardImage(
    () =>
      new Promise((resolve) => {
        resolveStage = resolve;
      }),
  );
  try {
    await mount({ draftKey: key });
    await settlePromises();
    assert.equal(typeof resolveStage, "function");
    await unmount();
    resolveStage({ ok: true, staged: { path: "/tmp/unmounted-migration.png" } });
    await settlePromises();
    const stored = JSON.parse(harness.storedValues.get(`dexon-draft:${key}`));
    assert.doesNotMatch(stored.value, /unmounted-migration/);
  } finally {
    harness.setStageClipboardImage(previousStage);
    clearDraft(key);
  }
});

test("a partially failed legacy migration keeps successful later files and reports no stale overwrite", async (t) => {
  t.after(async () => unmount());
  const key = "phase-8-migration-partial";
  clearDraft(key);
  legacyDraft(key, [image("ZmFpbA=="), image("c3VjY2VlZA==")]);
  const previousStage = harness.getStageClipboardImage();
  let call = 0;
  harness.setStageClipboardImage(async () => {
    call += 1;
    if (call === 1) throw new Error("first image unavailable");
    return { ok: true, staged: { path: "/tmp/second-migration.png" } };
  });
  try {
    await mount({ draftKey: key });
    await settlePromises();
    assert.equal(call, 2, "migration attempts every legacy image independently");
    assert.deepEqual(
      Array.from(editor().querySelectorAll("[data-attachment-token]"), (node) => node.dataset.path),
      ["/tmp/second-migration.png"],
    );
  } finally {
    harness.setStageClipboardImage(previousStage);
    clearDraft(key);
  }
});
