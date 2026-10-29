import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const { MessageView } = await loadRenderer(
  "chat-math-streaming-reply",
  'export {MessageView} from "./src/renderer/components/MessageView.tsx";',
);
after(restoreGlobals);

function visibleText(element) {
  const copy = element.cloneNode(true);
  for (const source of copy.querySelectorAll(".katex-mathml")) source.remove();
  return copy.textContent.replace(/\s+/g, " ").trim();
}

const formulas = (element) => element.querySelectorAll(".katex");
const displayFormulas = (element) => element.querySelectorAll(".katex-display");
const errors = (element) => element.querySelectorAll(".katex-error");

function reply(text, isStreaming) {
  return {
    message: { role: "assistant", content: [{ type: "text", text }], provider: "fixture", timestamp: 2 },
    isStreaming,
  };
}

test("when a streaming reply opens a $$ block, the reader sees the source and no red error until it closes", async (t) => {
  const view = await mount(t, MessageView, reply("推导：\n\n$$\n", true));

  assert.ok(visibleText(view.container).includes("$$"), "the opener stays visible as source");
  assert.equal(errors(view.container).length, 0, "the open block shows no red error");
  assert.equal(formulas(view.container).length, 0, "the open block is not laid out as a formula yet");

  await view.update(reply("推导：\n\n$$\n\\frac{a}{b}\n", true));
  assert.ok(visibleText(view.container).includes("\\frac{a}{b}"), "the formula source stays visible");
  assert.equal(errors(view.container).length, 0, "the half-written formula shows no red error");
  assert.equal(formulas(view.container).length, 0, "the half-written formula is still source");

  await view.update(reply("推导：\n\n$$\n\\frac{a}{b}\n$$\n\n", true));
  assert.equal(errors(view.container).length, 0, "the finished formula shows no red error");
  assert.equal(formulas(view.container).length, 1, "the finished block is one formula");
  assert.equal(displayFormulas(view.container).length, 1, "the finished formula takes its own line");
  assert.ok(!visibleText(view.container).includes("$$"), "the closing arrives, the source no longer shows");
});

test("when a streaming reply opens a \\[ block, the reader sees the source and no red error until it closes", async (t) => {
  const view = await mount(t, MessageView, reply("再看：\n\n\\[\n", true));

  assert.ok(visibleText(view.container).includes("\\["), "the opener stays visible as source");
  assert.equal(errors(view.container).length, 0, "the open block shows no red error");
  assert.equal(formulas(view.container).length, 0, "the open block is not laid out as a formula yet");

  await view.update(reply("再看：\n\n\\[\n\\operatorname{softmax}(x)\n", true));
  assert.ok(visibleText(view.container).includes("\\operatorname{softmax}(x)"), "the formula source stays visible");
  assert.equal(errors(view.container).length, 0, "the half-written formula shows no red error");
  assert.equal(formulas(view.container).length, 0, "the half-written formula is still source");

  await view.update(reply("再看：\n\n\\[\n\\operatorname{softmax}(x)\n\\]\n\n", true));
  assert.equal(errors(view.container).length, 0, "the finished formula shows no red error");
  assert.equal(formulas(view.container).length, 1, "the finished block is one formula");
  assert.equal(displayFormulas(view.container).length, 1, "the finished formula takes its own line");
});

test("when the user stops a reply inside an unfinished $$ block, the source stays visible with no red error", async (t) => {
  const text = "推导：\n\n$$\n\\frac{a}{\n";
  const view = await mount(t, MessageView, reply(text, true));
  await view.update(reply(text, false));

  const shown = visibleText(view.container);
  assert.ok(shown.includes("$$"), "the opener stays visible as source");
  assert.ok(shown.includes("\\frac{a}{"), "the formula source stays visible");
  assert.equal(errors(view.container).length, 0, "the stopped reply shows no red error");
  assert.equal(formulas(view.container).length, 0, "the unfinished block is not laid out as a formula");
});
