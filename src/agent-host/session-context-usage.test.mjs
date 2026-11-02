import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const { computeSessionContextUsage, describeLiveContextUsage, describeStoredContextUsage } = await importTestBundle(
  "src/agent-host/session-context-usage",
  {
    packages: "external",
    entryPoints: [path.join(import.meta.dirname, "session-context-usage.ts")],
  },
);
const { branchAt, withBranchModelChoice } = await importTestBundle("src/agent-host/session-branch", {
  packages: "external",
  entryPoints: [path.join(import.meta.dirname, "session-branch.ts")],
});
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

test("reconstruction restores usage from a branch with an assistant-signed model", async () => {
  const entries = [
    messageEntry("e0", null, userMessage("hi")),
    messageEntry("e1", "e0", assistantMessage({ usage: usage(300, 50) })),
  ];
  const branch = branchAt(entries);
  const result = await describeStoredContextUsage({
    branch,
    resolveContextWindow: async (model) => (model?.provider === "provider" ? CONTEXT_WINDOW : null),
  });
  assert.deepEqual(result, { tokens: 350, contextWindow: CONTEXT_WINDOW, percent: 35 });

  const unknownModel = await describeStoredContextUsage({
    branch,
    resolveContextWindow: async () => null,
  });
  assert.equal(unknownModel, null);
});

function modelEntry(id, parentId, modelId) {
  return { type: "model_change", id, parentId, timestamp: TIMESTAMP, provider: "provider", modelId };
}

test("a branch exposes only its latest chosen and signed models with duplicate references removed", () => {
  const entries = [
    modelEntry("m0", null, "old-model"),
    messageEntry("e0", "m0", assistantMessage({ model: "old-signature" })),
    modelEntry("m1", "e0", "chosen-model"),
    messageEntry("e1", "m1", assistantMessage({ model: "signed-model" })),
  ];
  const branch = branchAt(entries);
  assert.deepEqual(branch.model, { provider: "provider", modelId: "chosen-model" });
  assert.deepEqual(branch.modelCandidates, [
    { provider: "provider", modelId: "chosen-model" },
    { provider: "provider", modelId: "signed-model" },
  ]);
  const sameModel = branchAt([...entries, modelEntry("m2", "e1", "signed-model")]);
  assert.deepEqual(sameModel.modelCandidates, [{ provider: "provider", modelId: "signed-model" }]);
  const live = withBranchModelChoice(branch, {
    model: { provider: "provider", modelId: "signed-model" },
    thinkingLevel: "off",
  });
  assert.deepEqual(live.modelCandidates, [
    { provider: "provider", modelId: "signed-model" },
    { provider: "provider", modelId: "chosen-model" },
  ]);
});

test("reconstruction prefers the chosen catalog model over the assistant signature", async () => {
  const branch = branchAt([
    modelEntry("m0", null, "catalog-model"),
    messageEntry("e0", "m0", userMessage("hi")),
    messageEntry("e1", "e0", assistantMessage({ model: "proxy-signature", usage: usage(300, 50) })),
  ]);
  const windows = { "catalog-model": 1000, "proxy-signature": 2000 };
  const result = await describeStoredContextUsage({
    branch,
    resolveContextWindow: async (model) => windows[model?.modelId] ?? null,
  });
  assert.deepEqual(result, { tokens: 350, contextWindow: 1000, percent: 35 });
});

test("reconstruction falls back to the assistant signature when the chosen model is absent from the catalog", async () => {
  const branch = branchAt([
    modelEntry("m0", null, "removed-model"),
    messageEntry("e0", "m0", userMessage("hi")),
    messageEntry("e1", "e0", assistantMessage({ usage: usage(300, 50) })),
  ]);
  const result = await describeStoredContextUsage({
    branch,
    resolveContextWindow: async (model) => (model?.modelId === "model" ? CONTEXT_WINDOW : null),
  });
  assert.deepEqual(result, { tokens: 350, contextWindow: CONTEXT_WINDOW, percent: 35 });
});

