import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  computeSelectionPopoverPosition,
  extractMessageSelection,
  flashQuoteTarget,
  locateQuoteRangeInElements,
} from "../../src/renderer/lib/quote-text-locator.ts";

const defaultRect = { top: 100, bottom: 120, left: 40, right: 180, width: 140, height: 20 };

function createScene(t, markup) {
  const dom = new JSDOM(`<main id="chat">${markup}</main>`);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  return { window: dom.window, document, chatRoot: document.querySelector("#chat") };
}

function selectText(window, startNode, startOffset, endNode, endOffset, rects = [defaultRect], bounds = defaultRect) {
  const range = window.document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  range.getClientRects = () => rects;
  range.getBoundingClientRect = () => bounds;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return { range, selection };
}

test("extracts a selected assistant message with its source and anchor", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="answer-1" data-quote-role="assistant" data-quote-streaming="true">Hello world</article>',
  );
  const node = document.querySelector("article").firstChild;
  const { selection } = selectText(window, node, 0, node, 11);
  assert.deepEqual(extractMessageSelection(selection, chatRoot), {
    text: "Hello world",
    from: "assistant",
    entryId: "answer-1",
    streaming: true,
    prefix: "",
    suffix: "",
    anchorRect: { top: 100, bottom: 120, left: 40, right: 180 },
  });
});

test("extracts user text without outer whitespace while preserving internal newlines", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="user-1" data-quote-role="user"> \n  first line\n\nsecond line  \n </article>',
  );
  const node = document.querySelector("article").firstChild;
  const { selection } = selectText(window, node, 0, node, node.length);
  const result = extractMessageSelection(selection, chatRoot);
  assert.equal(result.text, "first line\n\nsecond line");
  assert.equal(result.from, "user");
  assert.equal(result.entryId, "user-1");
  assert.equal(result.streaming, false);
});

test("rejects missing, empty, collapsed, and whitespace-only selections", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="1" data-quote-role="user"> \n </article>',
  );
  assert.equal(extractMessageSelection(null, chatRoot), null);
  assert.equal(extractMessageSelection(window.getSelection(), chatRoot), null);
  const node = document.querySelector("article").firstChild;
  const { selection } = selectText(window, node, 1, node, 1);
  assert.equal(extractMessageSelection(selection, chatRoot), null);
  const nonempty = selectText(window, node, 0, node, node.length).selection;
  assert.equal(extractMessageSelection(nonempty, null), null);
  assert.equal(extractMessageSelection(nonempty, chatRoot), null);
});

for (const wrapper of [
  '<div contenteditable="true"><span>blocked</span></div>',
  "<input>",
  "<textarea>blocked</textarea>",
  "<button><span>blocked</span></button>",
  "<span data-quote-ignore><strong>blocked</strong></span>",
  "<aside data-quote-popover><span>blocked</span></aside>",
]) {
  for (const endpoint of ["start", "end"]) {
    test(`rejects the ${endpoint} endpoint in ${wrapper}`, (t) => {
      const { window, document, chatRoot } = createScene(
        t,
        `<article data-quote-entry-id="1" data-quote-role="assistant">before ${wrapper} after</article>`,
      );
      const article = document.querySelector("article");
      const blocked = article.children[0];
      const { selection } =
        endpoint === "start"
          ? selectText(window, blocked, 0, article.lastChild, article.lastChild.length)
          : selectText(window, article.firstChild, 0, blocked, blocked.childNodes.length);
      assert.equal(extractMessageSelection(selection, chatRoot), null);
    });
  }
}

test("rejects selection crossing message containers even when their entry IDs agree", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="same" data-quote-role="assistant">first</article><article data-quote-entry-id="same" data-quote-role="assistant">second</article>',
  );
  const [first, second] = document.querySelectorAll("article");
  const { selection } = selectText(window, first.firstChild, 0, second.firstChild, 6);
  assert.equal(extractMessageSelection(selection, chatRoot), null);
  second.setAttribute("data-quote-entry-id", "other");
  assert.equal(extractMessageSelection(selection, chatRoot), null);
});

