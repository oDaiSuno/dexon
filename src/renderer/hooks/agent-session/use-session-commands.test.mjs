import assert from "node:assert/strict";
import test from "node:test";

import { createSessionDetail, createSessionHookHarness, createSessionTestHost } from "./session-hook-harness.mjs";

async function commandsHarness(t, hostOverrides = {}, hookOptions = {}) {
  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({ getSession: async () => detail, ...hostOverrides });
  const h = await createSessionHookHarness(t, { bundleName: "session-commands", host });
  await h.mount({ session: detail.info, newSessionCwd: null, ...hookOptions });
  await h.flush();
  return { h, host, detail };
}

test("/compact compacts with custom instructions and reports the result", async (t) => {
  const { h, host } = await commandsHarness(t, {
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "compact") return { tokensBefore: 500, estimatedTokensAfter: 120 };
      return {};
    },
  });

  const result = await h.act(async () => await h.state.handleBuiltinSlashCommand("/compact  keep the plan"));
  await h.flush();
  assert.equal(result.handled, true);
  assert.deepEqual(host.sendCommands.find((c) => c.payload.type === "compact")?.payload, {
    type: "compact",
    customInstructions: "keep the plan",
  });
  assert.deepEqual(h.state.compactResult, { reason: "manual", tokensBefore: 500, estimatedTokensAfter: 120 });
  assert.equal(h.state.isCompacting, false, "compaction released after completion");
});

test("/compact reports failures and cannot run twice at once", async (t) => {
  let compactCalls = 0;
  let resolveCompact;
  const { h } = await commandsHarness(t, {
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "compact") {
        compactCalls += 1;
        if (compactCalls === 1) {
          return new Promise((resolve) => {
            resolveCompact = resolve;
          });
        }
        return {};
      }
      return {};
    },
  });

  const firstResult = h.state.handleBuiltinSlashCommand("/compact");
  await h.flush();
  assert.equal(h.state.isCompacting, true, "the in-flight compaction holds the indicator");

  const guarded = await h.act(async () => await h.state.handleBuiltinSlashCommand("/compact"));
  await h.flush();
  assert.equal(compactCalls, 1, "a running compaction refuses re-entry");
  assert.ok(guarded.error?.length > 0, "re-entry explains itself");

  resolveCompact(Promise.reject(new Error("compactor offline")));
  const result = await firstResult;
  await h.flush();
  assert.equal(result.error, "compactor offline");
  assert.equal(h.state.isCompacting, false, "failure releases the compaction indicator");
});

test("/reload refreshes the session, commands and models together", async (t) => {
  const detail = createSessionDetail("s-1");
  let listModelsCalls = 0;
  const host = createSessionTestHost({
    getSession: async () => detail,
    listModels: async () => {
      listModelsCalls += 1;
      return {
        models: [],
        nameMap: {},
        thinkingLevels: {},
        thinkingLevelMaps: {},
        catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] },
        defaultModel: null,
      };
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "commands-reload", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  const sessionsBefore = host.getCommands.filter((c) => c.rpc === "getSession").length;

  const result = await h.act(async () => await h.state.handleBuiltinSlashCommand("/reload"));
  await h.flush();
  assert.equal(result.handled, true);
  assert.ok(host.sendCommands.some((c) => c.payload.type === "reload"));
  assert.ok(host.getCommands.filter((c) => c.rpc === "getSession").length > sessionsBefore, "session reloaded");
  assert.ok(listModelsCalls >= 2, "model directory reloaded (initial mount + /reload)");
  assert.ok(result.message.includes("Reloaded") || result.message.includes("reloaded"));
});

test("/name renames the session through the host", async (t) => {
  const { h, host } = await commandsHarness(t);

  const result = await h.act(async () => await h.state.handleBuiltinSlashCommand("/name my session"));
  await h.flush();
  assert.equal(result.handled, true);
  assert.deepEqual(host.sendCommands.find((c) => c.payload.type === "set_session_name")?.payload, {
    type: "set_session_name",
    name: "my session",
  });
  assert.ok(result.message.includes("my session"));

  const usage = await h.act(async () => await h.state.handleBuiltinSlashCommand("/name"));
  await h.flush();
  assert.equal(usage.handled, true);
  assert.ok(usage.error?.includes("/name"), "a missing name explains the usage");
});

test("/session opens the stats panel with the host stats", async (t) => {
  const panelOpens = [];
  const { h } = await commandsHarness(
    t,
    {
      sendAgentCommand: async (sid, payload) => {
        if (payload.type === "get_session_stats") {
          return {
            sessionFile: "/fixture/s-1.jsonl",
            sessionId: "s-1",
            totalMessages: 2,
            tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
            cost: 0,
            contextUsage: { percent: 5, contextWindow: 1000, tokens: 50 },
          };
        }
        return {};
      },
    },
    {
      onSessionStatsPanelOpen: () => panelOpens.push(1),
    },
  );

  const result = await h.act(async () => await h.state.handleBuiltinSlashCommand("/session"));
  await h.flush();
  assert.deepEqual(result, { handled: true, action: "openSessionStats" });
  assert.equal(panelOpens.length, 1);
  assert.equal(h.state.sessionStats.sessionId, "s-1", "stats override mirrors the host answer");
  assert.deepEqual(h.state.contextUsage, { percent: 5, contextWindow: 1000, tokens: 50 });
});

test("/copy writes the last assistant text and complains when there is none", async (t) => {
  const writes = [];
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async (text) => writes.push(text) } },
    configurable: true,
  });
  t.after(() => {
    if (originalNavigatorDescriptor) Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    else delete globalThis.navigator;
  });

  const detail = createSessionDetail("s-1");
  const host = createSessionTestHost({
    getSession: async () => detail,
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "get_last_assistant_text") return { text: "the answer" };
      return {};
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "session-commands-copy", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  const result = await h.act(async () => await h.state.handleBuiltinSlashCommand("/copy"));
  await h.flush();
  assert.equal(result.handled, true);
  assert.deepEqual(writes, ["the answer"]);

  host.sendAgentCommand = async (sid, payload) => {
    if (payload.type === "get_last_assistant_text") return { text: "" };
    return {};
  };
  const empty = await h.act(async () => await h.state.handleBuiltinSlashCommand("/copy"));
  await h.flush();
  assert.ok(empty.error?.length > 0, "an empty clipboard source reports why");
});

test("unknown or malformed commands are handed back to the extension layer", async (t) => {
  const { h } = await commandsHarness(t);

  assert.deepEqual(await h.act(async () => await h.state.handleBuiltinSlashCommand("/nosuch")), { handled: false });
  assert.deepEqual(await h.act(async () => await h.state.handleBuiltinSlashCommand("not a command")), {
    handled: false,
  });
});

test("command errors surface as error notices", async (t) => {
  const { h } = await commandsHarness(t, {
    sendAgentCommand: async (sid, payload) => {
      if (payload.type === "set_session_name") throw new Error("rename refused");
      return {};
    },
  });

  const result = await h.act(async () => await h.state.handleBuiltinSlashCommand("/name x"));
  await h.flush();
  assert.equal(result.error, "rename refused");
  assert.ok(h.state.notices.some((n) => n.type === "error" && n.message === "rename refused"));
});