test("reconstruction ignores non-positive windows and returns unknown when neither model resolves", async () => {
  const branch = branchAt([
    modelEntry("m0", null, "catalog-model"),
    messageEntry("e0", "m0", assistantMessage({ usage: usage(300, 50) })),
  ]);
  for (const unavailable of [undefined, null, 0, -1, NaN]) {
    const result = await describeStoredContextUsage({
      branch,
      resolveContextWindow: async (model) => (model?.modelId === "model" ? CONTEXT_WINDOW : unavailable),
    });
    assert.deepEqual(result, { tokens: 350, contextWindow: CONTEXT_WINDOW, percent: 35 });
    assert.equal(await describeStoredContextUsage({ branch, resolveContextWindow: async () => unavailable }), null);
  }
});

test("reconstruction uses the requested branch's model and usage instead of the newest branch", async () => {
  const entries = [
    modelEntry("m0", null, "original-model"),
    messageEntry("e0", "m0", userMessage("hi")),
    messageEntry("e1", "e0", assistantMessage({ usage: usage(300, 50) })),
    modelEntry("m1", "e0", "other-model"),
    messageEntry("e2", "m1", assistantMessage({ model: "other-model", usage: usage(700, 100) })),
    compactionEntry("e3", "e2"),
  ];
  const windows = { "original-model": 1000, "other-model": 2000 };
  const resolveContextWindow = async (model) => windows[model?.modelId] ?? null;
  const result = await describeStoredContextUsage({ branch: branchAt(entries, "e1"), resolveContextWindow });
  assert.deepEqual(result, { tokens: 350, contextWindow: 1000, percent: 35 });
  const compacted = await describeStoredContextUsage({ branch: branchAt(entries), resolveContextWindow });
  assert.deepEqual(compacted, { tokens: null, contextWindow: 2000, percent: null });
});

test("reconstruction respects a live model choice without changing the recorded branch", async () => {
  const branch = branchAt([
    modelEntry("m0", null, "original-model"),
    messageEntry("e0", "m0", assistantMessage({ usage: usage(300, 50) })),
  ]);
  const windows = { "original-model": 1000, "live-model": 2000 };
  const resolveContextWindow = async (model) => windows[model?.modelId] ?? null;
  const live = withBranchModelChoice(branch, {
    model: { provider: "provider", modelId: "live-model" },
    thinkingLevel: "high",
  });
  assert.deepEqual(await describeStoredContextUsage({ branch: live, resolveContextWindow }), {
    tokens: 350,
    contextWindow: 2000,
    percent: 17.5,
  });
  assert.deepEqual(await describeStoredContextUsage({ branch, resolveContextWindow }), {
    tokens: 350,
    contextWindow: 1000,
    percent: 35,
  });
});

test("reconstruction returns unknown for an empty root branch instead of using the latest reply", async () => {
  const entries = [messageEntry("e0", null, assistantMessage({ usage: usage(300, 50) }))];
  for (const branch of [branchAt(entries, null), branchAt([])]) {
    assert.equal(await describeStoredContextUsage({ branch, resolveContextWindow: async () => CONTEXT_WINDOW }), null);
  }
});

test("reconstruction terminates cyclic parent links without mutating persisted entries", async () => {
  const entries = [
    messageEntry("e0", "e1", userMessage("hi")),
    messageEntry("e1", "e0", assistantMessage({ usage: usage(300, 50) })),
  ];
  const persisted = structuredClone(entries);
  const result = await describeStoredContextUsage({
    branch: branchAt(entries, "e1"),
    resolveContextWindow: async () => CONTEXT_WINDOW,
  });
  assert.deepEqual(result, { tokens: 350, contextWindow: CONTEXT_WINDOW, percent: 35 });
  assert.deepEqual(entries, persisted);
});

function recordedSystem() {
  return {
    role: "system",
    content: "",
    sections: { preamble: "p".repeat(798), project_context: "a".repeat(400) },
    toolsAdded: [{ name: "read", description: "Read a file", parameters: { type: "object" } }],
    timestamp: 0,
  };
}

