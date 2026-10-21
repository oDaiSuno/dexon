import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { act } from "react";
import {
  dom,
  harness,
  rootEl,
  restoreGlobals,
  resetDraftCache,
  editorEl,
  modelPortal,
  mount,
  rerender,
  unmount,
  setEditorText,
  click,
  pressKey,
  mouseDown,
} from "./chat-input-visibility.harness.mjs";
const clearDraftStorage = (key) => harness.storedValues.delete(`dexon-draft:${key}`);
after(restoreGlobals);
beforeEach(() => {
  harness.resetRequests();
  harness.storedValues.clear();
  resetDraftCache();
});

test("visible to hidden to visible keeps the same editor and commits its draft", async (t) => {
  t.after(async () => unmount());
  const draftKey = `phase-8-visibility-draft-${Date.now()}`;
  harness.storedValues.set(
    `dexon-draft:${draftKey}`,
    JSON.stringify({ schemaVersion: 3, value: "persisted before mount", updatedAt: Date.now() }),
  );
  await mount();
  await rerender({ draftKey });
  assert.equal(editorEl().textContent, "persisted before mount", "a persisted draft materializes before hiding");
  await setEditorText("draft survives a hidden page");
  const editorBeforeHide = editorEl();
  await rerender({ visible: false });
  assert.ok(editorEl().closest("[hidden]"), "hidden ChatInput must be removed from layout");
  assert.ok(editorEl().closest('[aria-hidden="true"]'), "hidden ChatInput must be hidden from assistive tech");
  assert.ok(editorEl().closest("[inert]"), "hidden ChatInput must be inert");
  assert.equal(
    JSON.parse(harness.storedValues.get(`dexon-draft:${draftKey}`)).value,
    "draft survives a hidden page",
    "hiding must commit the current draft immediately",
  );
  await rerender({ visible: true });
  assert.strictEqual(editorEl(), editorBeforeHide, "visibility changes must not recreate the editor instance");
  assert.equal(
    editorEl().textContent,
    "draft survives a hidden page",
    "the draft text must remain editable after return",
  );
  clearDraftStorage(draftKey);
  await unmount();
});

