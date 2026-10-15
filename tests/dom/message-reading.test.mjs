import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, text, loadRenderer, mount, createElement, restoreGlobals } from "../support/renderer.mjs";

const { MarkdownBody, MessageView } = await loadRenderer(
  "message-reading-behavior",
  'export {MarkdownBody} from "./src/renderer/components/MarkdownBody.tsx"; export {MessageView} from "./src/renderer/components/MessageView.tsx";',
);
after(restoreGlobals);

function selectContents(element) {
  const range = dom.window.document.createRange();
  range.selectNodeContents(element);
  const selection = dom.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

// Public behavior: appending content must not discard text the reader has
// already selected. Component-map identity and React.memo are not the rule.
for (const [name, markdown, selector] of [
  ["inline code", "Read `select me` first.", "code"],
  ["code block", "```\nselect me\n```", "pre code"],
  ["link", "[select me](https://example.test)", "a"],
  ["table", "| Result |\n| --- |\n| select me |", "td"],
]) {
  test(`appending markdown preserves the reader's selected ${name}`, async (t) => {
    const view = await mount(t, MarkdownBody, { children: markdown });
    const selected = view.container.querySelector(selector);
    assert.ok(selected);
    const selection = selectContents(selected);
    assert.match(selection.toString(), /select me/);
    await view.update({ children: `${markdown}\n\nA newly arrived paragraph.` });
    assert.match(view.container.textContent, /A newly arrived paragraph\./);
    assert.match(selection.toString(), /select me/);
  });
}

test("new transcript content preserves text selected in an unchanged historical message", async (t) => {
  const message = { role: "user", content: "select this historical text" };
  function Transcript({ revision }) {
    return createElement(
      "section",
      null,
      createElement(MessageView, { message }),
      createElement("p", { "aria-label": "New content" }, `New content ${revision}`),
    );
  }
  const view = await mount(t, Transcript, { revision: 1 });
  const selection = selectContents(text(view.container, "select this historical text"));
  assert.equal(selection.toString(), "select this historical text");
  await view.update({ revision: 2 });
  assert.match(view.container.textContent, /New content 2/);
  assert.equal(selection.toString(), "select this historical text");
});
