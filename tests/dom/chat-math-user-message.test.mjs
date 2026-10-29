import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const { MessageView } = await loadRenderer(
  "chat-math-user-message",
  'export {MessageView} from "./src/renderer/components/MessageView.tsx";',
);
after(restoreGlobals);

const CWD = "/workspace/project";

function visibleText(element) {
  const copy = element.cloneNode(true);
  for (const source of copy.querySelectorAll(".katex-mathml")) source.remove();
  return copy.textContent.replace(/\s+/g, " ").trim();
}

const formulas = (element) => element.querySelectorAll(".katex");
const displayFormulas = (element) => element.querySelectorAll(".katex-display");

async function openSentMessage(t, content) {
  const view = await mount(t, MessageView, { message: { role: "user", content, timestamp: 1 }, cwd: CWD });
  const sentences = [...view.container.querySelectorAll("p")];
  assert.ok(sentences.length > 0, "the sent message shows its text");
  return { container: view.container, sentences };
}

test("when the user sends 第 \\(i\\) 个骨架, the bubble shows one inline i with no parentheses or backslashes", async (t) => {
  const { container, sentences } = await openSentMessage(t, "第 \\(i\\) 个骨架");
  assert.equal(sentences.length, 1, "the sentence stays one paragraph");
  assert.equal(formulas(sentences[0]).length, 1, "the marker is a formula");
  assert.equal(displayFormulas(container).length, 0, "the formula stays inline");
  assert.equal(visibleText(sentences[0]), "第 i 个骨架");
});

test("when the user writes \\(x\\) in a blockquote, a list item and a table cell, each place shows the formula", async (t) => {
  const { container } = await openSentMessage(
    t,
    "> 引用 \\(a+b\\)\n\n- 项 \\(x\\)\n\n| 项 | 值 |\n| --- | --- |\n| \\(x\\) | 1 |",
  );
  for (const [where, selector] of [
    ["blockquote", "blockquote"],
    ["list item", "li"],
    ["table cell", "td"],
  ]) {
    const holder = container.querySelector(selector);
    assert.ok(holder, `the message shows a ${where}`);
    assert.equal(formulas(holder).length, 1, `the ${where} shows its formula`);
    assert.equal(displayFormulas(holder).length, 0, `the ${where} formula stays inline`);
  }
  assert.equal(formulas(container).length, 3, "no other text turns into a formula");
});

test("when the user writes 见 \\[x^2\\] 处, the formula stays inline inside the sentence", async (t) => {
  const { container, sentences } = await openSentMessage(t, "见 \\[x^2\\] 处");
  assert.equal(sentences.length, 1, "the sentence stays one paragraph");
  assert.equal(formulas(sentences[0]).length, 1, "the bracket pair holds a formula");
  assert.equal(displayFormulas(container).length, 0, "the formula does not take a line of its own");
  assert.doesNotMatch(visibleText(container), /\\|[[\]]/, "no LaTeX or brackets stay visible");
});

test("when the user sends 价格是 $5，打折后 $3。, it stays plain text with both dollar signs", async (t) => {
  const { container, sentences } = await openSentMessage(t, "价格是 $5，打折后 $3。");
  assert.equal(formulas(container).length, 0, "prices are not formulas");
  assert.deepEqual(
    sentences.map((sentence) => visibleText(sentence)),
    ["价格是 $5，打折后 $3。"],
  );
});

test("when the user sends $20,000 到 $30,000 and $100-$200, both stay plain text", async (t) => {
  const { container, sentences } = await openSentMessage(t, "$20,000 到 $30,000\n\n$100-$200");
  assert.equal(formulas(container).length, 0, "prices and ranges are not formulas");
  assert.deepEqual(
    sentences.map((sentence) => visibleText(sentence)),
    ["$20,000 到 $30,000", "$100-$200"],
  );
});
