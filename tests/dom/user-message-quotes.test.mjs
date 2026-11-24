import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRef } from "react";
import { installRendererApi } from "../support/renderer-api.mjs";
import {
  act,
  button,
  click,
  dom,
  hover,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../support/renderer.mjs";

const api = await loadRenderer(
  "user-message-quotes",
  `import {createElement} from "react";
   import {UserMessageView} from "./src/renderer/components/messages/UserMessage.tsx";
   import {useMessageEdit} from "./src/renderer/components/messages/user-message-editor.tsx";
   export {UserMessageView};
   export function EditingMessage(props) {
     const edit = useMessageEdit({environmentId: "primary", sendMessage: props.sendMessage});
     return createElement(UserMessageView, {...props, ...edit});
   }
   export { ChatInput } from "./src/renderer/components/ChatInput.tsx";
   export { recallablePrompts } from "./src/renderer/components/chat-input/prompt-history.ts";`,
);
api.setAppLanguage("en-US");
after(restoreGlobals);

const quoteText = "First line of the complete selected reply.\nSecond line stays verbatim, including @private/file.ts.";
const content = `<quotes>\n<quote id="1" from="assistant" entry="source">\n${quoteText}\n</quote>\n</quotes>\n\nExplain [quote:1] alongside @src/main.ts`;
const props = {
  environmentId: "primary",
  entryId: "question",
  message: { role: "user", content, timestamp: 1 },
};

test("a sent quote shares a paragraph with a file chip without showing its envelope", async (t) => {
  const view = await mount(t, api.UserMessageView, props);
  const paragraph = view.container.querySelector("p");
  assert.ok(paragraph?.querySelector(".quote-chip"), "the quote is an inline chip");
  assert.ok(paragraph.querySelector(".token-chip"), "the file stays an inline chip");
  assert.ok(!view.container.textContent.includes("<quotes>"));
  assert.ok(!view.container.textContent.includes("[quote:1]"));
  assert.ok(!view.container.textContent.includes("private/file.ts"));
});

test("copying a quoted message produces readable text with no XML or coordinates", async (t) => {
  const copies = [];
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(value) {
        copies.push(value);
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
  const view = await mount(t, api.UserMessageView, props);
  await click(button(view.container, "Copy message"));
  assert.deepEqual(copies, [`Explain 「${quoteText}」 alongside @src/main.ts`]);
});

test("hovering and clicking a detached quote always offers the full preserved source", async (t) => {
  const view = await mount(t, api.UserMessageView, { ...props, detachedQuoteKeys: new Set(["question:1"]) });
  const chip = view.container.querySelector(".quote-chip");
  await hover(chip);
  assert.equal(dom.window.document.querySelector(".quote-preview-card"), null);
  await waitFor(() => assert.equal(dom.window.document.querySelector(".quote-preview-text")?.textContent, quoteText));
  assert.match(
    dom.window.document.querySelector(".quote-preview-card").textContent,
    /Source message is not in this branch · Full quote preserved/,
  );
  await click(chip);
  await act(async () => chip.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true })));
  await keyDown(chip, "Escape");
  assert.equal(dom.window.document.querySelector(".quote-preview-card"), null);
  await click(chip);
  assert.equal(dom.window.document.querySelector(".quote-preview-text").textContent, quoteText);
  await click(dom.window.document.body);
  assert.equal(dom.window.document.querySelector(".quote-preview-card"), null);
});

test("quote activation supplies the source and chip anchor and shows locating feedback", async (t) => {
  const jumps = [];
  const view = await mount(t, api.UserMessageView, { ...props, onJumpQuote: (...args) => jumps.push(args) });
  const chip = view.container.querySelector(".quote-chip");
  await click(chip);
  assert.deepEqual(jumps[0][0], { id: "1", from: "assistant", entryId: "source", text: quoteText });
  assert.equal(jumps[0][1], chip);
  assert.equal(jumps[0][2], "question");
  await view.update({ ...props, jumpingQuoteKey: "question:1" });
  assert.equal(view.container.querySelector(".quote-chip").getAttribute("aria-busy"), "true");
  assert.ok(view.container.querySelector(".quote-chip-loader"));
  assert.equal(view.container.querySelector(".quote-chip-arrow"), null);
});

