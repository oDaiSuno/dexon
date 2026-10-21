import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react-test-renderer";

import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

function existingSessionHarness(t, hostOverrides = {}, hookOptions = {}) {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({
    getSession: async () => detail,
    ...hostOverrides,
  });
  return createSessionHookHarness(t, {
    bundleName: "session-actions",
    host,
  }).then((h) => ({
    host,
    detail,
    h,
    async mountVisible(readingVisible = true) {
      await h.mount({ session: detail.info, newSessionCwd: null, readingVisible, ...hookOptions });
    },
  }));
}

test("sending appends an optimistic bubble and enters the streaming state", async (t) => {
  const setup = await existingSessionHarness(t);
  const { h, host } = setup;
  await setup.mountVisible();
  assert.equal(h.state.messages.length, 2, "fixture history loaded");

  await h.act(() => h.state.handleSend("hello there"));
  assert.equal(h.state.messages.length, 3, "optimistic user bubble appended");
  assert.equal(h.state.messages[2].role, "user");
  assert.equal(h.state.messages[2].content, "hello there");
  assert.equal(h.state.agentRunning, true);
  assert.deepEqual(h.state.agentPhase, { kind: "waiting_model" });
  assert.equal(h.state.streamState.isStreaming, true);
  assert.ok(
    host.sendCommands.some((c) => c.payload.type === "prompt" && c.payload.message === "hello there"),
    "prompt command sent to the host",
  );
});

test("a blank message is never sent", async (t) => {
  const setup = await existingSessionHarness(t);
  const { h, host } = setup;
  await setup.mountVisible();

  await h.act(() => h.state.handleSend("   "));
  assert.equal(h.state.agentRunning, false);
  assert.equal(host.sendCommands.length, 0);
  assert.equal(h.state.messages.length, 2);
});

test("sending while a run is active is ignored", async (t) => {
  const setup = await existingSessionHarness(t);
  const { h, host } = setup;
  await setup.mountVisible();

  await h.act(() => h.state.handleSend("first"));
  await h.act(() => h.state.handleSend("second"));
  const prompts = host.sendCommands.filter((c) => c.payload.type === "prompt");
  assert.equal(prompts.length, 1, "only the first prompt reached the host");
});

test("a failed send rolls back the bubble, notifies and rethrows for the draft restore", async (t) => {
  const setup = await existingSessionHarness(t, {
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "prompt") throw new Error("host refused the prompt");
      return {};
    },
  });
  const { h, host } = setup;
  await setup.mountVisible();

  await assert.rejects(
    async () => {
      await h.act(async () => {
        await h.state.handleSend("doomed message");
      });
    },
    /host refused the prompt/,
    "the rejection must propagate so ChatInput can restore the draft",
  );
  await h.flush();
  assert.equal(h.state.messages.length, 2, "optimistic bubble rolled back");
  assert.equal(h.state.agentRunning, false);
  assert.deepEqual(h.state.agentPhase, null);
  assert.equal(h.state.streamState.isStreaming, false);
  assert.ok(
    h.state.notices.some((n) => n.type === "error" && n.message.includes("host refused the prompt")),
    "failure surfaced as an error notice",
  );
  assert.ok(
    host.sendCommands.some((c) => c.payload.type === "prompt"),
    "the attempt did reach the host",
  );
});

test("the first message of a new session prepares, connects, prompts and promotes exactly once", async (t) => {
  const detail = createSessionDetail("s-1");
  const onSessionCreated = [];
  let ensureCalls = 0;
  const host = createSessionTestHost({
    async newAgent() {
      ensureCalls += 1;
      return { sessionId: "fresh-1" };
    },
    getSession: async () => detail,
    shouldAutoTitleMessage: (message) => !message.startsWith("/"),
  });
  const h = await createSessionHookHarness(t, { bundleName: "session-actions-new", host });

  await h.mount({ session: null, newSessionCwd: "/fixture", onSessionCreated: (info) => onSessionCreated.push(info) });
  await h.act(() => h.state.handleSend("kick things off"));
  await h.flush();

  assert.equal(ensureCalls, 1, "ensure_session ran once");
  assert.deepEqual(
    host.sendCommands.find((c) => c.payload.type === "prompt")?.payload,
    { type: "prompt", message: "kick things off" },
    "the typed message is delivered verbatim",
  );
  assert.equal(onSessionCreated.length, 1, "promoted exactly once");
  assert.equal(onSessionCreated[0].id, "fresh-1");
  assert.equal(onSessionCreated[0].cwd, "/fixture");
  assert.equal(onSessionCreated[0].messageCount, 1);
  assert.equal(h.state.isNew, true, "hook stays in the new-session shape until the owner swaps the session prop");
  assert.equal(h.state.agentRunning, true);
  assert.equal(host.autoTitleRequests.length, 1, "auto title requested for the first real message");
  assert.equal(host.autoTitleRequests[0].sessionId, "fresh-1");
});

