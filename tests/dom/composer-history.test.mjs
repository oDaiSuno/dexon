import { act, dom, loadRenderer, mount, restoreGlobals, settle } from "../support/renderer.mjs";
import { allByRole, click, getByRole, keyDown } from "../support/dom-events.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";
import { createRef } from "react";
import assert from "node:assert/strict";
import test, { after } from "node:test";

const api = await loadRenderer(
  "composer-history",
  'export { ChatInput } from "./src/renderer/components/ChatInput.tsx";',
);
api.setAppLanguage("en-US");
after(restoreGlobals);
let nextScope = 0;

async function composer(t, options = {}, bridge = {}) {
  const boundary = installRendererApi(
    dom.window,
    api,
    () => ({
      call(method) {
        if (method === "skills.list") return { skills: [] };
        if (method === "files.index") return { files: [], truncated: false };
        throw new Error(`Unexpected history Host request: ${method}`);
      },
    }),
    {
      bridge: {
        inspectLocalFiles: async ({ paths }) =>
          paths.map((path) => ({ path, exists: true, isFile: true, insideCwd: false })),
        ...bridge,
      },
    },
  );
  const ref = createRef();
  let props = {
    ref,
    draftKey: `dom-history-${++nextScope}`,
    cwd: "/workspace/history",
    visible: true,
    isStreaming: false,
    model: { provider: "fixture", modelId: "fixture" },
    modelList: [{ id: "fixture", provider: "fixture", name: "Fixture" }],
    onAbort() {},
    onSend() {},
    promptHistory: [{ text: "older prompt", at: 1 }],
    ...options,
  };
  const view = await mount(t, api.ChatInput, props, { release: boundary.close });
  return {
    ...view,
    ref,
    draftKey: props.draftKey,
    editor: () => getByRole(view.container, "textbox"),
    send: () => getByRole(view.container, "button", "Send"),
    alerts: () =>
      allByRole(view.container, "alert")
        .map((node) => node.textContent)
        .join(" "),
    async update(next) {
      props = { ...props, ...next };
      await view.update(props);
    },
  };
}

