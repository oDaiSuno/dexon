import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "../../components/renderer-real-graph.mjs";
import { createFolderBrowserHost } from "../../components/remote-folder-picker/folder-browser-test-helpers.mjs";
import { createSessionDetail, setupSessionHookEnvironment } from "./session-hook-harness.mjs";
import { environmentSession } from "./environment-session-test-support.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

test("a slow initial port handshake recovers live events and runtime reconciliation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const env = setupSessionHookEnvironment();
  const api = await importTestBundle("session-slow-connect-events", {
    ...realRendererGraphOptions(repoRoot),
    stdin: {
      contents: `export {useAgentSession} from "./src/renderer/hooks/useAgentSession.ts";
        export {workspaceStore} from "./src/renderer/lib/workspace-store.ts";
        export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";`,
      resolveDir: repoRoot,
      loader: "ts",
    },
  });

  const detail = createSessionDetail("same-id");
  let runtime = {
    running: false,
    state: { systemPrompt: "initial-prompt", queuedMessages: { steering: [], followUp: [] } },
  };
  const host = await createFolderBrowserHost(api, {
    target: globalThis.window,
    reply(_id, method) {
      if (method === "sessions.get") return { ...detail, agentState: runtime };
      if (method === "sessions.context") return { context: detail.context };
      if (method === "agent.state") return runtime;
      if (method === "models.list") return { models: [], nameMap: {}, catalog: {}, defaultModel: null };
      return { ok: true };
    },
  });

  const realRequestPort = globalThis.window.piBridge.requestEnvironmentPort.bind(globalThis.window.piBridge);
  let delayFirstPort = true;
  let releaseDelayedPort = null;
  globalThis.window.piBridge.requestEnvironmentPort = (environmentId) => {
    if (environmentId === "gpu" && delayFirstPort) {
      delayFirstPort = false;
      releaseDelayedPort = () => realRequestPort(environmentId);
      return;
    }
    realRequestPort(environmentId);
  };

  api.environmentRegistry.initialize();
  api.environmentRegistry.registerSession("gpu", "same-id");

  let state;
  let renderer;
  function Probe() {
    state = api.useAgentSession({
      session: { ...detail.info, environmentId: "gpu" },
      newSessionCwd: null,
    });
    return null;
  }
  t.after(async () => {
    await act(async () => renderer?.unmount());
    host.close();
    env.restore();
  });

  await act(async () => {
    renderer = create(createElement(Probe));
  });
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => new Promise((resolve) => setImmediate(resolve)));
    }
  };
  await flush();

  await act(async () => {
    t.mock.timers.tick(5_100);
  });
  await flush();

  await act(async () => {
    releaseDelayedPort();
  });
  await flush();

  assert.equal(state.error, null, "loadSession cleared error once port arrived at 5.1s");

  await host.disconnect("gpu");
  runtime = {
    running: true,
    state: {
      isStreaming: true,
      systemPrompt: "recovered-prompt",
      streamingMessage: {
        role: "assistant",
        timestamp: 99,
        content: [{ type: "text", text: "Streaming after reconnect" }],
      },
    },
  };
  await host.reconnect("gpu", 2);
  await flush();

  const agentStateCallsOnGen2 = host.requests.filter((r) => r.method === "agent.state").length;
  console.log(
    JSON.stringify({
      errorShownToUser: state.error,
      agentRunningAfterReconnect: state.agentRunning,
      systemPromptAfterReconnect: state.systemPrompt,
      agentStateCallsAfterReconnect: agentStateCallsOnGen2,
    }),
  );

  assert.equal(
    state.systemPrompt,
    "recovered-prompt",
    "open session must retain its agent.events subscription and reconcile on reconnect after a >5s initial port handshake",
  );
  assert.equal(state.agentRunning, true);
});

test("a stream already running before disconnect is reconciled to the current partial response on reconnect", async (t) => {
  const h = await environmentSession(t);
  const before = { role: "assistant", content: [{ type: "text", text: "Before disconnect" }], timestamp: 10 };
  const after = {
    role: "assistant",
    content: [{ type: "text", text: "Reply continued while offline" }],
    timestamp: 10,
  };
  await h.act(async () => {
    h.emit("gpu", "agent.events", "same-id", { type: "agent_start" });
    h.emit("gpu", "agent.events", "same-id", { type: "message_update", message: before });
  });
  await h.flush();
  assert.equal(h.state.agentRunning, true);
  assert.equal(h.state.streamState.streamingMessage.content[0].text, "Before disconnect");
  await h.disconnect("gpu");
  h.setRuntime({ running: true, state: { isStreaming: true, isPromptRunning: true, streamingMessage: after } });
  const previousReads = h.requests.filter((r) => r.method === "sessions.get").length;
  const previousStates = h.requests.filter((r) => r.method === "agent.state").length;
  await h.reconnect("gpu", 2);
  await h.flush();
  console.log(
    "agent.state requests during reconnect:",
    h.requests.filter((r) => r.method === "agent.state").length - previousStates,
  );
  console.log(
    "sessions.get requests during reconnect:",
    h.requests.filter((r) => r.method === "sessions.get").length - previousReads,
  );
  console.log("Remote current streaming text:", after.content[0].text);
  console.log("Displayed streaming text:", h.state.streamState.streamingMessage?.content?.[0]?.text);
  console.log("Agent still running:", h.state.agentRunning);
  assert.equal(
    h.state.streamState.streamingMessage?.content?.[0]?.text,
    after.content[0].text,
    "onGap must replace the partial response even if agentRunning was already true",
  );
});