test("a chosen model is applied to an already-created new session before prompting", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({
    async newAgent() {
      return { sessionId: "fresh-2" };
    },
    getSession: async () => detail,
  });
  const h = await createSessionHookHarness(t, { bundleName: "session-actions-model", host });

  await h.mount({ session: null, newSessionCwd: "/fixture" });
  await h.act(() => h.state.handleSend("first message"));
  await h.flush();
  await h.act(() => h.emit({ type: "agent_end" }));
  await h.flush();
  await h.act(() => h.state.handleModelChange("provider-x", "model-x"));
  await h.flush();
  await h.act(() => h.state.handleSend("second message"));
  await h.flush();

  const setModels = host.sendCommands.filter((c) => c.payload.type === "set_model");
  assert.equal(setModels.length, 2, "set_model applied on the model change and on the second send");
  assert.deepEqual(setModels[0].payload, { type: "set_model", provider: "provider-x", modelId: "model-x" });
  assert.equal(
    host.sendCommands.filter((c) => c.payload.type === "prompt").length,
    2,
    "both prompts delivered; ensure_session stayed deduplicated",
  );
});

test("a slash-command send settles through the host poll when no stream event arrives", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const onAgentEnd = [];
  const setup = await existingSessionHarness(
    t,
    {
      agentState: async () => ({ running: false, state: { isStreaming: false, isPromptRunning: false } }),
    },
    { onAgentEnd: () => onAgentEnd.push(1) },
  );
  const { h, host } = setup;
  await setup.mountVisible();
  await h.env.flushRafUntilSettled();

  await h.act(async () => {
    await h.state.handleSend("/compact");
  });
  await h.flush();
  assert.equal(h.state.agentRunning, true, "slash send starts a run");
  assert.deepEqual(h.state.agentPhase, { kind: "running_command" });
  assert.ok(
    host.sendCommands.some((c) => c.payload.type === "prompt" && c.payload.message === "/compact"),
    "the slash prompt reached the host",
  );

  await act(async () => {
    t.mock.timers.tick(1_000);
  });
  await h.flush();
  assert.equal(h.state.agentRunning, false, "the settlement poll finished the run");
  assert.equal(h.state.streamState.isStreaming, false);
  assert.equal(onAgentEnd.length, 1, "completion notified exactly once");
});

test("a settlement poll for a superseded run cannot finish the newer run", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const onAgentEnd = [];
  const agentStateResolvers = [];
  const setup = await existingSessionHarness(
    t,
    {
      agentState: () => new Promise((resolve) => agentStateResolvers.push(resolve)),
    },
    { onAgentEnd: () => onAgentEnd.push(1) },
  );
  const { h } = setup;
  await setup.mountVisible();
  await h.env.flushRafUntilSettled();

  // Run A: a slash send schedules a settlement poll.
  await h.act(async () => {
    await h.state.handleSend("/a");
  });
  await h.flush();
  await act(async () => {
    t.mock.timers.tick(800);
  });
  await h.flush();
  assert.equal(agentStateResolvers.length, 1, "run A's poll is in flight");

  // Run A ends over the stream; run B starts while A's poll is still pending.
  await h.act(() => {
    h.emit({ type: "agent_end" });
  });
  await h.flush();
  await h.act(async () => {
    await h.state.handleSend("/b");
  });
  await h.flush();
  assert.equal(h.state.agentRunning, true, "run B is alive");

  // Release run A's poll answer: it must not finish run B.
  agentStateResolvers[0]({ running: false, state: {} });
  await h.flush();
  assert.equal(h.state.agentRunning, true, "the stale poll for run A cannot finish run B");
  assert.equal(onAgentEnd.length, 1, "only run A's agent_end notified");

  // Run B's own settlement still works.
  await act(async () => {
    t.mock.timers.tick(800);
  });
  await h.flush();
  assert.equal(agentStateResolvers.length, 3, "run B's poll started (A poll, agent_end state, B poll)");
  agentStateResolvers[2]({ running: false, state: {} });
  await h.flush();
  assert.equal(h.state.agentRunning, false, "run B settles through its own poll");
  assert.equal(onAgentEnd.length, 2);
});

