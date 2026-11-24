import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRef } from "react";
import { act, button, byRole, click, dom, keyDown, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { openConversation } from "../support/session-reading-scene.mjs";
import { askButton, installSelectionGeometry, selectText } from "../support/selection-quote-scene.mjs";
import {
  heldPagesHost,
  installBrowserEventGlobals,
  layOutConversation,
  scrollConversationTo,
} from "../support/turn-outline-scene.mjs";
import { decodeComposerQuoteToken } from "../../src/shared/quote-tokens.ts";
import {
  ANSWERS,
  QUESTIONS,
  assistantMessage,
  fiveQuestionHistory,
  userMessage,
} from "../fixtures/turn-outline-history.mjs";

after(restoreGlobals);

function quotedMessage(quote) {
  return `<quotes>\n<quote id="1" from="${quote.from}"${quote.entryId ? ` entry="${quote.entryId.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"` : ""}>\n${quote.text}\n</quote>\n</quotes>\n\nExplain [quote:1]`;
}

async function openQuoteScene(
  t,
  quote,
  { mobile = false, duplicate = false, noOlder = false, newest = false, sourceId, sessionId } = {},
) {
  installBrowserEventGlobals(t);
  const original = dom.window.matchMedia;
  if (mobile)
    dom.window.matchMedia = (query) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    });
  t.after(() => {
    dom.window.matchMedia = original;
  });
  const { detail, pages } = fiveQuestionHistory(sessionId ?? `quote-jump-${quote.entryId ?? "streaming"}`);
  detail.context.messages.push(userMessage(quotedMessage(quote), 11));
  detail.context.entryIds.push("entry-quote");
  if (duplicate) {
    detail.context.messages.push(userMessage(quotedMessage(quote), 12));
    detail.context.entryIds.push("entry-quote-other");
  }
  if (noOlder) detail.context.previousCursor = null;
  if (sourceId) detail.context.entryIds[1] = sourceId;
  if (newest) {
    detail.context.messages.push(assistantMessage(ANSWERS[4], 13));
    detail.context.entryIds.push("entry-newest-answer");
  }
  const held = heldPagesHost(detail, pages);
  const chatInputRef = createRef();
  const scene = await openConversation(t, { host: held.host, props: { session: detail.info, chatInputRef } });
  const container = byRole(scene.view.container, "region", /^(Conversation|对话内容)$/);
  layOutConversation(t, container, {
    viewHeight: 600,
    contentHeight: 5000,
    questionTops: ANSWERS.flatMap((answer, index) => [
      [QUESTIONS[index], index * 1000],
      [answer, index * 1000 + 200],
    ]),
  });
  await scrollConversationTo(container, 800);
  return { scene, container, held, chatInputRef, chip: container.querySelector(".quote-chip") };
}

const SENT_QUOTE = { id: "1", from: "assistant", entryId: "entry-a5", text: ANSWERS[4] };

async function quoteSelectedReply(container, { entryId, streaming = false }) {
  const message = container.querySelector('[data-quote-role="assistant"]');
  message.setAttribute("data-quote-entry-id", entryId);
  if (streaming) message.setAttribute("data-quote-streaming", "true");
  await selectText(message.querySelector(".markdown-body p"));
  await click(askButton());
}

const composerChips = () => dom.window.document.querySelectorAll('[role="textbox"] [data-quote-token]');

test("a sent quote jumps to a loaded assistant answer and highlights its source", async (t) => {
  const { container, chip, held } = await openQuoteScene(t, {
    id: "1",
    from: "assistant",
    entryId: "entry-a5",
    text: ANSWERS[4],
  });
  await click(chip);
  await waitFor(() => assert.equal(container.scrollTop, 4080));
  assert.ok(
    container.querySelector(
      '[data-quote-entry-id="entry-a5"] [data-quote-flash], [data-quote-entry-id="entry-a5"][data-quote-flash]',
    ),
  );
  assert.deepEqual(held.requests(), []);
});