async function edit(view, text) {
  await act(async () => {
    const editor = view.editor();
    editor.focus();
    editor.textContent = text;
    const selection = dom.window.getSelection();
    selection.selectAllChildren(editor);
    selection.collapseToEnd();
    editor.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

async function recall(view) {
  await keyDown(view.editor(), "ArrowUp");
  await keyDown(view.editor(), "ArrowUp");
}

const stored = (key) => {
  const value = dom.window.localStorage.getItem(`dexon-draft:${key}`);
  return value ? JSON.parse(value).value : null;
};

test("queueing a recalled slash prompt uses streaming dispatch and keeps the working draft when the queue fails", async (t) => {
  let rejectQueue;
  let delivered;
  const pending = new Promise((_, reject) => {
    rejectQueue = reject;
  });
  const view = await composer(t, {
    isStreaming: true,
    promptHistory: [{ text: "/compact", at: 1 }],
    onFollowUp() {
      assert.fail("slash prompts must use streaming dispatch before follow-up dispatch");
    },
    onPromptWithStreamingBehavior(message, behavior) {
      delivered = { message, behavior };
      return pending;
    },
  });
  await edit(view, "working draft");
  await recall(view);
  assert.equal(view.editor().textContent, "/compact");
  await keyDown(view.editor(), "Enter");
  assert.deepEqual(delivered, { message: "/compact", behavior: "followUp" });
  assert.equal(view.editor().textContent, "working draft");
  await act(async () => rejectQueue(new Error("queue unavailable")));
  assert.equal(view.editor().textContent, "/compact");
  assert.match(view.alerts(), /queue unavailable/);
  assert.equal(allByRole(view.container, "group", /^Slash commands/).length, 0);
  await keyDown(view.editor(), "Escape");
  assert.equal(view.editor().textContent, "working draft");
  assert.equal(stored(view.draftKey), "working draft");
});

test("plain recalled prompts use follow-up dispatch and a newer edit survives a late queue rejection", async (t) => {
  let rejectQueue;
  let delivered;
  const pending = new Promise((_, reject) => {
    rejectQueue = reject;
  });
  const view = await composer(t, {
    isStreaming: true,
    onPromptWithStreamingBehavior() {
      assert.fail("plain prompts must not use slash streaming dispatch");
    },
    onFollowUp(message) {
      delivered = message;
      return pending;
    },
  });
  await edit(view, "working draft");
  await recall(view);
  await click(view.send());
  assert.equal(delivered, "older prompt");
  assert.equal(view.editor().textContent, "working draft");
  await edit(view, "newer work");
  await act(async () => rejectQueue(new Error("queue unavailable")));
  assert.equal(view.editor().textContent, "newer work");
  assert.match(view.alerts(), /newer draft was kept/);
});

test("Enter while streaming does not queue without a follow-up callback", async (t) => {
  const view = await composer(t, {
    isStreaming: true,
    promptHistory: [{ text: "/compact", at: 1 }],
    onPromptWithStreamingBehavior() {
      assert.fail("Enter needs an available follow-up action");
    },
  });
  await edit(view, "working draft");
  await recall(view);
  await keyDown(view.editor(), "Enter");
  assert.equal(view.editor().textContent, "/compact");
  await keyDown(view.editor(), "Escape");
  assert.equal(view.editor().textContent, "working draft");
});

test("a handled local command remains recallable when a new composer becomes a real session", async (t) => {
  const view = await composer(t, {
    draftKey: "new:/history-command-carry",
    promptHistory: [],
    onBuiltinCommand: async () => ({ handled: true }),
    onSend() {
      assert.fail("handled builtins must not be sent as prompts");
    },
  });
  await edit(view, "/compact");
  await click(view.send());
  await settle();
  assert.equal(view.editor().textContent, "");
  await view.update({ draftKey: "history-created-session" });
  await keyDown(view.editor(), "ArrowUp");
  assert.equal(view.editor().textContent, "/compact");
  assert.equal(allByRole(view.container, "group", /^Slash commands/).length, 0);
});

test("a handled command resolving after a scope change belongs to the scope that submitted it", async (t) => {
  let resolveCommand;
  const pending = new Promise((resolve) => {
    resolveCommand = resolve;
  });
  const view = await composer(t, {
    draftKey: "history-command-original",
    promptHistory: [],
    onBuiltinCommand: () => pending,
  });
  await edit(view, "/name original");
  await click(view.send());
  await view.update({ draftKey: "history-command-other" });
  await act(async () => resolveCommand({ handled: true }));
  await keyDown(view.editor(), "ArrowUp");
  assert.equal(view.editor().textContent, "");
  await view.update({ draftKey: "history-command-original" });
  await keyDown(view.editor(), "ArrowUp");
  assert.equal(view.editor().textContent, "/name original");
});

test("hiding or switching sessions during a preview commits the working draft instead of the preview", async (t) => {
  const view = await composer(t);
  await edit(view, "working draft");
  await recall(view);
  await view.update({ visible: false });
  assert.equal(view.editor().textContent, "working draft");
  assert.equal(stored(view.draftKey), "working draft");
  await view.update({ visible: true });
  await recall(view);
  await view.update({ draftKey: "history-switch-other" });
  assert.equal(stored(view.draftKey), "working draft");
  await view.update({ draftKey: view.draftKey });
  assert.equal(view.editor().textContent, "working draft");
});

test("legacy attachment migration updates the working draft underneath an open history preview", async (t) => {
  const draftKey = "history-migration-preview";
  dom.window.localStorage.setItem(
    `dexon-draft:${draftKey}`,
    JSON.stringify({
      schemaVersion: 2,
      value: "legacy work",
      images: [{ data: "AA==", mimeType: "image/png" }],
    }),
  );
  let resolveStage;
  const pending = new Promise((resolve) => {
    resolveStage = resolve;
  });
  const view = await composer(t, { draftKey }, { stageClipboardImage: () => pending });
  await recall(view);
  assert.equal(view.editor().textContent, "older prompt");
  await act(async () => resolveStage({ ok: true, staged: { path: "/tmp/history-restored.png" } }));
  assert.equal(view.editor().textContent, "older prompt");
  await keyDown(view.editor(), "Escape");
  assert.match(view.editor().textContent, /^legacy work/);
  assert.equal(allByRole(view.editor(), "button", "history-restored.png").length, 1);
  await view.unmount();
  assert.equal(stored(draftKey), "legacy work @/tmp/history-restored.png ");
});

test("IME arrows and Escape leave history browsing untouched until composition ends", async (t) => {
  const view = await composer(t);
  await edit(view, "working draft");
  await recall(view);
  await act(async () =>
    view.editor().dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true })),
  );
  for (const key of ["ArrowUp", "ArrowDown", "Escape"])
    await keyDown(view.editor(), key, { isComposing: true, keyCode: 229 });
  assert.equal(view.editor().textContent, "older prompt");
  await act(async () =>
    view.editor().dispatchEvent(new dom.window.CompositionEvent("compositionend", { bubbles: true })),
  );
  await keyDown(view.editor(), "Escape");
  assert.equal(view.editor().textContent, "working draft");
});

test("a rejected recalled send reappears as a menu-free preview over the stored working draft", async (t) => {
  const view = await composer(t, {
    promptHistory: [{ text: "/compact", at: 1 }],
    onSend: () => ({ ok: false }),
  });
  await edit(view, "working draft");
  await recall(view);
  await keyDown(view.editor(), "Enter");
  assert.equal(view.editor().textContent, "/compact");
  assert.equal(allByRole(view.container, "group", /^Slash commands/).length, 0);
  assert.match(view.alerts(), /Not sent/);
  await keyDown(view.editor(), "Escape");
  assert.equal(view.editor().textContent, "working draft");
  assert.equal(stored(view.draftKey), "working draft");
});
