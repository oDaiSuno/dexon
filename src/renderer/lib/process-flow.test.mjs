import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./process-flow.ts");
}

const keyFor = (message, entryId) => `k:${entryId ?? "local"}`;

function assistant(content, extra = {}) {
  return { role: "assistant", provider: "test", model: "test-model", content, ...extra };
}

test("formatTurnDuration renders compact seconds/minutes/hours", async () => {
  const { formatTurnDuration } = await loadSubject();
  assert.equal(formatTurnDuration(42), "42s");
  assert.equal(formatTurnDuration(131), "2m11s");
  assert.equal(formatTurnDuration(3599), "59m59s");
  assert.equal(formatTurnDuration(3661), "1h1m");
  assert.equal(formatTurnDuration(0), "0s");
  assert.equal(formatTurnDuration(-5), "0s");
});

test("computeTurnDurationSeconds needs both timestamps and a positive gap", async () => {
  const { computeTurnDurationSeconds } = await loadSubject();
  assert.equal(computeTurnDurationSeconds(1000, 132_000), 131);
  assert.equal(computeTurnDurationSeconds(undefined, 132_000), undefined);
  assert.equal(computeTurnDurationSeconds(1000, undefined), undefined);
  assert.equal(computeTurnDurationSeconds(2000, 1000), undefined);
});

test("flattens thinking/toolCall/text interleaved across messages in original order", async () => {
  const { buildProcessFlowItems } = await loadSubject();
  const first = assistant(
    [
      { type: "thinking", thinking: "first thought" },
      { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
    ],
    { timestamp: 10_000 },
  );
  const second = assistant(
    [
      { type: "text", text: "checking" },
      { type: "thinking", thinking: "second thought" },
    ],
    {
      timestamp: 20_000,
    },
  );
  const result = buildProcessFlowItems(
    [
      {
        message: first,
        entryId: "e1",
        prevTimestamp: 5_000,
        toolData: { results: new Map(), durations: new Map([["call-1", 3]]) },
      },
      { message: second, entryId: "e2", prevTimestamp: 12_000 },
    ],
    keyFor,
  );

  assert.deepEqual(
    result.items.map((item) => item.kind),
    ["thinking", "toolCall", "text", "thinking"],
  );
  assert.equal(result.messageCount, 2);
  assert.equal(result.toolCallCount, 1);
  const [thinking, toolCall] = result.items;
  assert.equal(thinking.kind === "thinking" && thinking.duration, 5);
  assert.equal(toolCall.kind === "toolCall" && toolCall.duration, 3);
});

test("empty thinking/text blocks are skipped but keep their original block index", async () => {
  const { buildProcessFlowItems } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "  " },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
    { type: "text", text: "" },
  ]);
  const result = buildProcessFlowItems([{ message, entryId: "e1" }], keyFor);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, "toolCall");
  assert.equal(result.items[0].kind === "toolCall" && result.items[0].blockIndex, 1);
});

test("final message block subset uses subset indices and counts toward totals", async () => {
  const { buildProcessFlowItems } = await loadSubject();
  const finalBlocks = [
    { type: "thinking", thinking: "final thought" },
    { type: "toolCall", toolCallId: "call-9", toolName: "edit", input: {} },
  ];
  const finalMessage = assistant(finalBlocks, { timestamp: 30_000 });
  const result = buildProcessFlowItems(
    [{ message: finalMessage, blocks: finalBlocks, entryId: "ef", prevTimestamp: 25_000 }],
    keyFor,
  );

  assert.equal(result.messageCount, 1);
  assert.equal(result.toolCallCount, 1);
  const thinking = result.items[0];
  assert.ok(thinking.kind === "thinking");
  assert.equal(thinking.blockIndex, 0);
  assert.equal(thinking.duration, 5);
});

test("custom messages always contribute one item", async () => {
  const { buildProcessFlowItems } = await loadSubject();
  const custom = { role: "custom", customType: "note", content: "hello", display: true };
  const result = buildProcessFlowItems([{ message: custom, entryId: "e1" }], keyFor);

  assert.equal(result.messageCount, 1);
  assert.deepEqual(
    result.items.map((item) => item.kind),
    ["custom"],
  );
});
