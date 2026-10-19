import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./message-display.ts");
}

function assistant(content) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    content,
  };
}

const toolCall = { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} };

test("an interleaved reply becomes answer, process, answer, process, answer runs", async () => {
  const { splitAssistantBlockRuns } = await loadSubject();
  const message = assistant([
    { type: "text", text: "我先检查项目。" },
    toolCall,
    { type: "text", text: "已经找到问题所在。" },
    { type: "thinking", thinking: "分析修改方案。" },
    { type: "text", text: "这是最终结论。" },
  ]);

  const runs = splitAssistantBlockRuns(message, { isStreaming: false });

  assert.deepEqual(
    runs.map((run) => run.kind),
    ["answer", "process", "answer", "process", "answer"],
  );
  assert.deepEqual(
    runs.map((run) => run.startIndex),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    runs.filter((run) => run.kind === "answer").map((run) => run.blocks.map((block) => block.text)),
    [["我先检查项目。"], ["已经找到问题所在。"], ["这是最终结论。"]],
  );
});

test("a reply that ends on a tool call still keeps its sentence as answer content", async () => {
  const { splitAssistantBlockRuns } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "work through it" },
    { type: "text", text: "I need to call a tool." },
    toolCall,
  ]);

  const runs = splitAssistantBlockRuns(message, { isStreaming: false });

  assert.deepEqual(
    runs.map((run) => run.kind),
    ["process", "answer", "process"],
  );
  assert.deepEqual(
    runs.map((run) => run.startIndex),
    [0, 1, 2],
  );
  assert.equal(runs[1].blocks[0].type, "text");
  assert.equal(runs[1].blocks[0].text, "I need to call a tool.");
});

test("neighbouring blocks of the same kind join one run", async () => {
  const { splitAssistantBlockRuns } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "first look" },
    { type: "thinking", thinking: "second look" },
    toolCall,
    { type: "toolCall", toolCallId: "call-2", toolName: "read", input: {} },
    { type: "image", source: { type: "url", url: "https://example.com/final.png" } },
  ]);

  const runs = splitAssistantBlockRuns(message, { isStreaming: false });

  assert.deepEqual(
    runs.map((run) => run.kind),
    ["process", "answer"],
  );
  assert.deepEqual(
    runs.map((run) => run.blocks.length),
    [4, 1],
  );
  assert.deepEqual(
    runs.map((run) => run.startIndex),
    [0, 4],
  );
});

test("drops empty thinking blocks after completion", async () => {
  const { getDisplayableAssistantBlocks, splitAssistantBlockRuns } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "" },
    { type: "text", text: "Final answer" },
  ]);

  assert.deepEqual(
    getDisplayableAssistantBlocks(message, { isStreaming: false }).map((block) => block.type),
    ["text"],
  );

  const runs = splitAssistantBlockRuns(message, { isStreaming: false });
  assert.deepEqual(
    runs.map((run) => run.kind),
    ["answer"],
  );
  assert.equal(runs[0].startIndex, 1);
  assert.deepEqual(
    runs[0].blocks.map((block) => block.type),
    ["text"],
  );
});

test("keeps empty thinking while streaming", async () => {
  const { splitAssistantBlockRuns } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "" },
    { type: "text", text: "Partial answer" },
  ]);

  const runs = splitAssistantBlockRuns(message, { isStreaming: true });

  assert.deepEqual(
    runs.map((run) => run.kind),
    ["process", "answer"],
  );
  assert.deepEqual(
    runs.map((run) => run.blocks.map((block) => block.type)),
    [["thinking"], ["text"]],
  );
});

test("keeps an empty failed assistant message renderable and exposes its provider detail", async () => {
  const { getAssistantFailureDetail, hasRenderableAssistantMessage, isAssistantFailure } = await loadSubject();
  const message = {
    ...assistant([]),
    stopReason: "error",
    errorMessage: "401: invalid API key",
  };

  assert.equal(isAssistantFailure(message), true);
  assert.equal(getAssistantFailureDetail(message), "401: invalid API key");
  assert.equal(hasRenderableAssistantMessage(message), true);
  assert.equal(hasRenderableAssistantMessage(assistant([])), false);
});

test("renders a generic failure state when the provider omits error detail", async () => {
  const { getAssistantFailureDetail, hasRenderableAssistantMessage } = await loadSubject();
  const message = { ...assistant([]), stopReason: "error", errorMessage: "   " };

  assert.equal(getAssistantFailureDetail(message), null);
  assert.equal(hasRenderableAssistantMessage(message), true);
});