function liveSession({ tokens = 2000, autoCompaction = true } = {}) {
  return {
    profile: "agent",
    usage: { tokens, contextWindow: 10_000, percent: tokens === null ? null : tokens / 100 },
    ...(autoCompaction ? { reserveTokens: 1600 } : {}),
    messages: [
      recordedSystem(),
      userMessage("u".repeat(400)),
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "read",
        content: [{ type: "text", text: "r".repeat(1200) }],
      },
    ],
  };
}

test("a live session's usage is split into system prompt, tools, AGENTS.md and skills, conversation and tool results that add up to the used total", () => {
  const result = describeLiveContextUsage(liveSession());
  assert.equal(result.tokens, 2000);
  assert.equal(result.contextWindow, 10_000);
  assert.equal(result.reserveTokens, 1600);
  assert.deepEqual(result.breakdown, {
    systemPrompt: 200,
    tools: 19,
    agentsAndSkills: 100,
    conversation: 420,
    toolResults: 1261,
  });
});

test("a live session with automatic compaction turned off reports no compaction reserve", () => {
  const result = describeLiveContextUsage(liveSession({ autoCompaction: false }));
  assert.equal("reserveTokens" in result, false);
  assert.equal(result.breakdown.systemPrompt, 200);
});

test("right after compaction a live session has no split to show, only the reserve and the window", () => {
  const result = describeLiveContextUsage(liveSession({ tokens: null }));
  assert.equal(result.tokens, null);
  assert.equal(result.reserveTokens, 1600);
  assert.equal("breakdown" in result, false);
});

test("stored context omits a context-edited message without deleting raw history", async () => {
  const entries = [
    messageEntry("u", null, userMessage("x".repeat(400))),
    messageEntry("a", "u", assistantMessage()),
    { type: "context_edit", id: "edit", parentId: "a", timestamp: TIMESTAMP, targetId: "u", replacement: null },
  ];
  const persisted = structuredClone(entries);
  const result = await describeStoredContextUsage({
    branch: branchAt(entries),
    resolveContextWindow: async () => CONTEXT_WINDOW,
  });
  assert.deepEqual(result, { tokens: 2, contextWindow: CONTEXT_WINDOW, percent: 0.2 });
  assert.deepEqual(entries, persisted);
});

test("live breakdown never attributes system records to conversation", () => {
  const source = liveSession();
  source.messages.unshift(recordedSystem());
  assert.deepEqual(describeLiveContextUsage(source).breakdown, {
    systemPrompt: 200,
    tools: 19,
    agentsAndSkills: 100,
    conversation: 420,
    toolResults: 1261,
  });
});

test("live breakdown replays prompt section replacements and removed tools", () => {
  const source = liveSession();
  source.messages[0] = {
    role: "system",
    content: "",
    sections: { preamble: "old prompt", project_context: "old instructions" },
    toolsAdded: [{ name: "write", description: "old tool", parameters: { type: "object" } }],
    timestamp: 0,
  };
  source.messages.push({ ...recordedSystem(), toolsRemoved: [{ name: "write" }] });
  assert.deepEqual(describeLiveContextUsage(source).breakdown, {
    systemPrompt: 200,
    tools: 19,
    agentsAndSkills: 100,
    conversation: 420,
    toolResults: 1261,
  });
});

test("a fresh live session reports zero fixed context before any system record is committed", () => {
  const result = describeLiveContextUsage({
    profile: "agent",
    messages: [],
    usage: { tokens: 0, contextWindow: 1000, percent: 0 },
  });
  assert.deepEqual(result.breakdown, {
    systemPrompt: 0,
    tools: 0,
    agentsAndSkills: 0,
    conversation: 0,
    toolResults: 0,
  });
});

test("live bare profiles suppress structured prompt, tool and resource attribution", () => {
  const source = liveSession();
  source.profile = "bare";
  assert.deepEqual(describeLiveContextUsage(source).breakdown, {
    systemPrompt: 0,
    tools: 0,
    agentsAndSkills: 0,
    conversation: 500,
    toolResults: 1500,
  });
});
