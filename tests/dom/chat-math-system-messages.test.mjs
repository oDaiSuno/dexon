import assert from "node:assert/strict";
import test, { after } from "node:test";
import { allByRole } from "../support/dom-queries.mjs";
import { click, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";

const { MessageView } = await loadRenderer(
  "chat-math-system-messages",
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

test("when a compaction summary is expanded, its \\(…\\) and \\[…\\] formulas are laid out", async (t) => {
  const view = await mount(t, MessageView, {
    message: {
      role: "custom",
      customType: "compaction",
      display: true,
      content: "对话要点：第 \\(i\\) 个骨架的频率\n\n\\[\nP_i=\\frac{N_{s_i}}{\\sum_jN_{s_j}}\n\\]",
      timestamp: 3,
    },
  });
  const [toggle] = allByRole(view.container, "button", /Conversation compacted/);
  assert.ok(toggle, "the summary offers its expand control");
  await click(toggle);

  assert.equal(formulas(view.container).length, 2, "the inline and the display formula are both laid out");
  assert.equal(displayFormulas(view.container).length, 1, "the bracket block takes its own line");
  assert.equal(errors(view.container).length, 0, "no red error appears");
  assert.equal(headings(view.container).length, 0, "no heading is invented from the summary text");
  assert.match(visibleText(view.container), /第 i 个骨架的频率/, "the inline formula reads as the letter i");
});

test("when an extension message shows \\(…\\) and \\[…\\], both are laid out as formulas", async (t) => {
  const view = await mount(t, MessageView, {
    message: {
      role: "custom",
      customType: "extension",
      display: true,
      content: "扩展说明：第 \\(i\\) 个骨架\n\n\\[\nx^2\n\\]",
      timestamp: 4,
    },
  });

  assert.equal(formulas(view.container).length, 2, "the inline and the display formula are both laid out");
  assert.equal(displayFormulas(view.container).length, 1, "the bracket block takes its own line");
  assert.equal(errors(view.container).length, 0, "no red error appears");
});
