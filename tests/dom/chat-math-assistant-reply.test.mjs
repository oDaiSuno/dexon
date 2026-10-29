import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const { MessageView } = await loadRenderer(
  "chat-math-assistant-reply",
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
const headings = (element) => element.querySelectorAll("h1,h2,h3,h4,h5,h6");

async function openReply(t, text) {
  const view = await mount(t, MessageView, {
    message: { role: "assistant", content: [{ type: "text", text }], provider: "fixture", timestamp: 2 },
  });
  return view.container;
}

test("when a reply saved in an older conversation is shown again, its \\[…\\] block renders one display formula", async (t) => {
  const reply = await openReply(t, "首先计算第 i 个骨架的频率：\n\n\\[\nP_i=\\frac{N_{s_i}}{\\sum_jN_{s_j}}\n\\]");
  assert.equal(formulas(reply).length, 1, "the block is one formula");
  assert.equal(displayFormulas(reply).length, 1, "the formula takes its own line");
  assert.equal(errors(reply).length, 0, "no red error appears");
  assert.doesNotMatch(visibleText(reply), /\\|[[\]]|frac/, "no LaTeX source or brackets stay visible");
});

test("when a reply holds a \\[…\\] block with = on its own line, it renders one formula and no bold heading", async (t) => {
  const reply = await openReply(
    t,
    "\\[\nP_{\\mathrm{scaffold}_i}\n=\n\\operatorname{softmax}\\left(\\frac{P_i}{\\tau}\\right)\n\\]",
  );
  assert.equal(formulas(reply).length, 1, "the whole block is one formula");
  assert.equal(displayFormulas(reply).length, 1, "the formula takes its own line");
  assert.equal(headings(reply).length, 0, "no heading is invented from the line holding =");
  assert.equal(errors(reply).length, 0, "no red error appears");
});

test("when a reply writes $\\tau$ between Chinese words, the letter becomes an inline formula", async (t) => {
  const reply = await openReply(t, "当 $\\tau$ 增大时");
  assert.equal(formulas(reply).length, 1, "the letter is a formula");
  assert.equal(displayFormulas(reply).length, 0, "the formula stays inline");
  assert.equal(visibleText(reply), "当 τ 增大时");
});

for (const [shape, text] of [
  ["on one line", "$$E=mc^2$$"],
  ["as a paragraph of its own", "$$\nE=mc^2\n$$"],
]) {
  test(`when a reply writes $$…$$ ${shape}, it renders one display formula`, async (t) => {
    const reply = await openReply(t, text);
    assert.equal(formulas(reply).length, 1, "the block is one formula");
    assert.equal(displayFormulas(reply).length, 1, "the formula takes its own line");
    assert.equal(errors(reply).length, 0, "no red error appears");
  });
}

test("when a reply shows \\(x\\) as inline code and \\[1\\] as a code block, both stay literal code", async (t) => {
  const reply = await openReply(t, "`\\(x\\)`\n\n```\n\\[1\\]\n```");
  assert.equal(formulas(reply).length, 0, "code is never a formula");
  const code = [...reply.querySelectorAll("code")].map((element) => element.textContent);
  assert.ok(
    code.some((text) => text.includes("\\(x\\)")),
    "the inline code keeps its literal text",
  );
  assert.ok(
    code.some((text) => text.includes("\\[1\\]")),
    "the code block keeps its literal text",
  );
});

for (const [opener, text] of [
  ["\\[", "\\[\n\\frac{a}{"],
  ["$$", "$$\n\\frac{a}{"],
]) {
  test(`when a reply stops inside an unclosed ${opener} block, the raw text stays visible with no red error`, async (t) => {
    const reply = await openReply(t, text);
    const shown = visibleText(reply);
    assert.ok(shown.includes(opener), `the ${opener} opener stays visible`);
    assert.ok(shown.includes("\\frac{a}{"), "the formula source stays visible");
    assert.equal(errors(reply).length, 0, "no red error appears");
    assert.equal(formulas(reply).length, 0, "the unfinished block is not laid out as a formula");
  });
}
