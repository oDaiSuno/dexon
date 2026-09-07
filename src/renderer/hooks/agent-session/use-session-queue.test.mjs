import assert from "node:assert/strict";
import test from "node:test";

import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

async function queueHarness(t, hostOverrides = {}, hookOptions = {}) {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail, ...hostOverrides });
  const h = await createSessionHookHarness(t, { bundleName: "session-queue", host });
  await h.mount({ session: detail.info, newSessionCwd: null, ...hookOptions });
  await h.flush();
  return { h, host, detail };
}

test("steer sends the running agent a steering command", async (t) => {
  const { h, host } = await queueHarness(t);
  await h.act(() => h.state.handleSteer("adjust course"));
  assert.deepEqual(host.sendCommands.find((c) => c.payload.type === "steer")?.payload, {
    type: "steer",
    message: "adjust course",
  });
});

test("a failed steer notifies that nothing was queued and rethrows", async (t) => {
  const { h } = await queueHarness(t, {
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "steer") throw new Error("host refused");
      return {};
    },
  });
  await assert.rejects(async () => {
    await h.act(async () => {
      await h.state.handleSteer("adjust course");
    });
  }, /host refused/);
  await h.flush();
  assert.ok(h.state.notices.some((n) => n.type === "error" && n.message.includes("not queued")));
});

test("queueing without an active session is a loud failure, not a silent drop", async (t) => {
  const host = createSessionTestHost({});
  const h = await createSessionHookHarness(t, { bundleName: "session-queue-nosid", host });
  await h.mount({ session: null, newSessionCwd: null });
  await h.flush();

  await assert.rejects(async () => {
    await h.act(async () => {
      await h.state.handleSteer("x");
    });
  }, /no longer available/);
  await h.flush();
  assert.ok(h.state.notices.some((n) => n.type === "error" && n.message.includes("not queued")));
});

test("follow-up and streaming-behavior prompts reach the host verbatim", async (t) => {
  const { h, host } = await queueHarness(t);

  await h.act(() => h.state.handleFollowUp("later please"));
  assert.deepEqual(host.sendCommands.find((c) => c.payload.type === "follow_up")?.payload, {
    type: "follow_up",
    message: "later please",
  });

  await h.act(() => h.state.handlePromptWithStreamingBehavior("mid run", "steer"));
  assert.deepEqual(host.sendCommands.find((c) => c.payload.streamingBehavior === "steer")?.payload, {
    type: "prompt",
    message: "mid run",
    streamingBehavior: "steer",
  });
});

test("a failed follow-up notifies that nothing was queued and rethrows", async (t) => {
  const { h } = await queueHarness(t, {
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "follow_up") throw new Error("host refused the follow-up");
      return {};
    },
  });
  await assert.rejects(async () => {
    await h.act(async () => {
      await h.state.handleFollowUp("later please");
    });
  }, /host refused the follow-up/);
  await h.flush();
  assert.ok(h.state.notices.some((n) => n.type === "error" && n.message.includes("not queued")));
});

test("a failed streaming-behavior prompt notifies that nothing was queued and rethrows", async (t) => {
  const { h } = await queueHarness(t, {
    sendAgentCommand: async (sid, payload) => {
      if (payload.streamingBehavior === "followUp") throw new Error("host refused the queued prompt");
      return {};
    },
  });
  await assert.rejects(async () => {
    await h.act(async () => {
      await h.state.handlePromptWithStreamingBehavior("mid run", "followUp");
    });
  }, /host refused the queued prompt/);
  await h.flush();
  assert.ok(h.state.notices.some((n) => n.type === "error" && n.message.includes("not queued")));
});

test("recalling the queue clears it locally and returns the texts to the input", async (t) => {
  const prepends = [];
  const { h, host } = await queueHarness(
    t,
    {
      sendAgentCommand: async (sid, payload) => {
        if (payload.type === "clear_queue") return { steering: ["a"], followUp: ["b"] };
        return {};
      },
    },
    {
      chatInputRef: { current: { prependText: (text) => prepends.push(text) } },
    },
  );
  h.emit({ type: "queue_update", steering: ["a"], followUp: ["b"] });
  await h.flush();
  assert.deepEqual(h.state.queuedMessages, { steering: ["a"], followUp: ["b"] });

  await h.act(() => h.state.handleRecallQueue());
  await h.flush();
  assert.ok(host.sendCommands.some((c) => c.payload.type === "clear_queue"));
  assert.deepEqual(h.state.queuedMessages, { steering: [], followUp: [] }, "local queue cleared immediately");
  assert.deepEqual(prepends, ["a\n\nb"], "recalled texts handed back to the composer");
});

test("aborting compaction and changing thinking level reach the host; auto stays local", async (t) => {
  const { h, host } = await queueHarness(t);

  await h.act(() => h.state.handleAbortCompaction());
  assert.ok(host.sendCommands.some((c) => c.payload.type === "abort_compaction"));

  await h.act(() => h.state.handleThinkingLevelChange("auto"));
  assert.equal(h.state.thinkingLevel, "auto");
  assert.ok(!host.sendCommands.some((c) => c.payload.type === "set_thinking_level"), "auto leaves pi untouched");

  await h.act(() => h.state.handleThinkingLevelChange("high"));
  assert.equal(h.state.thinkingLevel, "high");
  assert.deepEqual(host.sendCommands.find((c) => c.payload.type === "set_thinking_level")?.payload, {
    type: "set_thinking_level",
    level: "high",
  });
});
