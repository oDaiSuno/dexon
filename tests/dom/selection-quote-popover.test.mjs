import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRef } from "react";
import { act, byRole, click, dom, keyDown, restoreGlobals } from "../support/renderer.mjs";
import { openConversation } from "../support/session-reading-scene.mjs";
import { askButton, installSelectionGeometry, selectText } from "../support/selection-quote-scene.mjs";
import { heldPagesHost, installBrowserEventGlobals } from "../support/turn-outline-scene.mjs";
import { fiveQuestionHistory } from "../fixtures/turn-outline-history.mjs";

after(restoreGlobals);

async function openSelectionScene(t) {
  installBrowserEventGlobals(t);
  const { detail, pages } = fiveQuestionHistory("selection-popover");
  const held = heldPagesHost(detail, pages);
  const chatInputRef = createRef();
  const scene = await openConversation(t, { host: held.host, props: { session: detail.info, chatInputRef } });
  const container = byRole(scene.view.container, "region", /^(Conversation|对话内容)$/);
  installSelectionGeometry(t);
  return { scene, container, chatInputRef };
}

test("selecting assistant reply text offers Ask Dexon", async (t) => {
  const { scene, container } = await openSelectionScene(t);
  const paragraph = container.querySelector('[data-quote-role="assistant"] .markdown-body p');
  assert.ok(paragraph);
  await selectText(paragraph);
  await scene.settle(() => assert.ok(askButton()));
});

test("pressing the pill preserves selection through mousedown and inserts an atomic composer quote", async (t) => {
  const { container } = await openSelectionScene(t);
  const paragraph = container.querySelector('[data-quote-role="assistant"] .markdown-body p');
  await selectText(paragraph);
  const pill = askButton();
  assert.ok(pill);
  await act(async () => {
    const down = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
    pill.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    assert.equal(dom.window.getSelection().toString(), "Three bugs are still open.");
  });
  await click(pill);
  const editor = dom.window.document.querySelector('[role="textbox"]');
  const chip = editor.querySelector("[data-quote-token]");
  assert.ok(chip);
  assert.equal(chip.contentEditable, "false");
  assert.equal(dom.window.document.activeElement, editor);
  assert.equal(askButton(), undefined);
  assert.equal(dom.window.getSelection().toString(), "");
});

test("keyboard selection in a user bubble offers the same quote action", async (t) => {
  const { container } = await openSelectionScene(t);
  const paragraph = container.querySelector('[data-quote-role="user"] p');
  await selectText(paragraph, paragraph, { event: "keyup" });
  assert.ok(askButton());
});

for (const kind of ["collapsed", "whitespace", "composer", "cross-message"]) {
  test(`${kind} selection never offers a quote action`, async (t) => {
    const { container, chatInputRef } = await openSelectionScene(t);
    const paragraph = container.querySelector('[data-quote-role="assistant"] p');
    if (kind === "composer") {
      await act(async () => chatInputRef.current.insertText("Draft text"));
      const editor = dom.window.document.querySelector('[role="textbox"]');
      await selectText(editor);
    } else if (kind === "whitespace") {
      const text = dom.window.document.createElement("span");
      text.textContent = "   \n   ";
      paragraph.append(text);
      await selectText(text);
    } else if (kind === "cross-message") {
      await selectText(container.querySelector('[data-quote-role="user"] p'), paragraph);
    } else {
      await selectText(paragraph, paragraph, { collapsed: true });
    }
    assert.equal(askButton(), undefined);
  });
}

for (const dismissal of ["Escape", "blank area", "scroll", "hidden", "session change"]) {
  test(`${dismissal} immediately dismisses the quote popover`, async (t) => {
    const { scene, container } = await openSelectionScene(t);
    await selectText(container.querySelector('[data-quote-role="assistant"] p'));
    assert.ok(askButton());
    if (dismissal === "Escape") await keyDown(container, "Escape");
    if (dismissal === "blank area") await click(container);
    if (dismissal === "scroll") await act(async () => container.dispatchEvent(new dom.window.Event("scroll")));
    if (dismissal === "hidden") await scene.rerender({ visible: false });
    if (dismissal === "session change")
      await scene.rerender({
        session: { ...scene.host.detail?.info, id: "different-session", environmentId: "primary", cwd: "/workspace" },
      });
    assert.equal(askButton(), undefined);
  });
}

test("selectionchange alone can open a new selection after dismissal", async (t) => {
  const { container } = await openSelectionScene(t);
  await selectText(container.querySelector('[data-quote-role="assistant"] p'), undefined, { event: "selectionchange" });
  assert.ok(askButton());
});