test("abort asks the host to stop the run and tolerates failures", async (t) => {
  const setup = await existingSessionHarness(t, {
    sendAgentCommand: async (_sid, payload) => {
      if (payload.type === "abort") throw new Error("abort failed");
      return {};
    },
  });
  const { h, host } = setup;
  await setup.mountVisible();

  await h.act(() => h.state.handleAbort());
  assert.ok(
    host.sendCommands.some((c) => c.payload.type === "abort"),
    "abort command sent",
  );
  assert.equal(h.state.agentRunning, false, "abort does not itself flip the running flag");
});

test("fork reports the new session only when the host did not cancel", async (t) => {
  const detail = createSessionDetail("s-1");
  const onSessionForked = [];
  const host = createSessionTestHost({
    getSession: async () => detail,
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "fork") return { cancelled: false, newSessionId: "forked-9" };
      return {};
    },
  });
  const h = await createSessionHookHarness(t, {
    bundleName: "session-actions-fork",
    host,
  });
  await h.mount({ session: detail.info, newSessionCwd: null, onSessionForked: (id) => onSessionForked.push(id) });
  await h.flush();

  await h.act(() => h.state.handleFork("entry-1"));
  assert.deepEqual(onSessionForked, ["forked-9"]);
  assert.equal(h.state.forkingEntryId, null, "forking indicator resets");

  host.sendAgentCommand = async () => ({ cancelled: true });
  await h.act(() => h.state.handleFork("entry-2"));
  assert.deepEqual(onSessionForked, ["forked-9"], "cancelled fork does not report a session");
});

test("switching versions asks the host first and loads the returned context only after success", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContext: async () => ({
      context: { messages: [], entryIds: [], historyRevision: "ctx-1", previousCursor: null },
    }),
    agentState: async () => ({ running: false, state: {} }),
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "switch_version") throw new Error("switch refused");
      return {};
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "session-actions-switch", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  await h.act(() => h.state.handleSwitchVersion("version-a"));
  await h.flush();
  assert.notEqual(h.state.activeLeafId, "version-leaf", "a refused switch leaves the active leaf alone");
  assert.equal(host.sendCommands.filter((c) => c.payload.type === "switch_version").length, 1);
  assert.ok(!host.getCommands.some((c) => c.rpc === "getSessionContext"), "a refused switch loads no context at all");

  host.sendAgentCommand = async (sid, payload) =>
    payload.type === "switch_version" ? { cancelled: false, leafId: "version-leaf" } : {};
  await h.act(() => h.state.handleSwitchVersion("version-b"));
  await h.flush();
  assert.equal(h.state.activeLeafId, "version-leaf", "an accepted switch adopts the leaf the host reports");
  assert.ok(
    host.getCommands.some((c) => c.rpc === "getSessionContext"),
    "context reloaded for the adopted leaf",
  );
});

test("manual compaction reports success and failure without getting stuck", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({
    getSession: async () => detail,
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "compact") return { tokensBefore: 10, estimatedTokensAfter: 4 };
      return {};
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "session-actions-compact", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  await h.act(() => h.state.handleCompact());
  await h.flush();
  assert.deepEqual(h.state.compactResult, {
    reason: "manual",
    tokensBefore: 10,
    estimatedTokensAfter: 4,
  });
  assert.equal(h.state.isCompacting, false, "compaction indicator released");

  host.sendAgentCommand = async () => {
    throw new Error("compaction exploded");
  };
  await h.act(() => h.state.handleCompact());
  await h.flush();
  assert.equal(h.state.compactError, "compaction exploded");
  assert.equal(h.state.compactResult, null, "stale success replaced by the failure");
  assert.equal(h.state.isCompacting, false);
});