test("rejects endpoints outside the chat and non-message chrome inside it", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="1" data-quote-role="user">message</article><nav>chrome</nav>',
  );
  const outside = document.createElement("article");
  outside.setAttribute("data-quote-entry-id", "outside");
  outside.setAttribute("data-quote-role", "user");
  outside.textContent = "outside";
  document.body.append(outside);
  const message = document.querySelector("article").firstChild;
  const chrome = document.querySelector("nav").firstChild;
  for (const [start, end] of [
    [message, outside.firstChild],
    [message, chrome],
    [chrome, chrome],
    [outside.firstChild, outside.firstChild],
  ]) {
    const { selection } = selectText(window, start, 0, end, end.length);
    assert.equal(extractMessageSelection(selection, chatRoot), null);
  }
});

for (const role of [null, "tool", "system"]) {
  test(`rejects message role ${role}`, (t) => {
    const { window, document, chatRoot } = createScene(t, '<article data-quote-entry-id="1">text</article>');
    const article = document.querySelector("article");
    if (role !== null) article.setAttribute("data-quote-role", role);
    const { selection } = selectText(window, article.firstChild, 0, article.firstChild, 4);
    assert.equal(extractMessageSelection(selection, chatRoot), null);
  });
}

test("extracts normalized context across strong and code boundaries", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="1" data-quote-role="assistant">Lead <strong>in   alpha</strong><code> beta</code> tail\n next</article>',
  );
  const start = document.querySelector("strong").firstChild;
  const end = document.querySelector("code").firstChild;
  const { selection } = selectText(window, start, 5, end, 5);
  const result = extractMessageSelection(selection, chatRoot);
  assert.equal(result.text, "alpha beta");
  assert.equal(result.prefix, "Lead in ");
  assert.equal(result.suffix, " tail next");
});

test("limits each context to the nearest 24 normalized characters and ignores controls and hidden content", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="1" data-quote-role="user">012345678901234567890123456789<button>copy</button><span data-quote-ignore>ignored</span><span hidden>hidden</span><strong>target</strong><span class="token-chip-remove">remove</span>ABCDEFGHIJKLMNOPQRSTUVWXYZ1234</article>',
  );
  const node = document.querySelector("strong").firstChild;
  const { selection } = selectText(window, node, 0, node, 6);
  const result = extractMessageSelection(selection, chatRoot);
  assert.equal(result.prefix, "678901234567890123456789");
  assert.equal(result.suffix, "ABCDEFGHIJKLMNOPQRSTUVWX");
});

test("supports element-offset selection boundaries", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="1" data-quote-role="user">before <strong>target</strong> after</article>',
  );
  const article = document.querySelector("article");
  const { selection } = selectText(window, article, 1, article, 2);
  const result = extractMessageSelection(selection, chatRoot);
  assert.equal(result.text, "target");
  assert.equal(result.prefix, "before ");
  assert.equal(result.suffix, " after");
});

test("anchors to the last non-empty selected line rather than the whole selection", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="1" data-quote-role="user">multiline</article>',
  );
  const node = document.querySelector("article").firstChild;
  const lastLine = { top: 140, bottom: 160, left: 40, right: 90, width: 50, height: 20 };
  const empty = { top: 160, bottom: 180, left: 90, right: 90, width: 0, height: 20 };
  const { selection } = selectText(window, node, 0, node, node.length, [defaultRect, lastLine, empty]);
  assert.deepEqual(extractMessageSelection(selection, chatRoot).anchorRect, {
    top: 140,
    bottom: 160,
    left: 40,
    right: 90,
  });
});

test("uses the bounding rect when client rects are empty", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="1" data-quote-role="user">target</article>',
  );
  const node = document.querySelector("article").firstChild;
  const empty = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  for (const rects of [[], [empty]]) {
    const { selection } = selectText(window, node, 0, node, 6, rects);
    assert.deepEqual(extractMessageSelection(selection, chatRoot).anchorRect, {
      top: 100,
      bottom: 120,
      left: 40,
      right: 180,
    });
  }
});

const viewportRect = { top: 50, bottom: 500, left: 100, right: 600 };
const popover = { viewportRect, popoverWidth: 100, popoverHeight: 40 };

test("places the popover above and centered at the trailing edge of the last line", () => {
  assert.deepEqual(
    computeSelectionPopoverPosition({
      ...popover,
      anchorRect: { top: 200, bottom: 220, left: 120, right: 400 },
    }),
    { top: 152, left: 350, placement: "above" },
  );
});

test("flips the popover below a selection near the viewport top", () => {
  assert.deepEqual(
    computeSelectionPopoverPosition({
      ...popover,
      anchorRect: { top: 60, bottom: 80, left: 200, right: 300 },
    }),
    { top: 88, left: 250, placement: "below" },
  );
});

