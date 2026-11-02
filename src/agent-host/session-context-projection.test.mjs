import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const { describeStoredContextUsage, partitionContext } = await importTestBundle("context-projection", {
  packages: "external",
  entryPoints: [path.join(import.meta.dirname, "session-context-usage.ts")],
});
const { branchAt } = await importTestBundle("context-projection-branch", {
  packages: "external",
  entryPoints: [path.join(import.meta.dirname, "session-branch.ts")],
});

const timestamp = "2026-10-01T00:00:00.000Z";

function chain(definitions) {
  return definitions.map((definition, index) => ({
    id: `entry-${index}`,
    parentId: index === 0 ? null : `entry-${index - 1}`,
    timestamp,
    ...definition,
  }));
}

function system(content, extra = {}) {
  return { type: "message", message: { role: "system", content, timestamp: 0, ...extra } };
}

function user(content) {
  return { type: "message", message: { role: "user", content, timestamp: 1 } };
}

function reconstruct(entries, profile = "agent", leafId) {
  return describeStoredContextUsage({
    branch: branchAt(entries, leafId),
    profile,
    resolveContextWindow: async () => 1000,
  });
}

test("stored bare sessions ignore structured prompt records retained on disk", async () => {
  const entries = chain([
    { type: "model_change", provider: "provider", modelId: "model" },
    system("p".repeat(400)),
    user("hello"),
  ]);
  assert.deepEqual(await reconstruct(entries, "bare"), { tokens: 2, contextWindow: 1000, percent: 0.2 });
  assert.deepEqual(
    partitionContext(
      entries.slice(1).map((entry) => entry.message),
      "bare",
    ),
    {
      systemPrompt: "",
      tools: [],
      sections: {},
      conversation: [entries[2].message],
      toolResults: [],
    },
  );
});

test("stored estimates replay replaced prompt sections instead of adding obsolete records", async () => {
  const entries = chain([
    { type: "model_change", provider: "provider", modelId: "model" },
    system("", { sections: { preamble: "p".repeat(400), old_section: "obsolete" } }),
    user("hello"),
    system("", { sections: { preamble: "new", old_section: null } }),
  ]);
  assert.deepEqual(await reconstruct(entries), { tokens: 3, contextWindow: 1000, percent: 0.3 });
});

test("context edits invalidate assistant usage measured before the replacement", async () => {
  const entries = chain([
    user("x".repeat(400)),
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "reply" }],
        model: "model",
        provider: "provider",
        stopReason: "stop",
        usage: { input: 300, output: 0, cacheRead: 0, cacheWrite: 0 },
        timestamp: 2,
      },
    },
    { type: "context_edit", targetId: "entry-0", replacement: { content: "new" } },
  ]);
  assert.deepEqual(await reconstruct(entries), { tokens: 3, contextWindow: 1000, percent: 0.3 });
  assert.deepEqual(await reconstruct(entries, "agent", "entry-1"), { tokens: 300, contextWindow: 1000, percent: 30 });
});

test("omitting the only post-compaction reply restores unknown context usage", async () => {
  const entries = chain([
    { type: "model_change", provider: "provider", modelId: "model" },
    user("old"),
    {
      type: "compaction",
      summary: "summary",
      firstKeptEntryId: "entry-2",
      tokensBefore: 500,
      systemMessage: { role: "system", content: "checkpoint", timestamp: 0 },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "reply" }],
        model: "model",
        provider: "provider",
        stopReason: "stop",
        usage: { input: 300, output: 0, cacheRead: 0, cacheWrite: 0 },
        timestamp: 2,
      },
    },
    { type: "context_edit", targetId: "entry-3", replacement: null },
  ]);
  assert.deepEqual(await reconstruct(entries), { tokens: null, contextWindow: 1000, percent: null });
});

test("Pi compaction checkpoints preserve prompt and tools for retained and retain-none context", async () => {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  for (const retain of [true, false]) {
    const manager = SessionManager.inMemory(process.cwd());
    manager.appendMessage({ role: "system", content: "base", sections: { skills: "old" }, timestamp: 0 });
    manager.appendMessage({ role: "user", content: "summarize me", timestamp: 1 });
    manager.appendMessage({
      role: "system",
      content: "",
      sections: { skills: "current" },
      toolsAdded: [{ name: "read", description: "Read", parameters: { type: "object" } }],
      timestamp: 2,
    });
    const kept = manager.appendMessage({ role: "user", content: "keep me", timestamp: 3 });
    manager.appendCompaction("summary", retain ? kept : null, 500);
    manager.appendMessage({
      role: "system",
      content: "",
      sections: { skills: null },
      toolsRemoved: [{ name: "read" }],
      toolsAdded: [{ name: "write", description: "Write", parameters: { type: "object" } }],
      timestamp: 4,
    });
    const before = structuredClone(manager.getEntries());
    const partition = partitionContext(manager.buildSessionProjection().messages, "agent");
    assert.equal(partition.systemPrompt, "base");
    assert.deepEqual(
      partition.tools.map((tool) => tool.name),
      ["write"],
    );
    assert.deepEqual(partition.sections, {});
    assert.deepEqual(
      partition.conversation.map((message) => message.role),
      retain ? ["compactionSummary", "user"] : ["compactionSummary"],
    );
    assert.deepEqual(manager.getEntries(), before);
  }
});

test("string context replacements of assistant and tool results retain their roles and normalize content", async () => {
  const entries = chain([
    user("hello"),
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "x".repeat(400) }],
        model: "model",
        provider: "provider",
        timestamp: 2,
      },
    },
    {
      type: "message",
      message: { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "x".repeat(400) }] },
    },
    { type: "context_edit", targetId: "entry-1", replacement: { content: "new" } },
    { type: "context_edit", targetId: "entry-2", replacement: { content: "ok" } },
  ]);
  assert.deepEqual(await reconstruct(entries), { tokens: 4, contextWindow: 1000, percent: 0.4 });
});
