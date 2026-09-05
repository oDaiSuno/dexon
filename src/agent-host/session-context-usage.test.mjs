import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const { computeSessionContextUsage, reconstructSessionContextUsage } = await importTestBundle(
  "src/agent-host/session-context-usage",
  {
    packages: "external",
    entryPoints: [path.join(import.meta.dirname, "session-context-usage.ts")],
  },
);
const { estimateTokens } = await import("@earendil-works/pi-coding-agent");

const TIMESTAMP = "2026-08-17T00:00:00.000Z";
const CONTEXT_WINDOW = 1000;

function usage(input, output = 0) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(overrides = {}) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "reply" }],
    provider: "provider",
    model: "model",
    stopReason: "stop",
    timestamp: 2,
    ...overrides,
  };
}

function userMessage(text) {
  return { role: "user", content: text, timestamp: 1 };
}

function messageEntry(id, parentId, message) {
  return { type: "message", id, parentId, timestamp: TIMESTAMP, message };
}

function compactionEntry(id, parentId) {
  return { type: "compaction", id, parentId, timestamp: TIMESTAMP, summary: "summary", tokensBefore: 350 };
}

test("counts the last valid assistant usage plus trailing estimates", () => {
  const trailing = userMessage("follow-up");
  const messages = [userMessage("hi"), assistantMessage({ usage: usage(300, 50) }), trailing];
  const result = computeSessionContextUsage({ messages, branchEntries: [], contextWindow: CONTEXT_WINDOW });
  assert.equal(result.tokens, 350 + estimateTokens(trailing));
  assert.equal(result.contextWindow, CONTEXT_WINDOW);
  assert.ok(Math.abs(result.percent - (result.tokens / CONTEXT_WINDOW) * 100) < 1e-9);
});

test("estimates every message when no assistant usage exists", () => {
  const messages = [userMessage("hi"), assistantMessage({ usage: undefined })];
  const result = computeSessionContextUsage({ messages, branchEntries: [], contextWindow: CONTEXT_WINDOW });
  assert.equal(result.tokens > 0, true);
  assert.ok(Math.abs(result.percent - (result.tokens / CONTEXT_WINDOW) * 100) < 1e-9);
});

test("skips aborted and error assistant usage when trusting the last response", () => {
  const aborted = assistantMessage({ usage: usage(9999), stopReason: "aborted" });
  const messages = [assistantMessage({ usage: usage(300) }), aborted];
  const result = computeSessionContextUsage({ messages, branchEntries: [], contextWindow: CONTEXT_WINDOW });
  // The aborted message still sits after the last trusted usage and is
  // estimated like any other trailing message.
  assert.equal(result.tokens, 300 + estimateTokens(aborted));
});

test("returns unknown usage without a context window instead of guessing one", () => {
  const messages = [assistantMessage({ usage: usage(300) })];
  for (const contextWindow of [undefined, null, 0]) {
    const result = computeSessionContextUsage({ messages, branchEntries: [], contextWindow });
    assert.equal(result, null);
  }
});

test("reports unknown usage after compaction until a post-compaction response exists", () => {
  const entries = [
    messageEntry("e0", null, userMessage("hi")),
    messageEntry("e1", "e0", assistantMessage({ usage: usage(300) })),
    compactionEntry("e2", "e1"),
  ];
  // Post-compaction context: the summary plus only fresh non-assistant turns.
  const messages = [{ role: "compactionSummary", summary: "summary", timestamp: 3 }, userMessage("continue")];
  const result = computeSessionContextUsage({ messages, branchEntries: entries, contextWindow: CONTEXT_WINDOW });
  assert.deepEqual(result, { tokens: null, percent: null, contextWindow: CONTEXT_WINDOW });
});

test("resumes counting once an assistant responds after the compaction boundary", () => {
  const entries = [
    messageEntry("e0", null, userMessage("hi")),
    messageEntry("e1", "e0", assistantMessage({ usage: usage(300) })),
    compactionEntry("e2", "e1"),
    messageEntry("e3", "e2", userMessage("continue")),
    messageEntry("e4", "e3", assistantMessage({ usage: usage(180, 20) })),
  ];
  const messages = [
    { role: "compactionSummary", summary: "summary", timestamp: 3 },
    userMessage("continue"),
    assistantMessage({ usage: usage(180, 20) }),
  ];
  const result = computeSessionContextUsage({ messages, branchEntries: entries, contextWindow: CONTEXT_WINDOW });
  assert.equal(result.tokens, 200);
  assert.equal(result.percent, 20);
});

test("reconstruction glues the session manager to the shared computation", async () => {
  const messages = [userMessage("hi"), assistantMessage({ usage: usage(300, 50) })];
  const branchEntries = [messageEntry("e0", null, userMessage("hi")), messageEntry("e1", "e0", messages[1])];
  const manager = {
    buildSessionContext: () => ({ messages, thinkingLevel: "off", model: { provider: "p", modelId: "m" } }),
    getBranch: () => branchEntries,
  };
  const result = await reconstructSessionContextUsage({
    manager,
    resolveContextWindow: async (model) => (model?.provider === "p" ? CONTEXT_WINDOW : null),
  });
  assert.equal(result.tokens, 350);

  const unknownModel = await reconstructSessionContextUsage({
    manager: { ...manager, buildSessionContext: () => ({ messages, thinkingLevel: "off", model: null }) },
    resolveContextWindow: async () => null,
  });
  assert.equal(unknownModel, null);
});
