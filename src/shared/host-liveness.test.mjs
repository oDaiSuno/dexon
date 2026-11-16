import assert from "node:assert/strict";
import test from "node:test";
import { assessHostLiveness, PRIMARY_HOST_LIVENESS } from "./host-liveness.ts";
import { parseHostToMain, stakeOf } from "./host-protocol.ts";

const IDLE = { running: [], starting: [] };
const BUSY_READS = { running: [], starting: [], inFlightRequests: 2 };
const SESSION = { running: ["a"], starting: [] };

function assess(silentMs, activity) {
  return assessHostLiveness({
    now: 1_000 + silentMs,
    lastTickAt: 1_000 + silentMs - PRIMARY_HOST_LIVENESS.intervalMs,
    lastPongAt: 1_000,
    activity,
  });
}

test("the primary watchdog checks every five seconds and escalates at 10, 25, 45 and 145 seconds of silence", () => {
  assert.deepEqual(PRIMARY_HOST_LIVENESS, {
    intervalMs: 5_000,
    unresponsiveMs: 10_000,
    idleKillMs: 25_000,
    busyKillMs: 45_000,
    sessionKillMs: 145_000,
  });
});

test("a quiet host is responsive under ten seconds and unresponsive, but alive, from ten seconds", () => {
  assert.deepEqual(assess(9_999, IDLE), { kind: "responsive" });
  for (const silentMs of [10_000, 24_999]) {
    assert.deepEqual(assess(silentMs, IDLE), { kind: "unresponsive", silentMs, killAt: 26_000 });
  }
});

test("an idle host with no requests in flight is restarted at 25 seconds of silence", () => {
  assert.deepEqual(assess(25_000, IDLE), { kind: "hung", silentMs: 25_000 });
});

test("requests in flight extend the limit to a fixed 45 seconds after the last heartbeat", () => {
  assert.deepEqual(assess(25_000, BUSY_READS), { kind: "unresponsive", silentMs: 25_000, killAt: 46_000 });
  assert.deepEqual(assess(44_999, BUSY_READS), { kind: "unresponsive", silentMs: 44_999, killAt: 46_000 });
  assert.deepEqual(assess(45_000, BUSY_READS), { kind: "hung", silentMs: 45_000 });
  assert.deepEqual(
    assess(30_000, { ...BUSY_READS, inFlightRequests: 50 }),
    { kind: "unresponsive", silentMs: 30_000, killAt: 46_000 },
    "more requests never push the deadline later",
  );
});

test("running or starting sessions keep the host alive until 145 seconds of silence", () => {
  for (const activity of [SESSION, { running: [], starting: ["b"] }, { ...SESSION, inFlightRequests: 4 }]) {
    assert.deepEqual(assess(144_999, activity), { kind: "unresponsive", silentMs: 144_999, killAt: 146_000 });
    assert.deepEqual(assess(145_000, activity), { kind: "hung", silentMs: 145_000 });
  }
});

test("sleep and wall-clock rollback rearm the watchdog regardless of work at stake", () => {
  for (const activity of [IDLE, BUSY_READS, SESSION]) {
    assert.deepEqual(assessHostLiveness({ now: 300_000, lastTickAt: 15_000, lastPongAt: 0, activity }), {
      kind: "clock-jump",
    });
    assert.deepEqual(assessHostLiveness({ now: 1_000, lastTickAt: 2_000, lastPongAt: 2_000, activity }), {
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

test("heartbeats carry the in-flight request count without turning requests into sessions at stake", () => {
  const activity = { running: [], starting: [], inFlightRequests: 3 };
  assert.deepEqual(parseHostToMain({ type: "pong", seq: 4, ts: 1000, lagMaxMs: 0, activity }), {
    type: "pong",
    seq: 4,
    ts: 1000,
    lagMaxMs: 0,
    activity,
  });
  assert.equal(stakeOf(activity), 0, "slow reads alone never earn the long session protection");
  assert.equal(stakeOf({ running: ["a"], starting: [], inFlightRequests: 9 }), 1);
  for (const inFlightRequests of [-1, 1.5, "2", Number.NaN, null]) {
    assert.equal(
      parseHostToMain({ type: "pong", seq: 4, ts: 1000, lagMaxMs: 0, activity: { ...activity, inFlightRequests } }),
      null,
      `in-flight count ${String(inFlightRequests)} is rejected at the process boundary`,
    );
  }
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