for (const [right, expectedLeft] of [
  [110, 112],
  [700, 488],
]) {
  test(`clamps the popover horizontal position to ${expectedLeft}`, () => {
    assert.equal(
      computeSelectionPopoverPosition({
        ...popover,
        anchorRect: { top: 200, bottom: 220, left: 100, right },
      }).left,
      expectedLeft,
    );
  });
}

test("clamps a flipped popover above the composer at the viewport bottom", () => {
  assert.deepEqual(
    computeSelectionPopoverPosition({
      ...popover,
      anchorRect: { top: 60, bottom: 490, left: 200, right: 300 },
    }),
    { top: 448, left: 250, placement: "below" },
  );
});

test("clamps vertical placement even if the anchor is outside the viewport", () => {
  assert.equal(
    computeSelectionPopoverPosition({
      ...popover,
      anchorRect: { top: -100, bottom: -80, left: 200, right: 300 },
    }).top,
    62,
  );
  assert.equal(
    computeSelectionPopoverPosition({
      ...popover,
      anchorRect: { top: 700, bottom: 720, left: 200, right: 300 },
    }).top,
    448,
  );
});

test("honors an explicit gap and margin including zero", () => {
  const anchorRect = { top: 200, bottom: 220, left: 100, right: 110 };
  assert.deepEqual(computeSelectionPopoverPosition({ ...popover, anchorRect, gap: 5, margin: 20 }), {
    top: 155,
    left: 120,
    placement: "above",
  });
  assert.deepEqual(computeSelectionPopoverPosition({ ...popover, anchorRect, gap: 0, margin: 0 }), {
    top: 160,
    left: 100,
    placement: "above",
  });
});

test("locates a plain phrase at exact text-node offsets", (t) => {
  const { document } = createScene(t, "<article>before target after</article>");
  const article = document.querySelector("article");
  const range = locateQuoteRangeInElements([article], { text: "target" });
  assert.ok(range);
  assert.equal(range.startContainer, article.firstChild);
  assert.equal(range.startOffset, 7);
  assert.equal(range.endContainer, article.firstChild);
  assert.equal(range.endOffset, 13);
  assert.equal(range.toString(), "target");
});

test("locates normalized text across strong, code, paragraph, and whitespace-node boundaries", (t) => {
  const { document } = createScene(
    t,
    "<article><p>lead <strong>alpha \n </strong><code>\t beta</code></p><p> gamma tail</p></article>",
  );
  const article = document.querySelector("article");
  const range = locateQuoteRangeInElements([article], { text: "alpha beta gamma" });
  assert.ok(range);
  assert.equal(range.startContainer, document.querySelector("strong").firstChild);
  assert.equal(range.startOffset, 0);
  assert.equal(range.endContainer, document.querySelectorAll("p")[1].firstChild);
  assert.equal(range.endOffset, 6);
  assert.equal(range.toString(), "alpha \n \t beta gamma");
});

test("locates a phrase spanning multiple pieces of an assistant entry", (t) => {
  const { document } = createScene(t, "<article>lead alpha</article><article><code> beta</code> tail</article>");
  const elements = [...document.querySelectorAll("article")];
  const range = locateQuoteRangeInElements(elements, { text: "alpha\n beta" });
  assert.ok(range);
  assert.equal(range.startContainer, elements[0].firstChild);
  assert.equal(range.startOffset, 5);
  assert.equal(range.endContainer, document.querySelector("code").firstChild);
  assert.equal(range.endOffset, 5);
  assert.equal(range.toString(), "alpha beta");
});

test("keeps Unicode text mapped to native UTF-16 range offsets", (t) => {
  const { document } = createScene(t, "<article>前😀<strong>中文 😀</strong>后</article>");
  const article = document.querySelector("article");
  const range = locateQuoteRangeInElements([article], { text: "😀中文 😀" });
  assert.ok(range);
  assert.equal(range.startContainer, article.firstChild);
  assert.equal(range.startOffset, 1);
  assert.equal(range.endContainer, document.querySelector("strong").firstChild);
  assert.equal(range.endOffset, 5);
  assert.equal(range.toString(), "😀中文 😀");
});