test("an unloaded assistant quote reads older pages until its source arrives, then highlights it", async (t) => {
  const { scene, container, chip, held } = await openQuoteScene(t, {
    id: "1",
    from: "assistant",
    entryId: "entry-a2",
    text: ANSWERS[1],
  });
  await click(chip);
  await waitFor(() => assert.deepEqual(held.requests(), ["page-4"]));
  await waitFor(() => assert.equal(chip.getAttribute("aria-busy"), "true"));
  for (const cursor of ["page-4", "page-3", "page-2"]) {
    await held.release(cursor);
    await scene.drain();
  }
  await waitFor(() => assert.equal(container.scrollTop, 1080));
  assert.ok(container.querySelector('[data-quote-entry-id="entry-a2"][data-quote-flash]'));
  assert.equal(chip.getAttribute("aria-busy"), null);
  assert.deepEqual(held.requests(), ["page-4", "page-3", "page-2"]);
});

test("a quote absent from every older page becomes detached and preserves the full original text", async (t) => {
  const text = "A source on the other branch.\nIts complete original text must remain available, including the ending.";
  const { scene, container, chip, held } = await openQuoteScene(t, {
    id: "1",
    from: "assistant",
    entryId: "other-branch",
    text,
  });
  await click(chip);
  for (const cursor of ["page-4", "page-3", "page-2", "page-1"]) {
    await held.release(cursor);
    await scene.drain();
  }
  await scene.settle(() => assert.ok(chip.classList.contains("quote-chip-detached")));
  assert.equal(chip.getAttribute("aria-busy"), null);
  assert.equal(dom.window.document.querySelector(".quote-preview-text")?.textContent, text);
  assert.match(
    dom.window.document.querySelector(".quote-preview-hint").textContent,
    /Source message is not in this branch|原消息不在当前分支/,
  );
  assert.equal(container.scrollTop, 800);
  assert.deepEqual(held.requests(), ["page-4", "page-3", "page-2", "page-1"]);
});

for (const gesture of ["wheel", "PageUp", "scrollbar"]) {
  test(`${gesture} cancels an older quote jump without letting arriving pages move the reader`, async (t) => {
    const { scene, container, chip, held } = await openQuoteScene(t, {
      id: "1",
      from: "assistant",
      entryId: "entry-a2",
      text: ANSWERS[1],
    });
    await click(chip);
    await waitFor(() => assert.deepEqual(held.requests(), ["page-4"]));
    await act(async () => {
      if (gesture === "wheel")
        container.dispatchEvent(new dom.window.WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
      if (gesture === "PageUp")
        dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "PageUp" }));
      if (gesture === "scrollbar") container.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    });
    await scrollConversationTo(container, 180);
    await held.release("page-4");
    await scene.drain();
    assert.equal(container.scrollTop, 180);
    assert.equal(chip.getAttribute("aria-busy"), null);
    assert.deepEqual(held.requests(), ["page-4"]);
    assert.equal(container.querySelector("[data-quote-flash]"), null);
  });
}

test("two messages with quote id 1 keep their locating and detached states separate", async (t) => {
  const { scene, container, held } = await openQuoteScene(
    t,
    { id: "1", from: "assistant", entryId: "missing", text: "Preserved branch text" },
    { duplicate: true },
  );
  const chips = container.querySelectorAll(".quote-chip");
  await click(chips[0]);
  await waitFor(() => assert.equal(chips[0].getAttribute("aria-busy"), "true"));
  assert.equal(chips[1].getAttribute("aria-busy"), null);
  for (const cursor of ["page-4", "page-3", "page-2", "page-1"]) {
    await held.release(cursor);
    await scene.drain();
  }
  assert.ok(chips[0].classList.contains("quote-chip-detached"));
  assert.equal(chips[1].classList.contains("quote-chip-detached"), false);
});

test("two quotes in the composer keep their locating and detached states separate", async (t) => {
  const { scene, container, held } = await openQuoteScene(t, SENT_QUOTE, { sessionId: "quote-jump-composer-pair" });
  installSelectionGeometry(t);
  await quoteSelectedReply(container, { entryId: "other-branch" });
  await quoteSelectedReply(container, { entryId: "entry-a5" });
  const chips = composerChips();
  assert.equal(chips.length, 2);
  await click(chips[0]);
  await waitFor(() => assert.equal(chips[0].getAttribute("aria-busy"), "true"));
  assert.equal(chips[1].getAttribute("aria-busy"), null);
  for (const cursor of ["page-4", "page-3", "page-2", "page-1"]) {
    await held.release(cursor);
    await scene.drain();
  }
  await scene.settle(() => assert.ok(chips[0].classList.contains("quote-chip-detached")));
  assert.equal(chips[1].classList.contains("quote-chip-detached"), false);
  assert.equal(chips[1].getAttribute("aria-busy"), null);
});

