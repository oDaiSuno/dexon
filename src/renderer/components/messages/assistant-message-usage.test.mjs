import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadRenderer, mount, restoreGlobals } from "../../../../tests/support/renderer.mjs";

const { AssistantMessageView } = await loadRenderer(
  "assistant-message-usage-dom",
  'export { AssistantMessageView } from "./src/renderer/components/messages/AssistantMessage.tsx";',
);
after(restoreGlobals);

const baseMessage = {
  role: "assistant",
  provider: "acme",
  model: "flash-9",
  timestamp: Date.parse("2026-01-01T00:00:05.000Z"),
  content: [{ type: "text", text: "answer" }],
  usage: { input: 1234, output: 567, cost: { total: 0.0042 } },
  stopReason: "end_turn",
};

test("compact messages omit the per-message usage and copy action", async (t) => {
  const view = await mount(t, AssistantMessageView, { message: baseMessage, compact: true });
  assert.doesNotMatch(view.container.textContent, /1,234 in/);
  assert.doesNotMatch(view.container.textContent, /0\.0042/);
  assert.equal(view.container.querySelector('button[title="Copy message"]'), null);
});

test("streaming messages do not display completed usage", async (t) => {
  const view = await mount(t, AssistantMessageView, { message: baseMessage, isStreaming: true });
  assert.doesNotMatch(view.container.textContent, /1,234 in/);
});

test("streaming messages show a live token estimate", async (t) => {
  const view = await mount(t, AssistantMessageView, { message: baseMessage, isStreaming: true });
  assert.match(view.container.textContent, /\d[\d,]*\s+tok/);
});
