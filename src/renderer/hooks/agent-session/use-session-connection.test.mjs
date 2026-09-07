import assert from "node:assert/strict";
import test from "node:test";

import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

test("concurrent new-session preparation shares one ensure_session call", async (t) => {
  const detail = createSessionDetail("s-1");
  let ensureCalls = 0;
  const host = createSessionTestHost({
    async newAgent() {
      ensureCalls += 1;
      return { sessionId: "fresh-1" };
    },
    getSession: async () => detail,
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "get_commands") {
        return {
          commands: [
            { name: "compact", source: "prompt" },
            { name: "my-skill", source: "skill" },
          ],
        };
      }
      return {};
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "connection-dedup", host });
  await h.mount({ session: null, newSessionCwd: "/fixture" });

  const [first, second] = await Promise.all([h.state.loadSlashCommands(), h.state.loadSlashCommands()]);
  await h.flush();
  assert.equal(ensureCalls, 1, "the ensure promise is shared");
  assert.equal(first.length, 1, "skill commands stay out of the slash palette");
  assert.equal(first[0].name, "compact");
  assert.deepEqual(first, second);
  assert.equal(h.state.slashCommandsLoading, false);
});

test("promotion reports the new session exactly once", async (t) => {
  const detail = createSessionDetail("s-1");
  const onSessionCreated = [];
  let ensureCalls = 0;
  const host = createSessionTestHost({
    async newAgent() {
      ensureCalls += 1;
      return { sessionId: "fresh-2" };
    },
    getSession: async () => detail,
    agentState: async () => ({ running: false, state: {} }),
  });
  const h = await createSessionHookHarness(t, { bundleName: "connection-promote", host });
  await h.mount({ session: null, newSessionCwd: "/fixture", onSessionCreated: (info) => onSessionCreated.push(info) });

  await h.act(async () => {
    await h.state.handleSend("first");
  });
  await h.flush();
  assert.equal(ensureCalls, 1, "the first send prepared the session");
  assert.equal(onSessionCreated.length, 1, "the first send promoted the session");

  // Settle the first run so the second send is not blocked by the running
  // guard: it must reach the promotion path and be stopped by the promotion
  // guard itself.
  h.emit({ type: "agent_end" });
  await h.flush();
  assert.equal(h.state.agentRunning, false, "the first run settled");

  await h.act(async () => {
    await h.state.handleSend("second");
  });
  await h.flush();
  const prompts = host.sendCommands.filter((c) => c.payload.type === "prompt");
  assert.equal(prompts.length, 2, "both sends reached the host");
  assert.equal(ensureCalls, 1, "the second send reused the prepared session");
  assert.equal(onSessionCreated.length, 1, "promotion is guarded against repeats");
  assert.equal(onSessionCreated[0].id, "fresh-2");
});

test("a failed ensure is retried on the next call", async (t) => {
  const detail = createSessionDetail("s-1");
  let attempts = 0;
  const host = createSessionTestHost({
    async newAgent() {
      attempts += 1;
      if (attempts === 1) throw new Error("host cold");
      return { sessionId: "fresh-3" };
    },
    getSession: async () => detail,
  });
  const h = await createSessionHookHarness(t, { bundleName: "connection-retry", host });
  await h.mount({ session: null, newSessionCwd: "/fixture" });

  await assert.rejects(() => h.state.loadSlashCommands(), /host cold/);
  const commands = await h.state.loadSlashCommands();
  assert.equal(attempts, 2, "the failed ensure did not poison the slot");
  assert.deepEqual(commands, [], "unavailable commands surface as an empty list");
  assert.equal(h.state.slashCommandsLoading, false);
});

test("the event stream subscription is wired through the connection module", async (t) => {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, { bundleName: "connection-stream", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  const active = h.host.eventSinks.filter((s) => s.active);
  assert.equal(active.length, 1, "one live agent subscription after mount");
  assert.equal(active[0].sid, "s-1");
  h.emit({ type: "agent_start" });
  await h.flush();
  assert.equal(h.state.agentRunning, true, "stream events reach the event handler");
});
