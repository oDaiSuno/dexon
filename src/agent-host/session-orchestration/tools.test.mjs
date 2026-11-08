import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { importTestBundle } from "#test-bundle";
import { createDeferred } from "#test-timing";
import { ENABLED_SETTINGS, startSessionOrchestrationHost } from "../../../tests/support/session-orchestration-host.mjs";
import { installMainProcessPort } from "../../../tests/fixtures/main-process-port.mjs";

const directory = mkdtempSync(path.join(tmpdir(), "dexon-session-tool-guards-"));
const environment = new Map(
  ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR"].map((name) => [name, process.env[name]]),
);
process.env.PI_CODING_AGENT_DIR = directory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(directory, "sessions");

const main = installMainProcessPort();
after(() => {
  main();
  for (const [name, value] of environment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(directory, { recursive: true, force: true });
});

const {
  AgentSessionWrapper,
  createSessionOrchestrationToolDefinitions,
  initializeSessionOrchestrationService,
  initializeSessionOrchestrationSettings,
  refreshSessionOrchestrationSettings,
  setBrowserSessionSource,
} = await importTestBundle("session-orchestration-tool-guards", {
  packages: "external",
  stdin: {
    contents: [
      'export {AgentSessionWrapper} from "./src/agent-host/agent-session/wrapper.ts";',
      'export {createSessionOrchestrationToolDefinitions} from "./src/agent-host/session-orchestration/tools.ts";',
      'export {initializeSessionOrchestrationService} from "./src/agent-host/session-orchestration/service.ts";',
      'export {initializeSessionOrchestrationSettings, refreshSessionOrchestrationSettings} from "./src/agent-host/session-orchestration/settings.ts";',
      'export {setBrowserSessionSource} from "./src/agent-host/browser-tools.ts";',
    ].join("\n"),
    resolveDir: path.resolve(import.meta.dirname, "../../.."),
    loader: "ts",
  },
});

initializeSessionOrchestrationSettings({ onSettingsChanged() {} });
await refreshSessionOrchestrationSettings();

async function setEnabled(enabled) {
  main.setSessionOrchestrationSettings({ enabled });
  await refreshSessionOrchestrationSettings();
}

test("collaboration tools declare their owner and stay inactive until capability policy enables them", () => {
  const tools = createSessionOrchestrationToolDefinitions();
  assert.equal(tools.length, 9);
  for (const tool of tools) {
    assert.equal(tool.dexonOwner, "orchestration", tool.name);
    assert.equal(tool.exposure, "direct", tool.name);
    assert.equal(tool.defaultActive, false, tool.name);
    assert.ok(tool.promptSnippet.trim().length > 0 && tool.promptSnippet.length <= 120, tool.name);
    assert.doesNotMatch(tool.promptSnippet, /[\r\n]/u, tool.name);
  }
});

test("disabled collaboration tools reject before accessing an uninitialized session service", async () => {
  const sessionManager = SessionManager.inMemory(directory);
  for (const tool of createSessionOrchestrationToolDefinitions()) {
    await assert.rejects(
      tool.execute("disabled", {}, undefined, undefined, { sessionManager }),
      /Enable Session collaboration in Settings first/u,
      tool.name,
    );
  }
});

test("collaboration tools reject messaging-channel turns before accessing a session service", async () => {
  await setEnabled(true);
  const sessionManager = SessionManager.inMemory(directory);
  setBrowserSessionSource(sessionManager, "channel", "telegram");
  for (const tool of createSessionOrchestrationToolDefinitions()) {
    await assert.rejects(
      tool.execute("channel", {}, undefined, undefined, { sessionManager }),
      /unavailable for messaging-channel turns/u,
      tool.name,
    );
  }
});

test("existing collaboration tools reject immediately after Settings revokes the capability", async () => {
  await setEnabled(true);
  initializeSessionOrchestrationService();
  const sessionManager = SessionManager.inMemory(directory);
  const tools = createSessionOrchestrationToolDefinitions();
  const list = tools.find((tool) => tool.name === "session_list");
  const result = await list.execute("enabled", {}, undefined, undefined, { sessionManager });
  assert.deepEqual(JSON.parse(result.content[0].text), { sessions: [] });

  await setEnabled(false);
  for (const tool of tools) {
    await assert.rejects(
      tool.execute("revoked", {}, undefined, undefined, { sessionManager }),
      /Enable Session collaboration in Settings first/u,
      tool.name,
    );
  }
});

function turnSession(t, overrides = {}) {
  const inner = {
    sessionId: `turn-${t.name}`,
    sessionManager: SessionManager.inMemory(directory),
    agent: { state: { messages: [] } },
    isStreaming: false,
    isCompacting: false,
    bindExtensions: async () => {},
    prompt: async () => {},
    getLastAssistantText: () => "",
    ...overrides,
  };
  const session = new AgentSessionWrapper(inner, { intents: new Map() });
  t.after(() => session.destroy());
  return session;
}

test("destroying a session stops every queued collaboration turn without rejecting its callers", async (t) => {
  const session = turnSession(t);
  const held = createDeferred();
  const started = createDeferred();
  const active = session.enqueueTurn(async () => {
    started.resolve();
    await held.promise;
  });
  await started.promise;
  const queued = ["first queued task", "second queued task"].map((message) =>
    session.runOrchestratedTurn({ message, source: { sessionId: "parent" } }),
  );
  const settled = Promise.allSettled(queued);
  session.destroy();
  held.resolve();
  await active;
  assert.deepEqual(
    await settled,
    [
      { status: "fulfilled", value: { stopped: true } },
      { status: "fulfilled", value: { stopped: true } },
    ],
    "closed sessions settle queued callers as stopped rather than leaking a rejection",
  );
  assert.equal(session.isRunning(), false, "a closed queue no longer reports running work");
});

test("a collaboration turn truncated during thinking reports a visible length error instead of an empty reply", async (t) => {
  const session = turnSession(t, {
    async prompt() {
      this.agent.state.messages.push({
        role: "assistant",
        stopReason: "length",
        content: [{ type: "thinking", thinking: "Still reasoning without an answer" }],
      });
    },
  });
  assert.deepEqual(await session.runOrchestratedTurn({ message: "Explain the result" }), {
    error: "Output reached the maximum length limit",
  });
  assert.equal(session.lastTurnErrorMessage(), "Output reached the maximum length limit");
  assert.equal(session.liveStatus(), "error", "session inspection exposes the failed completion");
  assert.equal(session.isRunning(), false);
});

test("a collaboration turn reports extension startup failure as an outcome instead of rejecting", async (t) => {
  const session = turnSession(t, {
    async bindExtensions() {
      throw new Error("Extensions could not start");
    },
  });
  const outcomes = await Promise.allSettled([session.runOrchestratedTurn({ message: "Start the task" })]);
  assert.deepEqual(outcomes, [{ status: "fulfilled", value: { error: "Extensions could not start" } }]);
  assert.equal(session.lastTurnErrorMessage(), "Extensions could not start");
  assert.equal(session.isRunning(), false);
});

test(
  "closing a child with background collaboration turns queued leaves no unhandled rejection",
  { timeout: 60_000 },
  async (t) => {
    const host = await startSessionOrchestrationHost({
      name: "close-queued-child",
      settings: ENABLED_SETTINGS,
      modules: {
        initializeSessionOrchestrationService: "./src/agent-host/session-orchestration/service.ts",
        getRpcSession: "./src/agent-host/rpc-manager.ts",
      },
    });
    t.after(() => host.close());
    const rejections = [];
    const onRejection = (error) => rejections.push(String(error));
    process.on("unhandledRejection", onRejection);
    t.after(() => process.off("unhandledRejection", onRejection));
    const callerId = await host.createUserSession();
    const turns = host.model.script("Start the held worker", [{ hold: true, partial: "Working", rest: " done" }]);
    const service = host.module.initializeSessionOrchestrationService();
    const created = await service.create(callerId, { message: "Start the held worker", wait: false });
    await turns.partialSent(0);
    for (const message of ["Queued task one", "Queued task two"]) {
      await service.prompt(callerId, { sessionId: created.sessionId, message, wait: false });
    }
    const child = host.module.getRpcSession(created.sessionId);
    assert.equal(child.isRunning(), true, "the child has work to cancel before closing");
    assert.deepEqual(await service.close(callerId, created.sessionId), {
      sessionId: created.sessionId,
      status: "closed",
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(rejections, [], "background turns never escape to the process rejection handler");
    assert.equal(child.isRunning(), false, "closing drains the child rather than leaving running work");
    const messages = (await host.detail(created.sessionId)).context.messages;
    assert.equal(
      messages.some((message) => JSON.stringify(message.content).includes("Queued task")),
      false,
    );
    assert.equal((await host.state(callerId)).running, true, "the calling session remains available");
  },
);