test("returns null for missing phrases, empty messages, and whitespace-only quotes", (t) => {
  const { document } = createScene(t, "<article>existing</article><article></article>");
  const [article, empty] = document.querySelectorAll("article");
  for (const text of ["missing", "", " \n\t "]) {
    assert.equal(locateQuoteRangeInElements([article], { text }), null);
  }
  assert.equal(locateQuoteRangeInElements([], { text: "existing" }), null);
  assert.equal(locateQuoteRangeInElements([empty], { text: "existing" }), null);
});

test("disambiguates duplicate phrases with normalized prefix and suffix", (t) => {
  const { document } = createScene(
    t,
    "<article><p>red <strong>same phrase</strong> blue</p><p>green   <strong>same phrase</strong> gold</p></article>",
  );
  const article = document.querySelector("article");
  const range = locateQuoteRangeInElements([article], {
    text: "same phrase",
    prefix: "green\t\n ",
    suffix: "\t gold",
  });
  assert.ok(range);
  assert.equal(range.startContainer, document.querySelectorAll("strong")[1].firstChild);
  assert.equal(range.toString(), "same phrase");
});

test("scores the longest matching context portions rather than requiring an exact context match", (t) => {
  const { document } = createScene(t, "<article><p>abc <b>target</b> xyq</p><p>xbc <b>target</b> xyz!</p></article>");
  const range = locateQuoteRangeInElements([document.querySelector("article")], {
    text: "target",
    prefix: "abc ",
    suffix: " xyz!",
  });
  assert.ok(range);
  assert.equal(range.startContainer, document.querySelectorAll("b")[1].firstChild);
});

test("scores overlapping occurrences instead of skipping them", (t) => {
  const { document } = createScene(t, "<article>aaaaa</article>");
  const range = locateQuoteRangeInElements([document.querySelector("article")], { text: "aaa", prefix: "aa" });
  assert.ok(range);
  assert.equal(range.startOffset, 2);
  assert.equal(range.endOffset, 5);
});

test("chooses the first candidate in element order when context scores tie", (t) => {
  const { document } = createScene(t, "<article>one target end</article><article>one target end</article>");
  const elements = [...document.querySelectorAll("article")];
  for (const context of [{}, { prefix: "one ", suffix: " end" }]) {
    const range = locateQuoteRangeInElements(elements, { text: "target", ...context });
    assert.ok(range);
    assert.equal(range.startContainer, elements[0].firstChild);
  }
});

test("relocates an extracted duplicate selection using the same visible-text context", (t) => {
  const { window, document, chatRoot } = createScene(
    t,
    '<article data-quote-entry-id="1" data-quote-role="assistant"><p>first <strong>same</strong> end</p><p>second <code>before </code><button>copy</button><strong>same</strong> after</p></article>',
  );
  const node = document.querySelectorAll("strong")[1].firstChild;
  const { selection } = selectText(window, node, 0, node, 4);
  const quote = extractMessageSelection(selection, chatRoot);
  assert.equal(quote.suffix, " after");
  const range = locateQuoteRangeInElements([document.querySelector("article")], quote);
  assert.ok(range);
  assert.equal(range.startContainer, node);
  assert.equal(range.startOffset, 0);
  assert.equal(range.endContainer, node);
  assert.equal(range.endOffset, 4);
});

for (const wrapper of [
  "<span data-quote-ignore><b>target</b></span>",
  "<button><b>target</b></button>",
  '<span class="token-chip-remove"><b>target</b></span>',
  "<span hidden><b>target</b></span>",
  '<span aria-hidden="true"><b>target</b></span>',
  '<span style="display: none"><b>target</b></span>',
  '<span style="visibility: hidden"><b>target</b></span>',
  '<span style="visibility: collapse"><b>target</b></span>',
]) {
  test(`does not locate excluded text in ${wrapper}`, (t) => {
    const { document } = createScene(t, `<article>${wrapper}<strong>target</strong></article>`);
    const range = locateQuoteRangeInElements([document.querySelector("article")], { text: "target" });
    assert.ok(range);
    assert.equal(range.startContainer, document.querySelector("strong").firstChild);
  });
}