test("legacy draft migration cannot overwrite a newer draft key after staging resolves", async (t) => {
  t.after(async () => unmount());
  const legacyKey = "phase-8-legacy-migration-a";
  const currentKey = "phase-8-legacy-migration-b";
  clearDraftStorage(legacyKey);
  clearDraftStorage(currentKey);
  harness.storedValues.set(
    `dexon-draft:${legacyKey}`,
    JSON.stringify({
      schemaVersion: 2,
      value: "legacy draft",
      images: [{ data: "ZmFrZQ==", mimeType: "image/png" }],
    }),
  );
  harness.storedValues.set(
    `dexon-draft:${currentKey}`,
    JSON.stringify({ schemaVersion: 3, value: "current draft", updatedAt: 1 }),
  );
  const previousStager = harness.getStageClipboardImage();
  let resolveStage;
  harness.setStageClipboardImage(
    () =>
      new Promise((resolve) => {
        resolveStage = resolve;
      }),
  );
  try {
    await mount({ draftKey: legacyKey });
    await rerender({ draftKey: currentKey });
    resolveStage({ ok: true, staged: { path: "/tmp/legacy-image.png" } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(editorEl().textContent, "current draft", "a stale migration must not replace the active draft");
  } finally {
    harness.setStageClipboardImage(previousStager);
    clearDraftStorage(legacyKey);
    clearDraftStorage(currentKey);
  }
});
test("failed submission restoration while hidden does not steal another page's selection", async (t) => {
  t.after(async () => unmount());
  let rejectSend;
  const pending = new Promise((_, reject) => {
    rejectSend = reject;
  });
  await mount({ draftKey: "phase-8-hidden-failure", onSend: () => pending });
  await setEditorText("message that failed");
  await click(rootEl.querySelector('button[aria-label="Send"]'));
  assert.equal(editorEl().textContent, "", "send clears the draft before awaiting the result");
  await rerender({ visible: false });
  const outside = dom.window.document.createElement("div");
  outside.textContent = "selection on another page";
  outside.setAttribute("contenteditable", "true");
  dom.window.document.body.appendChild(outside);
  outside.focus();
  const selection = dom.window.getSelection();
  const range = dom.window.document.createRange();
  range.selectNodeContents(outside);
  selection.removeAllRanges();
  selection.addRange(range);
  rejectSend(new Error("send failed"));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(editorEl().textContent, "message that failed", "the failed draft must still be restored");
  assert.strictEqual(dom.window.document.activeElement, outside, "hidden recovery must not move focus");
  assert.equal(selection.toString(), "selection on another page", "hidden recovery must not replace selection");
  outside.remove();
  clearDraftStorage("phase-8-hidden-failure");
});
test("hidden imperative insertions accumulate without replacing another page's selection", async (t) => {
  t.after(async () => unmount());
  const draftKey = "phase-8-hidden-batch";
  clearDraftStorage(draftKey);
  const handle = await mount({ draftKey });
  const editorBeforeHide = editorEl();
  await rerender({ visible: false });
  const outside = dom.window.document.createElement("div");
  outside.textContent = "outside selection";
  outside.setAttribute("contenteditable", "true");
  dom.window.document.body.appendChild(outside);
  outside.focus();
  const selection = dom.window.getSelection();
  const range = dom.window.document.createRange();
  range.selectNodeContents(outside);
  selection.removeAllRanges();
  selection.addRange(range);
  await act(async () => {
    handle.current.insertText("prefix");
    handle.current.insertToken("/tmp/first.txt");
    handle.current.insertToken("/tmp/second.txt");
    handle.current.insertText("tail");
    handle.current.prependText("header");
  });
  assert.deepEqual(
    Array.from(editorEl().querySelectorAll("[data-attachment-token]"), (node) => node.dataset.path),
    ["/tmp/first.txt", "/tmp/second.txt"],
    "consecutive hidden insertions must preserve every accepted token",
  );
  assert.match(editorEl().textContent ?? "", /tail$/);
  assert.strictEqual(dom.window.document.activeElement, outside, "hidden insertion must not move focus");
  assert.equal(selection.toString(), "outside selection", "hidden insertion must not replace selection");
  outside.remove();
  await rerender({ visible: true });
  await rerender({ visible: false });
  assert.strictEqual(editorEl(), editorBeforeHide, "hidden insertion keeps the mounted editor instance");
  assert.equal(
    JSON.parse(harness.storedValues.get(`dexon-draft:${draftKey}`)).value,
    "header\n\nprefix @/tmp/first.txt @/tmp/second.txt tail",
    "the serialized hidden value is persisted after re-entry",
  );
  clearDraftStorage(draftKey);
});
test("a file batch that crosses hide keeps every staged and local token", async (t) => {
  t.after(async () => unmount());
  const draftKey = "phase-8-hidden-file-batch";
  clearDraftStorage(draftKey);
  const previousStage = harness.getStageClipboardImage();
  const oldBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const oldObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  let resolveStage;
  harness.setStageClipboardImage(
    () =>
      new Promise((resolve) => {
        resolveStage = resolve;
      }),
  );
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 800, height: 600, close() {} }),
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:phase8" });
  try {
    const handle = await mount({ draftKey });
    const batch = handle.current.addFiles([
      {
        name: "hidden-shot.png",
        type: "image/png",
        arrayBuffer: async () => Uint8Array.from([1]).buffer,
      },
      { name: "second.txt", type: "text/plain", testPath: "/tmp/second.txt" },
    ]);
    assert.equal(batch, undefined, "the public addFiles API remains fire-and-forget");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(typeof resolveStage, "function", "the first image is paused at the staging boundary");
    await rerender({ visible: false });
    resolveStage({ ok: true, staged: { path: "/tmp/hidden-shot.png" } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.deepEqual(
      Array.from(editorEl().querySelectorAll("[data-attachment-token]"), (node) => node.dataset.path),
      ["/tmp/hidden-shot.png", "/tmp/second.txt"],
      "a hidden continuation preserves both the awaited image and later local file",
    );
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  } finally {
    harness.setStageClipboardImage(previousStage);
    if (oldBitmap) Object.defineProperty(globalThis, "createImageBitmap", oldBitmap);
    else delete globalThis.createImageBitmap;
    if (oldObjectUrl) Object.defineProperty(URL, "createObjectURL", oldObjectUrl);
    else delete URL.createObjectURL;
    clearDraftStorage(draftKey);
  }
});
test("composition Enter and native IME key codes never submit before the grace window expires", async (t) => {
  t.after(async () => unmount());
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const sent = [];
  await mount({ onSend: (message) => sent.push(message) });
  await setEditorText("composed message");
  editorEl().focus();
  await act(async () => {
    editorEl().dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true }));
  });
  await pressKey("Enter", { isComposing: true, keyCode: 229 });
  assert.deepEqual(sent, [], "an Enter reported by the IME must not submit");
  await act(async () => {
    editorEl().dispatchEvent(new dom.window.CompositionEvent("compositionend", { bubbles: true, data: "" }));
  });
  await pressKey("Enter");
  assert.deepEqual(sent, [], "Enter immediately after composition must remain suppressed");
  await click(rootEl.querySelector('button[aria-label="Send"]'));
  assert.deepEqual(sent, ["composed message"], "the retained draft remains available after the IME guard");
});