test("a quote taken from a streaming reply carries no entry id and still jumps to its text", async (t) => {
  const { container, held } = await openQuoteScene(t, SENT_QUOTE, { sessionId: "quote-jump-composer-streaming" });
  installSelectionGeometry(t);
  await quoteSelectedReply(container, { entryId: "live-1", streaming: true });
  const chip = composerChips()[0];
  assert.equal(decodeComposerQuoteToken(chip.dataset.quotePayload).entryId, undefined);
  await click(chip);
  assert.ok(container.querySelector('[data-quote-streaming="true"][data-quote-flash]'));
  assert.equal(chip.classList.contains("quote-chip-detached"), false);
  assert.deepEqual(held.requests(), []);
});

test("a mobile quote can load and highlight an older assistant without the desktop navigator", async (t) => {
  const { scene, container, chip, held } = await openQuoteScene(
    t,
    { id: "1", from: "assistant", entryId: "entry-a4", text: ANSWERS[3] },
    { mobile: true },
  );
  assert.equal(container.parentElement.querySelector(".chat-turn-nav"), null);
  await click(chip);
  await held.release("page-4");
  await scene.drain();
  assert.equal(container.scrollTop, 3080);
  assert.ok(container.querySelector('[data-quote-entry-id="entry-a4"][data-quote-flash]'));
});

test("a streaming quote without an entry id finds its loaded assistant source", async (t) => {
  const { container, chip, held } = await openQuoteScene(t, { id: "1", from: "assistant", text: ANSWERS[4] });
  await click(chip);
  assert.equal(container.scrollTop, 4080);
  assert.ok(container.querySelector('[data-quote-entry-id="entry-a5"][data-quote-flash]'));
  assert.deepEqual(held.requests(), []);
});

test("clicking a draft quote jumps without removing its chip or surrounding draft", async (t) => {
  const { container, chatInputRef } = await openQuoteScene(t, {
    id: "1",
    from: "assistant",
    entryId: "entry-a5",
    text: ANSWERS[4],
  });
  await act(async () => {
    chatInputRef.current.insertText("Keep this draft");
    chatInputRef.current.insertQuoteAtCaret({ id: "draft", from: "assistant", entryId: "entry-a5", text: ANSWERS[4] });
  });
  const editor = dom.window.document.querySelector('[role="textbox"]');
  const chip = editor.querySelector("[data-quote-token]");
  const before = editor.textContent;
  await click(chip);
  assert.equal(container.scrollTop, 4080);
  assert.equal(editor.textContent, before);
  assert.equal(editor.querySelector("[data-quote-token]"), chip);
});

test("choosing a loaded turn cancels an outstanding quote jump", async (t) => {
  const { scene, container, chip, held } = await openQuoteScene(t, {
    id: "1",
    from: "assistant",
    entryId: "entry-a2",
    text: ANSWERS[1],
  });
  await click(chip);
  await waitFor(() => assert.deepEqual(held.requests(), ["page-4"]));
  await click(scene.view.container.querySelectorAll(".chat-turn-nav-row")[4]);
  await held.release("page-4");
  await scene.drain();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 180)));
  assert.deepEqual(held.requests(), ["page-4"]);
  assert.equal(chip.getAttribute("aria-busy"), null);
  assert.equal(container.querySelector("[data-quote-flash]"), null);
});

test("reactivating a detached chip keeps exactly one full-text preview open", async (t) => {
  const { scene, chip, held } = await openQuoteScene(t, {
    id: "1",
    from: "assistant",
    entryId: "missing",
    text: "Preserve the source",
  });
  await click(chip);
  for (const cursor of ["page-4", "page-3", "page-2", "page-1"]) {
    await held.release(cursor);
    await scene.drain();
  }
  await click(chip);
  assert.equal(dom.window.document.querySelectorAll(".quote-preview-card").length, 1);
});