test("editing restores an atomic quote and saving delivers a clean quote envelope", async (t) => {
  const sent = [];
  const view = await mount(t, api.EditingMessage, { ...props, sendMessage: async (...args) => sent.push(args) });
  await click(button(view.container, "Edit"));
  const editor = view.container.querySelector('[role="textbox"]');
  assert.ok(editor.querySelector("[data-quote-token]"));
  assert.equal(editor.querySelectorAll("[data-attachment-token]").length, 1);
  assert.ok(!editor.textContent.includes("<quotes>"));
  await hover(editor.querySelector("[data-quote-token]"));
  await waitFor(() => assert.equal(dom.window.document.querySelector(".quote-preview-text")?.textContent, quoteText));
  await click(button(view.container, "Send"));
  assert.deepEqual(sent, [["question", content, []]]);
  assert.equal(view.container.querySelector('[role="textbox"]'), null);
});

for (const body of ["", "No placeholder", "Unknown [quote:9]"]) {
  test(`an unreferenced quote remains readable with body ${JSON.stringify(body)}`, async (t) => {
    const message = { ...props.message, content: content.replace("Explain [quote:1] alongside @src/main.ts", body) };
    const view = await mount(t, api.UserMessageView, { ...props, message });
    assert.equal(view.container.querySelectorAll(".quote-chip").length, 1);
    assert.ok(!view.container.textContent.includes("<quotes>"));
    if (body) assert.ok(view.container.textContent.includes(body));
  });
}

let nextDraft = 0;
async function composer(t, options = {}) {
  const boundary = installRendererApi(dom.window, api, () => ({
    call(method) {
      if (method === "skills.list") return { skills: [] };
      if (method === "files.index") return { files: [], truncated: false };
      throw new Error(`Unexpected quote Host request: ${method}`);
    },
  }));
  const ref = createRef();
  const view = await mount(
    t,
    api.ChatInput,
    {
      ref,
      environmentId: "primary",
      draftKey: `dom-quotes-${++nextDraft}`,
      cwd: "/workspace",
      isStreaming: false,
      onAbort() {},
      onSend() {},
      ...options,
    },
    { release: boundary.close },
  );
  return { ...view, ref };
}

test("inserting at the composer caret sends an envelope and a rejection restores the exact quote chip", async (t) => {
  const sent = [];
  const jumps = [];
  const view = await composer(t, {
    onSend: (message) => {
      sent.push(message);
      return { ok: false };
    },
    onJumpQuote: (...args) => jumps.push(args),
  });
  const quote = { id: "original", from: "assistant", entryId: "source", text: quoteText };
  await act(async () => {
    view.ref.current.insertText("Explain");
    view.ref.current.insertQuoteAtCaret(quote);
  });
  const editor = view.container.querySelector('[role="textbox"]');
  const chip = editor.querySelector("[data-quote-token]");
  assert.ok(chip);
  await click(chip);
  assert.deepEqual(jumps[0], [quote, chip]);
  await click(button(view.container, "Send"));
  assert.deepEqual(sent, [content.replace("Explain [quote:1] alongside @src/main.ts", "Explain [quote:1]")]);
  assert.ok(editor.querySelector("[data-quote-token]"));
  assert.equal(editor.querySelector("[data-quote-token]").dataset.quotePayload, chip.dataset.quotePayload);
  await click(editor.querySelector("[data-chip-remove]"));
  assert.equal(editor.querySelector("[data-quote-token]"), null);
  assert.equal(editor.textContent, "Explain ");
});

test("ArrowUp recalls sent quote envelopes as atomic chips rather than XML", async (t) => {
  const view = await composer(t, { promptHistory: api.recallablePrompts([props.message]) });
  const editor = view.container.querySelector('[role="textbox"]');
  await keyDown(editor, "ArrowUp");
  assert.ok(editor.querySelector("[data-quote-token]"));
  assert.equal(editor.querySelectorAll("[data-attachment-token]").length, 1);
  assert.ok(!editor.textContent.includes("<quotes>"));
});

test("queuing a quote sends an envelope instead of leaking its editor payload", async (t) => {
  const queued = [];
  const view = await composer(t, { isStreaming: true, onFollowUp: (message) => queued.push(message) });
  await act(async () =>
    view.ref.current.insertQuoteAtCaret({ id: "fresh", from: "assistant", entryId: "source", text: quoteText }),
  );
  await keyDown(view.container.querySelector('[role="textbox"]'), "Enter");
  assert.deepEqual(queued, [content.replace("Explain [quote:1] alongside @src/main.ts", "[quote:1]")]);
});