test("falls back to whitespace-free matching across adjacent Markdown and paragraph boundaries", (t) => {
  const { document } = createScene(
    t,
    "<article><p>alpha<strong>beta</strong><code>gamma</code></p><p>delta</p></article>",
  );
  const article = document.querySelector("article");
  const range = locateQuoteRangeInElements([article], { text: "alpha beta gamma delta" });
  assert.ok(range);
  assert.equal(range.startContainer, document.querySelector("p").firstChild);
  assert.equal(range.startOffset, 0);
  assert.equal(range.endContainer, document.querySelectorAll("p")[1].firstChild);
  assert.equal(range.endOffset, 5);
  assert.equal(range.toString(), "alphabetagammadelta");
});

test("maps whitespace-free matches back to the full original text range", (t) => {
  const { document } = createScene(t, "<article>lead foo \n <code>bar</code>\t baz tail</article>");
  const article = document.querySelector("article");
  const range = locateQuoteRangeInElements([article], { text: "foobarbaz" });
  assert.ok(range);
  assert.equal(range.startContainer, article.firstChild);
  assert.equal(range.startOffset, 5);
  assert.equal(range.endContainer, article.lastChild);
  assert.equal(range.endOffset, 5);
  assert.equal(range.toString(), "foo \n bar\t baz");
});

test("also disambiguates duplicate whitespace-free matches by their context", (t) => {
  const { document } = createScene(
    t,
    "<article><p>red <code>foo</code>bar blue</p><p>green <code>foo</code>bar gold</p></article>",
  );
  const range = locateQuoteRangeInElements([document.querySelector("article")], {
    text: "f o o b a r",
    prefix: "green ",
    suffix: " gold",
  });
  assert.ok(range);
  assert.equal(range.startContainer, document.querySelectorAll("code")[1].firstChild);
  assert.equal(range.endOffset, 3);
  assert.equal(range.toString(), "foobar");
});

test("prefers a normalized-whitespace match over an earlier whitespace-free match", (t) => {
  const { document } = createScene(t, "<article><p><code>foo</code>bar</p><p><strong>foo bar</strong></p></article>");
  const range = locateQuoteRangeInElements([document.querySelector("article")], { text: "foo bar" });
  assert.ok(range);
  assert.equal(range.startContainer, document.querySelector("strong").firstChild);
});

test("returns null safely when a match would span different documents or disconnected trees", (t) => {
  const { document } = createScene(t, "<article>alpha</article>");
  const other = createScene(t, "<article>beta</article>");
  const first = document.querySelector("article");
  assert.equal(
    locateQuoteRangeInElements([first, other.document.querySelector("article")], { text: "alphabeta" }),
    null,
  );
  const detached = document.createElement("article");
  detached.textContent = "beta";
  assert.equal(locateQuoteRangeInElements([first, detached], { text: "alphabeta" }), null);
});

test("skips hidden message pieces and does not index overlapping roots twice", (t) => {
  const { document } = createScene(
    t,
    '<section style="display: none"><article>hidden</article></section><article><strong>target</strong></article>',
  );
  const elements = [...document.querySelectorAll("article")];
  assert.equal(locateQuoteRangeInElements(elements, { text: "hidden" }), null);
  assert.equal(
    locateQuoteRangeInElements([elements[1], document.querySelector("strong")], { text: "targettarget" }),
    null,
  );
});

function mockHighlightApi(t, { css = true, registry = true, highlight = true } = {}) {
  const highlights = new Map();
  class BrowserHighlight extends Set {
    constructor(...ranges) {
      super(ranges);
    }
  }
  for (const [name, value] of [
    ["CSS", css ? (registry ? { highlights } : {}) : undefined],
    ["Highlight", highlight ? BrowserHighlight : undefined],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  return highlights;
}

test("flashes the fallback message without changing its content and clears after 1500ms", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const highlights = mockHighlightApi(t);
  const { document } = createScene(t, '<article class="existing"><strong>target</strong></article>');
  const article = document.querySelector("article");
  const cancel = flashQuoteTarget({ range: null, fallbackElement: article });
  t.after(cancel);
  assert.equal(article.classList.contains("quote-target-message-flash"), true);
  assert.equal(article.dataset.quoteFlash, "message");
  assert.equal(article.innerHTML, "<strong>target</strong>");
  assert.equal(highlights.size, 0);
  t.mock.timers.tick(1499);
  assert.equal(article.dataset.quoteFlash, "message");
  t.mock.timers.tick(1);
  assert.equal(article.className, "existing");
  assert.equal(article.hasAttribute("data-quote-flash"), false);
});

test("immediately cancels a fallback flash and honors a custom duration", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mockHighlightApi(t);
  const { document } = createScene(t, "<article>target</article>");
  const article = document.querySelector("article");
  const cancel = flashQuoteTarget({ range: null, fallbackElement: article, durationMs: 40 });
  t.after(cancel);
  cancel();
  cancel();
  assert.equal(article.classList.contains("quote-target-message-flash"), false);
  assert.equal(article.hasAttribute("data-quote-flash"), false);
  const next = flashQuoteTarget({ range: null, fallbackElement: article, durationMs: 30 });
  t.after(next);
  t.mock.timers.tick(29);
  assert.equal(article.dataset.quoteFlash, "message");
  t.mock.timers.tick(1);
  assert.equal(article.hasAttribute("data-quote-flash"), false);
  t.mock.timers.tick(100);
  assert.equal(article.classList.contains("quote-target-message-flash"), false);
});

