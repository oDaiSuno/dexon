import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import test from "node:test";

// The idle-eviction timeout (10 minutes) is what retires a live agent session;
// this guard proves the eviction produces the "no live runtime" state that the
// sessions.get context-usage reconstruction relies on. Simulated clock — no
// real waiting.
const { AgentSessionWrapper } = await importTestBundle("src/agent-host/session-idle-eviction", {
  packages: "external",
  stdin: {
    contents: 'export { AgentSessionWrapper } from "./rpc-manager.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "idle-eviction-test-entry.ts",
    loader: "ts",
  },
});

function createInner() {
  let listener = () => undefined;
  return {
    sessionId: "idle-eviction-fixture",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    modelRuntime: { getModel: () => undefined },
    sessionManager: {
      getHeader: () => ({ cwd: "/tmp/idle-eviction" }),
      appendCustomEntry() {},
    },
    settingsManager: {},
    agent: { state: { messages: [] } },
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe(subscriber) {
      listener = subscriber;
      return () => undefined;
    },
    async abort() {},
    async prompt() {
      listener({ type: "agent_end" });
    },
    getLastAssistantText: () => undefined,
  };
}

test("an idle session is evicted so reopening reconstructs usage from the file", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const wrapper = new AgentSessionWrapper(createInner());
  wrapper.start();
  assert.equal(wrapper.isAlive(), true);

  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(wrapper.isAlive(), false);
});
