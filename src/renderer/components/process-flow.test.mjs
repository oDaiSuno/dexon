import assert from "node:assert/strict";
import test, { after } from "node:test";
import { button, click, text, loadRenderer, mount, restoreGlobals } from "../../../tests/support/renderer.mjs";

const { ProcessFlow, ThinkingExpansionStore } = await loadRenderer(
  "process-flow-dom",
  'export { ProcessFlow } from "./src/renderer/components/ProcessFlow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

function thinkingItem(key, text, extra = {}) {
  return { kind: "thinking", key, block: { type: "thinking", thinking: text }, blockIndex: 0, entryId: "e1", ...extra };
}

function toolItem(toolName = "bash", input = { command: "ls" }) {
  return {
    kind: "toolCall",
    key: "tc1",
    block: { type: "toolCall", toolCallId: "call-1", toolName, input },
    blockIndex: 1,
    entryId: "e1",
  };
}

test("a thinking summary opens and closes its full text", async (t) => {
  const view = await mount(t, ProcessFlow, {
    items: [thinkingItem("t1", "first line\nsecond line with details")],
    thinkingExpansionStore: new ThinkingExpansionStore(),
  });
  const toggle = button(view.container, /Deep thinking.*first line second line with details/);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.match(toggle.textContent, /first line second line with details/);
  await click(toggle);
  assert.ok(text(view.container, "first line\nsecond line with details"));
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("a tool summary opens its input details", async (t) => {
  const view = await mount(t, ProcessFlow, { items: [toolItem()] });
  const toggle = button(view.container, /Run.*ls/);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(view.container.querySelector("pre"), null);
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(JSON.parse(view.container.querySelector("pre").textContent), { command: "ls" });
});

test("process items keep their supplied order and show a running indicator", async (t) => {
  const view = await mount(t, ProcessFlow, {
    items: [
      thinkingItem("t1", "thought"),
      toolItem("grep", { pattern: "x" }),
      { kind: "text", key: "tx1", block: { type: "text", text: "checking output" } },
    ],
    thinkingExpansionStore: new ThinkingExpansionStore(),
  });
  assert.ok(text(view.container, "running"), "the active tool reports its running state");
  const summaries = view.container.querySelectorAll("button[aria-expanded]");
  assert.equal(summaries.length, 2);
  assert.match(summaries[0].textContent, /thought/);
  assert.match(summaries[1].textContent, /x/);
  const output = text(view.container, "checking output");
  assert.ok(output);
  assert.ok(summaries[1].compareDocumentPosition(output) & 4, "the text follows the thinking and tool summaries");
});
