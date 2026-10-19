import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react-test-renderer";

import {
  createReadingSurface,
  createSessionDetail,
  createSessionHookHarness,
  createSessionTestHost,
} from "./session-hook-harness.mjs";

function surfaceAttach(surface) {
  return (state) => {
    state.scrollContainerRef.current = surface.container;
    state.liveContentEndRef.current = surface.liveEnd;
    state.messagesEndRef.current = surface.messagesEnd;
    state.lastUserMsgRef.current = surface.lastUserMsg;
  };
}

function trackHiddenGeometry(container) {
  const values = {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
  };
  const counts = { reads: 0, writes: 0 };
  let hidden = false;
  for (const key of Object.keys(values)) {
    Object.defineProperty(container, key, {
      configurable: true,
      get() {
        if (hidden) counts.reads += 1;
        return values[key];
      },
      set(value) {
        if (hidden) counts.writes += 1;
        values[key] = value;
      },
    });
  }
  return {
    hide: () => (hidden = true),
    show: () => (hidden = false),
    set: (key, value) => (values[key] = value),
    counts,
  };
}

/** Mounts one fixture session with a plain scroll surface and settles it. */
async function mountedSession(t, { hostOverrides = {}, hookOptions = {}, bundleName = "session-events" } = {}) {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail, ...hostOverrides });
  const h = await createSessionHookHarness(t, {
    bundleName,
    host,
    attach: surfaceAttach(createReadingSurface()),
  });
  await h.mount({ session: detail.info, newSessionCwd: null, ...hookOptions });
  await h.flush();
  await h.env.flushRafUntilSettled();
  return { h, host, detail };
}

test("agent_start and agent_end drive the run lifecycle and refresh from the host", async (t) => {
  const onAgentEnd = [];
  const { h } = await mountedSession(t, {
    hostOverrides: {
      agentState: async () => ({
        running: false,
        state: {
          contextUsage: { percent: 9, contextWindow: 1000, tokens: 90 },
          queuedMessages: { steering: ["s1"], followUp: [] },
        },
      }),
    },
    hookOptions: { onAgentEnd: () => onAgentEnd.push(1) },
  });

  h.emit({ type: "agent_start" });
  await h.flush();
  assert.equal(h.state.agentRunning, true);
  assert.deepEqual(h.state.agentPhase, { kind: "waiting_model" });

  h.emit({ type: "agent_end" });
  await h.flush();
  assert.equal(h.state.agentRunning, false);
  assert.deepEqual(h.state.agentPhase, null);
  assert.equal(h.state.streamState.isStreaming, false);
  assert.equal(onAgentEnd.length, 1, "onAgentEnd notified once");
  assert.ok(
    h.host.getCommands.some((c) => c.rpc === "getSession"),
    "history reloaded from the session file after the run",
  );
  assert.deepEqual(h.state.queuedMessages, { steering: ["s1"], followUp: [] }, "queue mirrored from the host state");
});

test("a late agent_end after the reconcile finish must not trigger completion twice", async (t) => {
  // Mocks must be enabled before mounting so every production timer goes through them.
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const onAgentEnd = [];
  const { h } = await mountedSession(t, {
    hostOverrides: { agentState: async () => ({ running: false, state: {} }) },
    hookOptions: { onAgentEnd: () => onAgentEnd.push(1) },
  });

  h.emit({ type: "agent_start" });
  await h.flush();
  assert.equal(h.state.agentRunning, true);

  await act(async () => {
    t.mock.timers.tick(15_000);
  });
  await h.flush();
  assert.equal(h.state.agentRunning, false, "the reconcile net finished the run");
  assert.equal(onAgentEnd.length, 1);

  h.emit({ type: "agent_end" });
  await h.flush();
  assert.equal(onAgentEnd.length, 1, "late agent_end is ignored after reconcile");
});

test("a delivered user message consumes the optimistic twin; a queued delivery appends", async (t) => {
  const { h } = await mountedSession(t);

  await h.act(async () => {
    await h.state.handleSend("same text");
  });
  assert.equal(h.state.messages.length, 3, "optimistic bubble present");
  const optimisticTimestamp = h.state.messages[2].timestamp;

  h.emit({ type: "message_end", message: { role: "user", content: "same text", timestamp: 9 } });
  await h.flush();
  assert.equal(h.state.messages.length, 3, "the delivered twin kept the optimistic bubble without duplicating");
  assert.equal(h.state.messages[2].timestamp, optimisticTimestamp, "a true twin keeps the optimistic bubble as-is");

  h.emit({ type: "message_end", message: { role: "user", content: "queued steer", timestamp: 10 } });
  await h.flush();
  assert.equal(h.state.messages.length, 4, "a queue delivery with new content renders");
  assert.equal(h.state.messages[3].content, "queued steer");
});

