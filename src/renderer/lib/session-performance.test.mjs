import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";

import {
  beginSessionLoadTrace,
  consumeSessionLoadTrace,
  finishSessionLoadTrace,
  failSessionLoadTrace,
  markSessionLoadPhase,
  PendingSessionLoadTraceRegistry,
} from "./session-performance.ts";

function trace(sessionId, startedAt, id = sessionId) {
  return { id, sessionId, source: "selection", startedAt };
}

test("replacing and taking traces clean up the exact pending entry", () => {
  const discarded = [];
  const registry = new PendingSessionLoadTraceRegistry(
    () => 0,
    (entry) => discarded.push(entry.id),
  );
  const first = trace("session", 0, "first");
  const replacement = trace("session", 0, "replacement");

  registry.set(first);
  registry.set(replacement);

  assert.deepEqual(discarded, ["first"]);
  assert.equal(registry.delete(first), false);
  assert.equal(registry.take("session"), replacement);
  assert.equal(registry.take("session"), undefined);
});

test("pending traces enforce TTL and insertion-order capacity", () => {
  let now = 0;
  const discarded = [];
  const registry = new PendingSessionLoadTraceRegistry(
    () => now,
    (entry) => discarded.push(entry.id),
    10,
    2,
  );

  registry.set(trace("a", 0));
  now = 5;
  registry.set(trace("b", 5));
  now = 6;
  registry.set(trace("c", 6));
  assert.deepEqual(discarded, ["a"]);
  assert.equal(registry.take("a"), undefined, "the evicted trace cannot be consumed");

  now = 15;
  assert.equal(registry.take("missing"), undefined);
  assert.deepEqual(discarded, ["a", "b"]);
  assert.equal(registry.take("c")?.id, "c");
});

for (const [outcome, terminate] of [
  ["completed", finishSessionLoadTrace],
  ["failed", failSessionLoadTrace],
]) {
  test(`a ${outcome} session load releases its pending ownership and performance marks`, () => {
    const trace = beginSessionLoadTrace(`performance-${outcome}`, "selection");
    markSessionLoadPhase(trace, "rpc-start");
    assert.ok(performance.getEntriesByType("mark").some((entry) => entry.name.includes(trace.id)));
    terminate(trace);
    assert.equal(
      performance.getEntriesByType("mark").some((entry) => entry.name.includes(trace.id)),
      false,
    );
    const following = consumeSessionLoadTrace(trace.sessionId, "initial");
    assert.notEqual(following.id, trace.id, "a finished load cannot be reused as a new pending load");
    terminate(following);
  });
}