test("hiding during composition resets IME state before the editor returns", async (t) => {
  t.after(async () => unmount());
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const sent = [];
  await mount({ onSend: (message) => sent.push(message) });
  await setEditorText("composition survives hide");
  editorEl().focus();
  await act(async () => {
    editorEl().dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true }));
  });
  await pressKey("Enter", { isComposing: true, keyCode: 229 });
  assert.deepEqual(sent, [], "Enter must remain suppressed during composition");
  await rerender({ visible: false });
  await rerender({ visible: true });
  t.mock.timers.setTime(1_101);
  await pressKey("Enter");
  assert.deepEqual(sent, ["composition survives hide"], "a returned editor must not keep IME suppression forever");
});

test("a newer draft wins when a queued submission fails", async (t) => {
  t.after(async () => unmount());
  let rejectFollowUp;
  const pending = new Promise((_, reject) => {
    rejectFollowUp = reject;
  });
  await mount({ isStreaming: true, onFollowUp: () => pending });
  await setEditorText("old queued message");
  await click(rootEl.querySelector('button[aria-label="Send"]'));
  await setEditorText("newer draft typed while the queue was pending");
  rejectFollowUp(new Error("queue failed"));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(
    editorEl().textContent,
    "newer draft typed while the queue was pending",
    "a failed queue operation must not overwrite a newer edit",
  );
});

test("hidden input loses focus, becomes non-editable, and restores editing on return", async (t) => {
  t.after(async () => unmount());
  const sent = [];
  await mount({ onSend: () => sent.push("sent") });
  const editor = editorEl();
  editor.focus();
  assert.strictEqual(dom.window.document.activeElement, editor, "the visible editor should accept focus");

  await rerender({ visible: false });
  // Adversarial input, not an ordinary user click: deliberately inject an
  // event into the hidden control to verify the component's own guard.
  await act(async () =>
    rootEl
      .querySelector('button[aria-label="Send"]')
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })),
  );
  assert.deepEqual(sent, [], "hidden send controls must not submit a prompt");
  assert.notStrictEqual(dom.window.document.activeElement, editor, "hidden input must not retain focus");
  assert.equal(editor.getAttribute("contenteditable"), "false", "hidden input must not remain editable");

  await rerender({ visible: true });
  assert.equal(editor.getAttribute("contenteditable"), "true", "visible input must become editable again");
  await unmount();
});

