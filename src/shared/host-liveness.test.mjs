import assert from "node:assert/strict";
import test from "node:test";
import { assessHostLiveness, PRIMARY_HOST_LIVENESS } from "./host-liveness.ts";
import { parseHostToMain, stakeOf } from "./host-protocol.ts";

function assess(silentMs, atStake) {
  return assessHostLiveness({
    now: 1_000 + silentMs,
    lastTickAt: 1_000 + silentMs - 15_000,
    lastPongAt: 1_000,
    atStake,
  });
}

test("the primary watchdog uses a 25 second idle limit and 120 seconds of additional work grace", () => {
  assert.deepEqual(PRIMARY_HOST_LIVENESS, { intervalMs: 15_000, timeoutMs: 10_000, graceWithWorkMs: 120_000 });
  assert.deepEqual(assess(24_999, 0), { kind: "responsive" });
  assert.deepEqual(assess(25_000, 0), { kind: "hung", silentMs: 25_000 });
});

test("work at stake stalls from 25 seconds through 144 seconds and becomes hung at 145 seconds", () => {
  for (const silentMs of [25_000, 30_000, 144_000, 144_999]) {
    assert.deepEqual(assess(silentMs, 1), { kind: "stalled", silentMs, killAt: 146_000 });
  }
  assert.deepEqual(assess(145_000, 1), { kind: "hung", silentMs: 145_000 });
  assert.deepEqual(assess(145_001, 2), { kind: "hung", silentMs: 145_001 });
});

test("sleep and wall-clock rollback rearm the watchdog regardless of work at stake", () => {
  for (const atStake of [0, 1]) {
    assert.deepEqual(assessHostLiveness({ now: 300_000, lastTickAt: 15_000, lastPongAt: 0, atStake }), {
      kind: "clock-jump",
    });
    assert.deepEqual(assessHostLiveness({ now: 1_000, lastTickAt: 2_000, lastPongAt: 2_000, atStake }), {
      kind: "clock-jump",
    });
  }
});

test("running and starting sessions count once even across the initialization handoff", () => {
  assert.equal(stakeOf({ running: ["a", "b"], starting: ["b", "c", "c"] }), 3);
  assert.equal(stakeOf({ running: [], starting: [] }), 0);
});

test("existing utility-process hosts remain usable while messages normalize into the closed protocol", () => {
  assert.deepEqual(parseHostToMain({ type: "ready", ts: 1000 }), { type: "ready", ts: 1000, piVersion: null });
  assert.deepEqual(parseHostToMain({ type: "pong", ts: 1000 }), {
    type: "pong",
    seq: 0,
    ts: 1000,
    lagMaxMs: 0,
    activity: { running: [], starting: [] },
  });
  for (const message of [
    { type: "log", message: "ready" },
    { type: "running-sessions", sessionIds: ["a"] },
    { type: "agent-end", sessionId: "a", eventType: "agent_end" },
    { type: "toolchain:ack", revision: 1 },
    { type: "browser:ack", revision: 2 },
    { type: "managed-process-owner:ack", version: 1, hostInstanceId: "host-a" },
    { type: "managed-process-count", count: 3 },
    { type: "host-rpc", id: "1", method: "browser.status", params: {} },
  ])
    assert.deepEqual(parseHostToMain(message), message);
});

test("host messages accept typed activity and reject malformed telemetry at the process boundary", () => {
  const activity = { running: ["a"], starting: ["b"] };
  const pong = { type: "pong", seq: 3, ts: 1000, lagMaxMs: 42, activity };
  assert.deepEqual(parseHostToMain(pong), pong);
  assert.deepEqual(parseHostToMain({ type: "activity", activity }), { type: "activity", activity });
  assert.deepEqual(parseHostToMain({ type: "ready", ts: 1000, piVersion: null }), {
    type: "ready",
    ts: 1000,
    piVersion: null,
  });
  for (const raw of [
    null,
    [],
    {},
    { type: "__proto__" },
    { type: "unknown" },
    { ...pong, lagMaxMs: NaN },
    { ...pong, lagMaxMs: -1 },
    { ...pong, seq: 1.5 },
    { type: "activity", activity: { running: [1], starting: [] } },
    { type: "toolchain:ack", revision: -1 },
    { type: "host-rpc", id: "", method: "x" },
  ]) {
    assert.equal(parseHostToMain(raw), null);
  }
});