test("an assistant message_end is appended with a receive-time stamp", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(1_700_000_000_000);
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, {
    bundleName: "session-events-stamp",
    host,
    attach: surfaceAttach(createReadingSurface()),
  });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  await h.env.flushRafUntilSettled();

  await h.act(() => {
    h.emit({ type: "agent_start" });
  });
  await h.flush();
  await h.act(() => {
    h.emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "reply" }], timestamp: 1 },
    });
  });
  await h.flush();
  const last = h.state.messages[h.state.messages.length - 1];
  assert.equal(last.role, "assistant");
  assert.equal(last.timestamp, 1_700_000_000_000, "receive time is the controlled clock");
  assert.equal(h.state.streamState.isStreaming, false, "stream bubble reset after the message completes");
});

test("streaming updates after the run finished are dropped (no ghost bubble)", async (t) => {
  const { h } = await mountedSession(t);

  h.emit({ type: "agent_start" });
  h.emit({ type: "agent_end" });
  await h.flush();
  const snapshotLength = h.state.messages.length;

  h.emit({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "late" }] } });
  await h.flush();
  assert.equal(h.state.streamState.isStreaming, false, "streaming state not resurrected");
  assert.equal(h.state.messages.length, snapshotLength, "no ghost streaming bubble appended");
});

test("tool execution phases track their tools and settle back to waiting_model", async (t) => {
  const { h } = await mountedSession(t);

  h.emit({ type: "agent_start" });
  h.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "read" });
  await h.flush();
  assert.deepEqual(h.state.agentPhase, { kind: "running_tools", tools: [{ id: "t1", name: "read" }] });

  h.emit({ type: "tool_execution_start", toolCallId: "t2", toolName: "edit" });
  await h.flush();
  assert.equal(h.state.agentPhase.tools.length, 2);

  h.emit({ type: "tool_execution_end", toolCallId: "t1" });
  await h.flush();
  assert.deepEqual(h.state.agentPhase, { kind: "running_tools", tools: [{ id: "t2", name: "edit" }] });

  h.emit({ type: "tool_execution_end", toolCallId: "t2" });
  await h.flush();
  assert.deepEqual(h.state.agentPhase, { kind: "waiting_model" }, "empty tool list settles to waiting_model");
});

test("retry and compaction events update their dedicated banners", async (t) => {
  const { h } = await mountedSession(t);

  h.emit({ type: "auto_retry_start", attempt: 2, maxAttempts: 4, delayMs: 4000, errorMessage: "rate limited" });
  await h.flush();
  assert.equal(h.state.retryInfo.attempt, 2);
  assert.equal(h.state.retryInfo.maxAttempts, 4);
  assert.equal(h.state.retryInfo.waiting, true);
  h.emit({ type: "auto_retry_end" });
  await h.flush();
  assert.equal(h.state.retryInfo, null);

  h.emit({ type: "compaction_start" });
  await h.flush();
  assert.equal(h.state.isCompacting, true);
  h.emit({ type: "auto_compaction_end", errorMessage: "compaction failed" });
  await h.flush();
  assert.equal(h.state.isCompacting, false);
  assert.equal(h.state.compactError, "compaction failed");

  h.emit({ type: "auto_compaction_start" });
  h.emit({ type: "auto_compaction_end", aborted: true });
  await h.flush();
  assert.equal(h.state.compactError, null, "an aborted compaction is not an error");
  assert.equal(h.state.compactResult, null);

  h.emit({ type: "compaction_start" });
  h.emit({ type: "compaction_end", result: { tokensBefore: 100, estimatedTokensAfter: 40 } });
  await h.flush();
  assert.deepEqual(h.state.compactResult, { reason: "auto", tokensBefore: 100, estimatedTokensAfter: 40 });
});

test("prompt and extension failures surface as error notices", async (t) => {
  const { h } = await mountedSession(t);

  h.emit({ type: "prompt_error", errorMessage: "prompt exploded" });
  await h.flush();
  assert.ok(h.state.notices.some((n) => n.type === "error" && n.message === "prompt exploded"));

  h.emit({ type: "extension_error", error: "extension exploded" });
  await h.flush();
  assert.ok(h.state.notices.some((n) => n.type === "error" && n.message === "extension exploded"));
});

test("queue updates arrive from the host as the single source of truth", async (t) => {
  const { h } = await mountedSession(t);

  h.emit({ type: "queue_update", steering: ["s"], followUp: ["f"] });
  await h.flush();
  assert.deepEqual(h.state.queuedMessages, { steering: ["s"], followUp: ["f"] });
});

test("an external channel turn follows a reader near the bottom", async (t) => {
  const near = createReadingSurface({ scrollTop: 60, scrollHeight: 200, clientHeight: 120 });
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, {
    bundleName: "session-events-near",
    host,
    attach: surfaceAttach(near),
  });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  await h.env.flushRafUntilSettled();

  h.emit({ type: "channel_turn_start" });
  h.emit({ type: "agent_start" });
  await h.flush();
  h.emit({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "ext near" }] },
  });
  await h.flush();
  const before = near.liveEnd.scrollIntoViewCalls.length;
  await h.env.flushRaf();
  assert.ok(
    near.liveEnd.scrollIntoViewCalls.length > before,
    "the external reply stays in view for a reader near the bottom",
  );
  h.emit({ type: "channel_turn_end" });
  await h.flush();
});

