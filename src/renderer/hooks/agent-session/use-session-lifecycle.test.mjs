import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react-test-renderer";

import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

test("mounting a session subscribes live sync and loads the initial state", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, { bundleName: "lifecycle-mount", host });

  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  assert.equal(h.host.eventSinks.filter((s) => s.sid === "s-1").length, 1, "agent event stream subscribed once");
  assert.equal(h.host.changeSinks.length >= 1, true, "session-changes subscription installed");
  assert.equal(h.state.loading, false);
  assert.equal(h.state.error, null);
  assert.equal(h.state.messages.length, 2, "fixture history loaded");
  assert.equal(h.state.data.sessionId, "s-1");
});

test("the mount load restores an in-flight external run", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const detail = createSessionDetail("s-1", {
    agentState: { running: true, state: { isStreaming: true } },
  });
  const host = createSessionTestHost({
    getSession: async () => detail,
    agentState: async () => ({ running: false, state: {} }),
  });
  const h = await createSessionHookHarness(t, { bundleName: "lifecycle-restore-stream", host });

  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.agentRunning, true, "streaming run restored from the host state");
  assert.deepEqual(h.state.agentPhase, { kind: "waiting_model" });
  assert.equal(h.state.streamState.isStreaming, true);

  await act(async () => {
    t.mock.timers.tick(15_000);
  });
  await h.flush();
  assert.equal(h.state.agentRunning, false, "the settlement poll notices the host went idle");
});

test("a prompt-running session settles through the prompt path", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const detail = createSessionDetail("s-1", {
    agentState: { running: true, state: { isStreaming: false, isPromptRunning: true } },
  });
  const host = createSessionTestHost({
    getSession: async () => detail,
    agentState: async () => ({ running: false, state: {} }),
  });
  const h = await createSessionHookHarness(t, { bundleName: "lifecycle-restore-prompt", host });

  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  assert.deepEqual(h.state.agentPhase, { kind: "running_command" });

  await act(async () => {
    t.mock.timers.tick(1_000);
  });
  await h.flush();
  assert.equal(h.state.agentRunning, false, "prompt settlement finished the run");
});

test("unmount tears down the live subscription and the connection manager", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, { bundleName: "lifecycle-unmount", host });

  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  assert.ok(h.host.eventSinks[0].active, "subscription active while mounted");

  await h.unmount();
  assert.equal(h.host.eventSinks[0].active, false, "agent stream unsubscribed on unmount");
});

test("switching sessions re-subscribes to the new identity and cleans the old one", async (t) => {
  const detailA = createSessionDetail("s-a");
  const detailB = createSessionDetail("s-b");
  const byId = { "s-a": detailA, "s-b": detailB };
  const host = createSessionTestHost({ getSession: async (sid) => byId[sid] });
  const h = await createSessionHookHarness(t, { bundleName: "lifecycle-switch", host });

  await h.mount({ session: detailA.info, newSessionCwd: null });
  await h.flush();
  await h.remount({ session: detailB.info, newSessionCwd: null });
  await h.flush();

  assert.ok(
    h.host.eventSinks.every((s) => s.sid !== "s-a" || !s.active),
    "session A subscription released",
  );
  assert.ok(
    h.host.eventSinks.some((s) => s.sid === "s-b" && s.active),
    "session B subscription installed",
  );
  assert.equal(h.state.data.sessionId, "s-b");
  assert.equal(h.state.messages.length, 2);
});

test("a session-changes event after unmount does not reload the session", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, { bundleName: "lifecycle-disposed", host });

  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  const loadsBefore = host.getCommands.filter((c) => c.rpc === "getSession").length;
  assert.equal(loadsBefore, 1, "the initial load happened");

  await h.unmount();
  for (const onChange of host.changeSinks) onChange({ sessionId: "s-1" });
  await h.flush();
  const loadsAfter = host.getCommands.filter((c) => c.rpc === "getSession").length;
  assert.equal(loadsAfter, loadsBefore, "a change event after unmount triggers no reload");
});

test("a mount-load completing after unmount schedules no follow-up work", async (t) => {
  const detail = createSessionDetail("s-1");
  let resolveLoad;
  const host = createSessionTestHost({
    getSession: () => new Promise((resolve) => (resolveLoad = resolve)),
  });
  const h = await createSessionHookHarness(t, { bundleName: "lifecycle-late-load", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.messages.length, 0, "the initial load is still in flight");

  // Engage the magnet so a late completion would have visible follow-up work
  // (the deferred scroll-to-end rAF chain) if the disposed guard were missing.
  await h.act(() => h.state.reattachAutoFollow());
  await h.flush();
  await h.unmount();
  assert.equal(h.env.rafSize(), 0, "nothing scheduled before the late response");

  resolveLoad(detail);
  await h.flush();
  assert.equal(h.env.rafSize(), 0, "the late completion schedules no rAF after unmount");
});

test("mount-load mirrors the host runtime state into the hook", async (t) => {
  const detail = createSessionDetail("s-1", {
    agentState: {
      running: false,
      state: {
        isCompacting: false,
        contextUsage: { percent: 12, contextWindow: 1000, tokens: 120 },
        systemPrompt: "be terse",
        thinkingLevel: "low",
        extensionStatuses: [{ key: "k", text: "status" }],
        extensionWidgets: [],
        queuedMessages: { steering: ["st"], followUp: ["fu"] },
      },
    },
  });
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, { bundleName: "lifecycle-mirror", host });

  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  assert.deepEqual(h.state.contextUsage, { percent: 12, contextWindow: 1000, tokens: 120 });
  assert.equal(h.state.systemPrompt, "be terse");
  assert.equal(h.state.thinkingLevel, "low");
  assert.deepEqual(h.state.extensionStatuses, [{ key: "k", text: "status" }]);
  assert.deepEqual(h.state.queuedMessages, { steering: ["st"], followUp: ["fu"] });
});