test("scrolling just after an older quote arrives stops any remaining position adjustment", async (t) => {
  const { scene, container, chip, held } = await openQuoteScene(t, {
    id: "1",
    from: "assistant",
    entryId: "entry-a4",
    text: ANSWERS[3],
  });
  await click(chip);
  await held.release("page-4");
  await scene.drain({ passes: 2 });
  assert.equal(container.scrollTop, 3080);
  await act(async () => container.dispatchEvent(new dom.window.WheelEvent("wheel", { bubbles: true, deltaY: -120 })));
  await scrollConversationTo(container, 180);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
  assert.equal(container.scrollTop, 180);
});

for (const dismissal of ["Escape", "outside click", "scroll", "hidden", "session change"]) {
  test(`a missing source with no older pages opens immediately and closes on ${dismissal}`, async (t) => {
    const { scene, container, chip, held } = await openQuoteScene(
      t,
      { id: "1", from: "assistant", entryId: "missing", text: "The full preserved source" },
      { noOlder: true },
    );
    await click(chip);
    assert.ok(chip.classList.contains("quote-chip-detached"));
    assert.equal(dom.window.document.querySelector(".quote-preview-text")?.textContent, "The full preserved source");
    assert.deepEqual(held.requests(), []);
    if (dismissal === "Escape") await keyDown(chip, "Escape");
    if (dismissal === "outside click") await click(container);
    if (dismissal === "scroll") await scrollConversationTo(container, 100);
    if (dismissal === "hidden") await scene.rerender({ visible: false });
    if (dismissal === "session change")
      await scene.rerender({ session: { id: "another-session", environmentId: "primary", cwd: "/workspace" } });
    assert.equal(dom.window.document.querySelector(".quote-preview-card"), null);
  });
}

test("a source entry id containing selector punctuation remains locatable", async (t) => {
  const sourceId = 'entry "quoted"]:#\\path';
  const { container, chip } = await openQuoteScene(
    t,
    { id: "1", from: "assistant", entryId: sourceId, text: ANSWERS[4] },
    { sourceId },
  );
  await click(chip);
  assert.equal(container.scrollTop, 4080);
  assert.ok(
    Array.from(container.querySelectorAll("[data-quote-flash]")).some(
      (element) => element.dataset.quoteEntryId === sourceId,
    ),
  );
});

test("a user-source quote jumps to the user bubble rather than a navigator-only answer position", async (t) => {
  const { container, chip } = await openQuoteScene(t, {
    id: "1",
    from: "user",
    entryId: "entry-q5",
    text: QUESTIONS[4],
  });
  await click(chip);
  assert.equal(container.scrollTop, 3880);
  assert.ok(container.querySelector('[data-quote-entry-id="entry-q5"][data-quote-flash]'));
});

test("a quote without an entry id chooses the newest matching assistant", async (t) => {
  const { container, chip } = await openQuoteScene(
    t,
    { id: "1", from: "assistant", text: ANSWERS[4] },
    { newest: true },
  );
  await click(chip);
  assert.ok(container.querySelector('[data-quote-entry-id="entry-newest-answer"][data-quote-flash]'));
  assert.equal(container.querySelector('[data-quote-entry-id="entry-a5"][data-quote-flash]'), null);
});

test("a quote without coordinates and without a loaded text match becomes detached without paginating", async (t) => {
  const { chip, held } = await openQuoteScene(t, {
    id: "1",
    from: "assistant",
    text: "An unmatched streaming excerpt",
  });
  await click(chip);
  assert.ok(chip.classList.contains("quote-chip-detached"));
  assert.equal(dom.window.document.querySelector(".quote-preview-text")?.textContent, "An unmatched streaming excerpt");
  assert.deepEqual(held.requests(), []);
});

test("an inline message editor keeps its quote when jumping to the source", async (t) => {
  const { scene, container } = await openQuoteScene(t, {
    id: "1",
    from: "assistant",
    entryId: "entry-a5",
    text: ANSWERS[4],
  });
  const wrapper = container.querySelector('[data-quote-entry-id="entry-quote"]');
  await click(button(wrapper, /^(Edit|编辑)$/));
  const editor = wrapper.querySelector('[role="textbox"]');
  assert.ok(editor);
  const chip = editor.querySelector("[data-quote-token]");
  await click(chip);
  assert.equal(container.scrollTop, 4080);
  await scene.drain();
  assert.equal(editor.querySelector("[data-quote-token]"), chip);
});