test("hiding closes local menus and the body-mounted model menu", async (t) => {
  t.after(async () => unmount());
  await mount();

  await click(rootEl.querySelector('button[aria-haspopup="listbox"]'));
  assert.ok(modelPortal(), "the model picker must be mounted outside the ChatInput root when open");
  await rerender({ visible: false });
  assert.equal(modelPortal(), undefined, "hiding must remove the body-mounted model picker");
  assert.equal(rootEl.querySelectorAll(".composer-pop-in").length, 0, "hidden input must render no transient menu");

  await rerender({ visible: true });
  await click(rootEl.querySelector('button[aria-label="Add images or local file references"]'));
  assert.ok(rootEl.querySelector('[role="menu"]'), "the plus menu must still open when visible");
  await rerender({ visible: false });
  assert.equal(rootEl.querySelectorAll(".composer-pop-in").length, 0, "hiding must close the plus menu");

  await rerender({ visible: true });
  await setEditorText("/");
  assert.ok(rootEl.querySelector(".composer-pop-in"), "the slash menu must open for a visible slash query");
  await rerender({ visible: false });
  assert.equal(rootEl.querySelectorAll(".composer-pop-in").length, 0, "hiding must close the slash menu");

  await rerender({ visible: true });
  await click(rootEl.querySelector('button[aria-label="Add images or local file references"]'));
  const skillRow = Array.from(rootEl.querySelectorAll('[role="menuitem"]')).find((node) =>
    node.textContent?.includes("Use a skill"),
  );
  await mouseDown(skillRow);
  assert.ok(
    rootEl.querySelector('[role="menu"][aria-label="Use a skill"] input[placeholder="Search skills…"]'),
    "the skill picker must open when visible",
  );
  await rerender({ visible: false });
  assert.equal(rootEl.querySelectorAll(".composer-pop-in").length, 0, "hiding must close the skill picker");

  await rerender({
    visible: true,
    thinkingLevel: "auto",
    availableThinkingLevels: ["low"],
    onThinkingLevelChange() {},
  });
  await click(rootEl.querySelector('button[aria-label^="Change reasoning level"]'));
  assert.ok(rootEl.querySelector('[role="menu"][aria-label="Change reasoning level"]'));
  const visibleEscape = new dom.window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => dom.window.document.dispatchEvent(visibleEscape));
  assert.equal(visibleEscape.defaultPrevented, true, "the visible thinking menu owns Escape");
  assert.equal(rootEl.querySelector('[role="menu"][aria-label="Change reasoning level"]'), null);

  await click(rootEl.querySelector('button[aria-label^="Change reasoning level"]'));
  await rerender({ visible: false });
  assert.equal(rootEl.querySelectorAll(".composer-pop-in").length, 0, "hiding must close the thinking menu");
  const hiddenEscape = new dom.window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => dom.window.document.dispatchEvent(hiddenEscape));
  assert.equal(hiddenEscape.defaultPrevented, false, "the hidden thinking menu removes its document listener");

  await rerender({ visible: true });
  await setEditorText("@");
  assert.ok(rootEl.querySelector(".composer-pop-in"), "the @ menu must open for a visible file query");
  await rerender({ visible: false });
  assert.equal(rootEl.querySelectorAll(".composer-pop-in").length, 0, "hiding must close the @ menu");
  await unmount();
});

test("the hidden composer does not consume Escape intended for another page", async (t) => {
  t.after(async () => unmount());
  await mount();
  await click(rootEl.querySelector('button[aria-label="Add images or local file references"]'));
  await rerender({ visible: false });
  const outside = dom.window.document.createElement("button");
  outside.type = "button";
  outside.textContent = "Other page";
  dom.window.document.body.appendChild(outside);
  outside.focus();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.strictEqual(
    dom.window.document.activeElement,
    outside,
    "hidden ChatInput must not steal Escape focus handling",
  );
  assert.equal(
    rootEl.querySelectorAll(".composer-pop-in").length,
    0,
    "hidden menus remain closed after outside Escape",
  );
  outside.remove();
  await unmount();
});

test("switching draft keys commits the previous key and unmount commits the current one", async (t) => {
  t.after(async () => unmount());
  const keyA = `phase-8-switch-a-${Date.now()}`;
  const keyB = `phase-8-switch-b-${Date.now()}`;
  clearDraftStorage(keyA);
  clearDraftStorage(keyB);
  await mount({ draftKey: keyA });
  await setEditorText("edited under key a");
  await rerender({ draftKey: keyB });
  assert.equal(
    JSON.parse(harness.storedValues.get(`dexon-draft:${keyA}`)).value,
    "edited under key a",
    "switching keys commits the previous key's draft",
  );
  await setEditorText("edited under key b");
  await unmount();
  assert.equal(
    JSON.parse(harness.storedValues.get(`dexon-draft:${keyB}`)).value,
    "edited under key b",
    "unmounting commits the current draft",
  );
});