test("repeat jumps clear the previous message and stale cancellation cannot clear the new flash", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mockHighlightApi(t);
  const { document } = createScene(t, "<article>first</article><article>second</article>");
  const [first, second] = document.querySelectorAll("article");
  const cancelFirst = flashQuoteTarget({ range: null, fallbackElement: first, durationMs: 20 });
  t.after(cancelFirst);
  t.mock.timers.tick(10);
  const cancelSecond = flashQuoteTarget({ range: null, fallbackElement: second, durationMs: 30 });
  t.after(cancelSecond);
  assert.equal(first.classList.contains("quote-target-message-flash"), false);
  assert.equal(first.hasAttribute("data-quote-flash"), false);
  cancelFirst();
  t.mock.timers.tick(10);
  assert.equal(second.dataset.quoteFlash, "message");
  t.mock.timers.tick(20);
  assert.equal(second.classList.contains("quote-target-message-flash"), false);
  assert.equal(second.hasAttribute("data-quote-flash"), false);
});

test("a repeat jump to the same message restarts its flash lifetime", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mockHighlightApi(t);
  const { document } = createScene(t, "<article>target</article>");
  const article = document.querySelector("article");
  const first = flashQuoteTarget({ range: null, fallbackElement: article, durationMs: 100 });
  t.after(first);
  t.mock.timers.tick(60);
  const second = flashQuoteTarget({ range: null, fallbackElement: article, durationMs: 100 });
  t.after(second);
  t.mock.timers.tick(40);
  assert.equal(article.dataset.quoteFlash, "message");
  first();
  assert.equal(article.dataset.quoteFlash, "message");
  t.mock.timers.tick(60);
  assert.equal(article.hasAttribute("data-quote-flash"), false);
});

for (const capabilities of [{ css: false }, { registry: false }, { highlight: false }]) {
  test(`falls back to a message flash without full highlight support ${JSON.stringify(capabilities)}`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const highlights = mockHighlightApi(t, capabilities);
    const { document } = createScene(t, "<article>target</article>");
    const article = document.querySelector("article");
    const range = locateQuoteRangeInElements([article], { text: "target" });
    const cancel = flashQuoteTarget({ range, fallbackElement: article });
    t.after(cancel);
    assert.equal(article.dataset.quoteFlash, "message");
    assert.equal(highlights.size, 0);
    t.mock.timers.tick(1500);
    assert.equal(article.classList.contains("quote-target-message-flash"), false);
    assert.equal(article.hasAttribute("data-quote-flash"), false);
  });
}

test("registers the exact range with CSS.highlights and clears the span flash after 1800ms", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const highlights = mockHighlightApi(t);
  const unrelated = new Set();
  highlights.set("unrelated-highlight", unrelated);
  const { document } = createScene(t, "<article><p><strong>alpha</strong> beta</p></article>");
  const article = document.querySelector("article");
  const paragraph = document.querySelector("p");
  const range = locateQuoteRangeInElements([article], { text: "alpha beta" });
  const originalMarkup = article.innerHTML;
  const cancel = flashQuoteTarget({ range, fallbackElement: article });
  t.after(cancel);
  assert.equal(highlights.get("dexon-quote-target").has(range), true);
  assert.equal(paragraph.dataset.quoteFlash, "span");
  assert.equal(article.classList.contains("quote-target-message-flash"), false);
  assert.equal(article.textContent, "alpha beta");
  t.mock.timers.tick(1799);
  assert.equal(highlights.has("dexon-quote-target"), true);
  t.mock.timers.tick(1);
  assert.equal(highlights.has("dexon-quote-target"), false);
  assert.equal(paragraph.hasAttribute("data-quote-flash"), false);
  assert.equal(article.innerHTML, originalMarkup);
  assert.equal(highlights.get("unrelated-highlight"), unrelated);
});

