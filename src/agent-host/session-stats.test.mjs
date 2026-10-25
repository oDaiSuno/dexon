import assert from "node:assert/strict";
import test from "node:test";
import { computeSessionStats } from "./session-stats.ts";

function usage(costs) {
  return {
    input: 100,
    output: 10,
    cacheRead: 1000,
    cacheWrite: 50,
    totalTokens: 1160,
    cost: { ...costs, total: costs.input + costs.output + costs.cacheRead + costs.cacheWrite },
  };
}

function assistant(id, costs) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-10-01T10:00:00.000Z",
    message: { role: "assistant", content: [], usage: usage(costs), stopReason: "stop", timestamp: 1 },
  };
}

test("session stats add up what each kind of token cost across the whole session", () => {
  const stats = computeSessionStats([
    assistant("a1", { input: 0.5, output: 0.25, cacheRead: 0.125, cacheWrite: 0.0625 }),
    assistant("a2", { input: 0.25, output: 0.5, cacheRead: 0.125, cacheWrite: 0 }),
  ]);
  assert.deepEqual(stats.costs, { input: 0.75, output: 0.75, cacheRead: 0.25, cacheWrite: 0.0625 });
  assert.equal(stats.cost, 1.8125);
});

test("session stats report when the session was last compacted", () => {
  const compaction = (id, timestamp) => ({
    type: "compaction",
    id,
    parentId: null,
    timestamp,
    summary: "summary",
    firstKeptEntryId: "a1",
    tokensBefore: 900,
  });
  const stats = computeSessionStats([
    assistant("a1", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    compaction("c1", "2026-10-01T11:00:00.000Z"),
    compaction("c2", "2026-10-01T12:30:00.000Z"),
  ]);
  assert.equal(stats.lastCompactionAt, "2026-10-01T12:30:00.000Z");
});

test("a session that was never compacted has no last compaction time", () => {
  const stats = computeSessionStats([assistant("a1", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })]);
  assert.equal(stats.lastCompactionAt, null);
});
