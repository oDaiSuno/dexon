import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "dexon-pi-history-"));
process.env.PI_CODING_AGENT_DIR = directory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(directory, "sessions");
process.env.PI_OFFLINE = "1";
test.after(() => rmSync(directory, { recursive: true, force: true }));

const { registerHandlers } = await importTestBundle("session-pi-history", {
  packages: "external",
  entryPoints: [path.join(import.meta.dirname, "handlers.ts")],
});

test("real JSONL sessions keep raw context edits while host history, counts and markdown exclude system records", async () => {
  const id = "history-boundary-140";
  const timestamp = "2026-10-01T10:00:00.000Z";
  const entries = [
    { type: "message", message: { role: "system", content: "PRIVATE SYSTEM PROMPT", timestamp: 0 } },
    { type: "message", message: { role: "user", content: "original question", timestamp: 1 } },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "original answer" }],
        provider: "provider",
        model: "model",
        timestamp: 2,
      },
    },
    { type: "context_edit", targetId: "entry-1", replacement: null },
    {
      type: "usage",
      kind: "cache_warm",
      provider: "provider",
      model: "model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 100,
        cacheWrite: 0,
        totalTokens: 100,
        cost: { input: 0, output: 0, cacheRead: 0.125, cacheWrite: 0, total: 0.125 },
      },
    },
    { type: "future_metadata", payload: "unrecognized bookkeeping" },
  ].map((entry, index) => ({
    id: `entry-${index}`,
    parentId: index === 0 ? null : `entry-${index - 1}`,
    timestamp,
    ...entry,
  }));
  const sessionDirectory = path.join(process.env.PI_CODING_AGENT_SESSION_DIR, "fixture");
  mkdirSync(sessionDirectory, { recursive: true });
  const file = path.join(sessionDirectory, `${id}.jsonl`);
  const raw =
    [{ type: "session", version: 3, id, cwd: directory, timestamp }, ...entries]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n";
  writeFileSync(file, raw);
  const handlers = {};
  registerHandlers({
    handle(next) {
      Object.assign(handlers, next);
    },
    emit() {},
  });
  const listed = await handlers["sessions.list"]();
  assert.equal(listed.sessions.find((session) => session.id === id).messageCount, 2);
  const detail = await handlers["sessions.get"]({ id, historyWindow: { maxTurns: 1 } });
  assert.equal(detail.context.totalMessages, 2);
  assert.deepEqual(detail.context.entryIds, ["entry-1", "entry-2"]);
  assert.equal(detail.context.messages[0].content, "original question");
  assert.equal(detail.stats.totalMessages, 2);
  assert.equal(detail.stats.tokens.total, 0);
  assert.equal(detail.stats.cost, 0);
  assert.equal(detail.stats.auxiliaryUsage[0].kind, "cache_warm");
  assert.equal(detail.stats.auxiliaryUsage[0].tokens.total, 100);
  const exported = await handlers["sessions.export"]({ id, format: "md" });
  assert.equal(exported.content.includes("PRIVATE SYSTEM PROMPT"), false);
  assert.equal(exported.content.includes("## system"), false);
  assert.equal(exported.content.includes("original question"), true);
  assert.equal(exported.content.includes("original answer"), true);
  assert.equal(readFileSync(file, "utf8"), raw);
});

test("stored context usage follows intent kind even when an agent selects no coding tools", async () => {
  const timestamp = "2026-10-01T11:00:00.000Z";
  const cases = [
    { id: "stored-profile-bare", intent: { kind: "bare" }, tokens: 2 },
    { id: "stored-profile-agent", intent: { kind: "agent", coding: [] }, tokens: 42 },
    { id: "stored-profile-default", tokens: 42 },
  ];
  const stateDirectory = path.join(directory, "desktop");
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(
    path.join(stateDirectory, "session-tools.json"),
    JSON.stringify({
      version: 2,
      sessions: Object.fromEntries(
        cases.filter((entry) => entry.intent).map(({ id, intent }) => [id, { intent, updatedAt: timestamp }]),
      ),
    }),
  );
  const sessionDirectory = path.join(process.env.PI_CODING_AGENT_SESSION_DIR, "stored-profiles");
  mkdirSync(sessionDirectory, { recursive: true });
  for (const { id } of cases) {
    const entries = [
      { type: "model_change", provider: "history-context-provider", modelId: "history-context-model" },
      { type: "message", message: { role: "system", content: "p".repeat(160), timestamp: 0 } },
      { type: "message", message: { role: "user", content: "hello", timestamp: 1 } },
    ].map((entry, index) => ({
      id: `${id}-${index}`,
      parentId: index === 0 ? null : `${id}-${index - 1}`,
      timestamp,
      ...entry,
    }));
    writeFileSync(
      path.join(sessionDirectory, `${id}.jsonl`),
      [{ type: "session", version: 3, id, cwd: directory, timestamp }, ...entries]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
    );
  }
  const handlers = {};
  registerHandlers({
    handle(next) {
      Object.assign(handlers, next);
    },
    emit() {},
  });
  const editor = await handlers["modelsConfig.get"]();
  await handlers["modelsConfig.set"]({
    config: {
      providers: {
        ...editor.config.providers,
        "history-context-provider": {
          baseUrl: "https://context.invalid/v1",
          api: "openai-completions",
          apiKey: "test-key",
          models: [{ id: "history-context-model", contextWindow: 1000 }],
        },
      },
    },
    expectedVersion: editor.version,
  });
  await handlers["sessions.list"]();
  for (const { id, tokens } of cases) {
    const detail = await handlers["sessions.get"]({ id, includeState: true });
    assert.equal(detail.contextUsage?.tokens, tokens, id);
    assert.equal(detail.contextUsage?.contextWindow, 1000, id);
  }
});
