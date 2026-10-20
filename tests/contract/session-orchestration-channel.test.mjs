import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolRefusal,
  startSessionOrchestrationHost,
} from "../support/session-orchestration-host.mjs";

// The channel pipeline is the real one: the bridge starts the session, marks the
// turn as coming from a messaging channel and runs it like an incoming message.
const host = await startSessionOrchestrationHost({
  name: "orchestration-channel",
  settings: ENABLED_SETTINGS,
  modules: { PiSessionBridge: "./src/agent-host/channels/pi-session-bridge.ts" },
});
after(() => host.close());

function binding(cwd) {
  return {
    id: "binding-telegram-one",
    channel: "telegram",
    accountId: "account-one",
    peerKind: "dm",
    peerId: "user-one",
    cwd,
    toolNames: ["session_new", "session_list"],
    createdAt: "2026-08-06T00:00:00.000Z",
    lastUsedAt: "2026-08-06T00:00:00.000Z",
  };
}

function envelope(text) {
  return {
    id: "envelope-one",
    channel: "telegram",
    accountId: "account-one",
    peer: { kind: "dm", id: "user-one" },
    sender: { id: "user-one", name: "User One" },
    text,
    mentionsBot: false,
    attachments: [],
    timestamp: Date.UTC(2026, 7, 6),
  };
}

test(
  "a turn that came in from a messaging channel cannot create or reach other sessions",
  { timeout: 90_000 },
  async () => {
    const cwd = host.workspace("channel-workspace");
    const message = "Please start a helper session for me";
    host.model.script(message, [
      { toolCall: { name: "session_new", input: { message: "Channel spawned this" } } },
      { toolCall: { name: "session_list", input: { scope: "all" } } },
      { text: "I cannot do that here" },
    ]);
    const bridge = new host.module.PiSessionBridge(() => undefined);

    const before = (await host.sessions()).length;
    const result = await bridge.runTurn(binding(cwd), envelope(message));

    assert.equal(result.cwd, cwd);
    assert.equal(result.finalText, "I cannot do that here", "the turn itself still finished normally");

    const answered = host.model.toolResults();
    assert.equal(answered.length, 2, "both tool calls reached the model as results");
    expectToolRefusal(answered[0], "a channel turn must not create sessions", /channel/i);
    expectToolRefusal(answered[1], "a channel turn must not list other sessions", /channel/i);

    const sessions = await host.sessions();
    assert.equal(sessions.length, before + 1, "only the channel's own session exists");
    assert.equal(
      sessions.some((session) => session.firstMessage === "Channel spawned this"),
      false,
      "no helper session was created",
    );
  },
);