test("an external channel turn does not drag a reader away from the bottom", async (t) => {
  const away = createReadingSurface({ scrollTop: 0, scrollHeight: 300, clientHeight: 120 });
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, {
    bundleName: "session-events-away",
    host,
    attach: surfaceAttach(away),
  });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  await h.env.flushRafUntilSettled();

  h.emit({ type: "channel_turn_start" });
  h.emit({ type: "agent_start" });
  await h.flush();
  h.emit({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "ext away" }] },
  });
  await h.flush();
  await h.env.flushRafUntilSettled();
  assert.equal(h.env.rafSize(), 0, "a reader away from the bottom is not dragged along");
  assert.equal(h.state.streamState.isStreaming, true, "the external turn still streams");
});

test("a hidden external turn preserves visible away intent through mid-run and completion", async (t) => {
  const surface = createReadingSurface({ scrollTop: 0, scrollHeight: 300, clientHeight: 120 });
  const geometry = trackHiddenGeometry(surface.container);
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, {
    bundleName: "session-events-hidden-turn",
    host,
    attach: surfaceAttach(surface),
  });
  const options = { session: detail.info, newSessionCwd: null };
  await h.mount({ ...options, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();
  assert.equal(h.state.isAwayFromBottom, true, "the visible reader starts away from the bottom");

  h.emit({ type: "channel_turn_start" });
  await h.flush();
  const liveScrollsBeforeHide = surface.liveEnd.scrollIntoViewCalls.length;
  await h.update({ ...options, readingVisible: false });
  await h.flush();
  geometry.hide();
  geometry.set("scrollTop", 0);
  geometry.set("scrollHeight", 0);
  geometry.set("clientHeight", 0);

  h.emit({ type: "channel_turn_start" });
  h.emit({ type: "agent_start" });
  h.emit({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "hidden external turn" }] },
  });
  await h.flush();
  assert.equal(h.state.streamState.isStreaming, true, "hidden state must still receive runtime events");

  geometry.show();
  geometry.set("scrollHeight", 300);
  geometry.set("clientHeight", 120);
  await h.update({ ...options, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();
  assert.equal(h.env.rafSize(), 0, "showing mid-run does not follow hidden zero-size geometry");
  assert.equal(surface.liveEnd.scrollIntoViewCalls.length, liveScrollsBeforeHide, "mid-run show keeps the away anchor");

  await h.update({ ...options, readingVisible: false });
  geometry.hide();
  await h.flush();
  h.emit({ type: "channel_turn_end" });
  h.emit({ type: "agent_end" });
  await h.flush();
  geometry.show();
  await h.update({ ...options, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();
  assert.equal(
    surface.liveEnd.scrollIntoViewCalls.length,
    liveScrollsBeforeHide,
    "completion show keeps the away anchor too",
  );
  assert.deepEqual(
    geometry.counts,
    { reads: 0, writes: 0 },
    "hidden external events do not inspect or mutate geometry",
  );
});

test("the state reconcile net finishes a stalled run when the host reports idle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const onAgentEnd = [];
  const { h } = await mountedSession(t, {
    hostOverrides: { agentState: async () => ({ running: false, state: { isCompacting: false } }) },
    hookOptions: { onAgentEnd: () => onAgentEnd.push(1) },
  });

  h.emit({ type: "agent_start" });
  await h.flush();
  assert.equal(h.state.agentRunning, true);

  await act(async () => {
    t.mock.timers.tick(15_000);
  });
  await h.flush();
  assert.equal(h.state.agentRunning, false, "the stalled run is finished through the reconcile path");
  assert.equal(onAgentEnd.length, 1);
});

test("a reconcile response for a superseded run is dropped entirely", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const pendingAgentState = [];
  const onAgentEnd = [];
  const { h } = await mountedSession(t, {
    hostOverrides: {
      agentState: () =>
        new Promise((resolve) => {
          pendingAgentState.push(resolve);
        }),
    },
    hookOptions: { onAgentEnd: () => onAgentEnd.push(1) },
  });

  h.emit({ type: "agent_start" });
  await h.flush();
  await act(async () => {
    t.mock.timers.tick(15_000);
  });
  await h.flush();
  assert.equal(onAgentEnd.length, 0, "the slow poll has not finished anything yet");

  // Run A ends and a new run B supersedes it while the poll is still in flight.
  h.emit({ type: "agent_end" });
  await h.flush();
  await h.act(async () => {
    await h.state.handleSend("run B");
  });
  await h.flush();
  assert.equal(h.state.agentRunning, true, "run B is alive");

  for (const resolve of [...pendingAgentState]) resolve({ running: false, state: {} });
  await h.flush();
  assert.equal(h.state.agentRunning, true, "the stale poll answer for run A cannot finish run B");
  assert.equal(onAgentEnd.length, 1, "only run A's agent_end notified; the stale poll leaked nothing");
});