test("cancels a span flash immediately and supports span highlighting without a fallback element", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const highlights = mockHighlightApi(t);
  const { document } = createScene(t, "<article><strong>target</strong></article>");
  const target = document.querySelector("strong");
  const range = locateQuoteRangeInElements([target], { text: "target" });
  const cancel = flashQuoteTarget({ range, fallbackElement: null, durationMs: 40 });
  t.after(cancel);
  assert.equal(target.dataset.quoteFlash, "span");
  assert.equal(highlights.get("dexon-quote-target").has(range), true);
  cancel();
  cancel();
  assert.equal(highlights.has("dexon-quote-target"), false);
  assert.equal(target.hasAttribute("data-quote-flash"), false);
  t.mock.timers.tick(100);
  assert.equal(highlights.size, 0);
});

test("repeated span jumps replace the highlight without stale timer or cancellation interference", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const highlights = mockHighlightApi(t);
  const { document } = createScene(t, "<article><strong>first</strong><code>second</code></article>");
  const article = document.querySelector("article");
  const first = document.querySelector("strong");
  const second = document.querySelector("code");
  const rangeOne = locateQuoteRangeInElements([article], { text: "first" });
  const rangeTwo = locateQuoteRangeInElements([article], { text: "second" });
  const cancelFirst = flashQuoteTarget({ range: rangeOne, fallbackElement: article, durationMs: 20 });
  t.after(cancelFirst);
  t.mock.timers.tick(10);
  const cancelSecond = flashQuoteTarget({ range: rangeTwo, fallbackElement: article, durationMs: 30 });
  t.after(cancelSecond);
  assert.equal(first.hasAttribute("data-quote-flash"), false);
  assert.equal(second.dataset.quoteFlash, "span");
  assert.equal(highlights.get("dexon-quote-target").has(rangeTwo), true);
  assert.equal(highlights.get("dexon-quote-target").has(rangeOne), false);
  cancelFirst();
  t.mock.timers.tick(10);
  assert.equal(highlights.get("dexon-quote-target").has(rangeTwo), true);
  assert.equal(second.dataset.quoteFlash, "span");
  t.mock.timers.tick(20);
  assert.equal(highlights.has("dexon-quote-target"), false);
  assert.equal(second.hasAttribute("data-quote-flash"), false);
});

test("cleans up when repeated jumps switch between span and message flashes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const highlights = mockHighlightApi(t);
  const { document } = createScene(t, "<article><strong>target</strong></article>");
  const article = document.querySelector("article");
  const target = document.querySelector("strong");
  const range = locateQuoteRangeInElements([article], { text: "target" });
  const span = flashQuoteTarget({ range, fallbackElement: article, durationMs: 40 });
  t.after(span);
  const message = flashQuoteTarget({ range: null, fallbackElement: article, durationMs: 40 });
  t.after(message);
  assert.equal(highlights.size, 0);
  assert.equal(target.hasAttribute("data-quote-flash"), false);
  assert.equal(article.dataset.quoteFlash, "message");
  const nextSpan = flashQuoteTarget({ range, fallbackElement: article, durationMs: 40 });
  t.after(nextSpan);
  assert.equal(article.classList.contains("quote-target-message-flash"), false);
  assert.equal(article.hasAttribute("data-quote-flash"), false);
  assert.equal(target.dataset.quoteFlash, "span");
  t.mock.timers.tick(40);
  assert.equal(highlights.size, 0);
  assert.equal(target.hasAttribute("data-quote-flash"), false);
});

test("returns a safe cancellation function when neither a supported range nor fallback exists", (t) => {
  mockHighlightApi(t, { css: false });
  const { document } = createScene(t, "<article>target</article>");
  const article = document.querySelector("article");
  const range = locateQuoteRangeInElements([article], { text: "target" });
  for (const candidate of [null, range]) {
    const cancel = flashQuoteTarget({ range: candidate, fallbackElement: null });
    assert.equal(typeof cancel, "function");
    assert.doesNotThrow(() => {
      cancel();
      cancel();
    });
    assert.equal(article.hasAttribute("data-quote-flash"), false);
  }
});
