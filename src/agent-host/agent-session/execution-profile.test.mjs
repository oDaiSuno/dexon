import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import { importTestBundle } from "#test-bundle";

const base = mkdtempSync(path.join(tmpdir(), "dexon-automation-profile-"));
const previous = {
  agent: process.env.PI_CODING_AGENT_DIR,
  sessions: process.env.PI_CODING_AGENT_SESSION_DIR,
  offline: process.env.PI_OFFLINE,
};
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
process.env.PI_OFFLINE = "1";
test.after(() => {
  for (const [key, value] of [
    ["PI_CODING_AGENT_DIR", previous.agent],
    ["PI_CODING_AGENT_SESSION_DIR", previous.sessions],
    ["PI_OFFLINE", previous.offline],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(base, { recursive: true, force: true });
});

const runtime = await importTestBundle("automation-execution-profile", {
  packages: "external",
  stdin: {
    contents: `export { AgentSessionWrapper, startRpcSession, getRpcSession } from "./src/agent-host/rpc-manager";
      export * from "./src/agent-host/agent-session/execution-profile";
      export * from "./src/agent-host/agent-session/automation-result-tool";
      export { HeadlessInteractionError } from "./src/agent-host/agent-session/extension-ui";
      export { renderToolchainSection } from "./src/agent-host/agent-session/run-policy";
      export * from "./src/agent-host/session-origin-store";
      export { registerAgentHandlers } from "./src/agent-host/handlers/agent";
      export { registerSessionHandlers } from "./src/agent-host/handlers/sessions";
      export { SessionOrchestrationService } from "./src/agent-host/session-orchestration/service";
      export { setStandaloneMainRequestHandler } from "./src/agent-host/parent-rpc";
      export { initializeSessionLauncher, launchAutomationSession } from "./src/agent-host/session-launcher";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
});
const { AgentSessionWrapper, createAutomationResultSink, createAutomationResultTool, executionProfileExtension } =
  runtime;
const step = { taskId: "task", runId: "run", stepId: "summarize", attemptNo: 1 };
const schema = {
  type: "object",
  properties: { count: { type: "integer", minimum: 0 } },
  required: ["count"],
  additionalProperties: false,
};
const profile = (tools = [], sink = createAutomationResultSink(schema)) => ({
  kind: "automation",
  step,
  tools,
  result: { schema, sink },
});
const caps = { browserToolNames: new Set(["browser_open"]), orchestrationEnabled: true };
const toolResponse = (...calls) => fauxAssistantMessage(calls, { stopReason: "toolUse" });
const toolNames = (tools) => tools.map(({ name }) => name);

async function openAutomation(t, options = {}) {
  const cwd = mkdtempSync(path.join(base, "workspace-"));
  const execution = profile(options.tools);
  const bridge = {};
  const services = await createAgentSessionServices({
    cwd,
    agentDir: path.join(cwd, "agent"),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [executionProfileExtension(() => bridge.wrapper)],
    },
  });
  const faux = fauxProvider();
  services.modelRuntime.registerNativeProvider(faux.provider);
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.create(cwd, path.join(cwd, "sessions")),
    model: faux.getModel(),
    tools: [...execution.tools, "automation_result"],
    customTools: [createAutomationResultTool(execution.result)],
  });
  await options.prepare?.(session, cwd);
  const wrapper = new AgentSessionWrapper(session, {
    profile: execution,
    intents: new Map(),
    toolchain: runtime.renderToolchainSection(7, ["Local fixture"]),
  });
  bridge.wrapper = wrapper;
  wrapper.start();
  t.after(async () => {
    await wrapper.dispose();
    await session.dispose();
  });
  return { wrapper, session, faux, cwd, sink: execution.result.sink };
}

test("empty workspace tools keep Pi's system prompt and toolchain at the actual provider boundary", async (t) => {
  assert.equal(runtime.systemPromptPolicy(profile()), "pi_default");
  const available = ["read", "automation_result", "browser_open", "process_start", "session_new", "ask_user_question"];
  assert.deepEqual(runtime.activeToolNamesFor(profile(["read"]), available, caps), ["read", "automation_result"]);
  const custom = available.map((name) => ({ name }));
  assert.deepEqual(
    runtime.customToolsFor(profile(), custom, () => ({ name: "automation_result" })),
    [{ name: "automation_result" }],
  );
  const { wrapper, session, faux, sink } = await openAutomation(t);
  assert.throws(() => wrapper.executionProfile.tools.push("bash"), TypeError);
  assert.throws(() => {
    wrapper.executionProfile.result.schema.properties.count.minimum = -1;
  }, TypeError);
  wrapper.syncBrowserToolActivation();
  wrapper.syncSessionToolActivation();
  await assert.rejects(
    wrapper.send({ type: "set_tools", toolNames: ["browser_open", "process_start", "session_new"] }),
    /sealed/,
  );
  faux.setResponses([
    (context) => {
      assert.deepEqual(toolNames(getCurrentTools(context.messages)), ["automation_result"]);
      assert.match(getCurrentSystemPrompt(context.messages), /<dexon-toolchain>\nLocal fixture\nrevision 7/);
      return toolResponse(fauxToolCall("automation_result", { count: 2 }));
    },
  ]);
  const observation = await wrapper.runAutomationTurn("Return JSON", { timeoutMs: 2_000, sink });
  assert.deepEqual(observation, {
    kind: "applied",
    output: { result: { count: 2 }, sessionId: session.sessionId, mutatingToolCalls: 0 },
  });
  assert.equal(faux.state.callCount, 1);
});

test("automation and sealed UI requests reject immediately without any pending input", async (t) => {
  for (const execution of [profile(), { kind: "sealed", step }]) {
    const inner = {
      sessionId: `headless-${execution.kind}`,
      agent: { state: { messages: [] } },
      sessionManager: { getHeader: () => ({ cwd: "/isolated" }) },
    };
    const intents = new Map();
    const wrapper = new AgentSessionWrapper(inner, { profile: execution, intents });
    await assert.rejects(wrapper.send({ type: "set_tools", toolNames: ["bash"] }), /sealed/);
    if (execution.kind === "sealed") await assert.rejects(wrapper.configureLaunch({ name: "Unsafe" }), /sealed/);
    assert.equal(intents.size, 0);
    t.after(() => wrapper.destroy());
    const events = [];
    wrapper.onEvent((event) => events.push(event));
    const ui = wrapper.createExtensionUiContext();
    for (const invoke of [
      () => ui.select("Pick", ["one"]),
      () => ui.confirm("Confirm", "Continue?"),
      () => ui.input("Input"),
      () => ui.editor("Edit"),
      () => ui.custom(() => undefined),
      () => wrapper.requestQuestionnaire([]),
    ]) {
      await assert.rejects(
        invoke(),
        (error) => error instanceof runtime.HeadlessInteractionError && error.code === "headless_ui_blocked",
      );
      assert.equal(wrapper.getInteractiveSnapshot().requests.length, 0);
      assert.notEqual(wrapper.liveStatus(), "awaiting_input");
    }
    assert.equal(
      events.filter((event) => event.type === "automation_headless_ui_blocked" && event.reason === "automation").length,
      6,
    );
    assert.equal(events.filter((event) => event.type === "extension_ui_request").length, 0);
  }
});

test("result validation reports exact JSON constraint failures and seals only the first valid payload", () => {
  const strict = {
    type: "object",
    required: ["name", "score", "tags"],
    properties: {
      name: { type: "string", minLength: 2, maxLength: 4 },
      score: { type: "number", minimum: 1, maximum: 9 },
      tags: { type: "array", items: { enum: ["ok"] } },
    },
    additionalProperties: false,
  };
  const sink = createAutomationResultSink(strict);
  let sealed = 0;
  sink.onSealed = () => {
    sealed++;
  };
  for (const value of [
    {},
    { name: "a", score: 0, tags: ["bad"] },
    { name: "large", score: 10, tags: [], extra: true },
  ]) {
    assert.equal(sink.submit(value).isError, true);
    assert.equal(sink.state.status, "invalid");
    assert.ok(sink.state.lastErrors.length > 0);
  }
  assert.equal(sink.state.invalidAttempts, 3);
  const accepted = { name: "fine", score: 5, tags: ["ok"] };
  assert.equal(sink.submit(accepted).isError, false);
  accepted.score = 8;
  assert.equal(sink.state.value.score, 5);
  assert.equal(sink.submit({}).content[0].text, "Result already submitted and sealed.");
  assert.equal(sealed, 1);
  assert.equal(typeof sink.state.submittedAtMs, "number");
});

test("a model can correct an invalid result within the same turn", async (t) => {
  const { wrapper, faux, sink } = await openAutomation(t);
  faux.setResponses([
    toolResponse(fauxToolCall("automation_result", { count: -1 })),
    (context) => {
      assert.ok(context.messages.some((message) => message.role === "toolResult" && message.isError));
      return toolResponse(fauxToolCall("automation_result", { count: 3 }));
    },
  ]);
  const observation = await wrapper.runAutomationTurn("Correct errors", { timeoutMs: 2_000, sink });
  assert.equal(observation.kind, "applied");
  assert.deepEqual(observation.output.result, { count: 3 });
  assert.equal(faux.state.callCount, 2);
});

test("sealing blocks prepared sibling writes and waits for an already running parallel write", async (t) => {
  const release = Promise.withResolvers();
  const started = Promise.withResolvers();
  const { wrapper, faux, sink, cwd } = await openAutomation(t, {
    tools: ["write"],
    prepare(session) {
      const definition = session.getToolDefinition("write");
      const execute = definition.execute.bind(definition);
      definition.execute = async (...args) => {
        started.resolve();
        await release.promise;
        return execute(...args);
      };
    },
  });
  faux.setResponses([
    toolResponse(
      fauxToolCall("write", { path: "before.txt", content: "committed" }),
      fauxToolCall("automation_result", { count: 1 }),
      fauxToolCall("write", { path: "after.txt", content: "forbidden" }),
    ),
  ]);
  const sealed = Promise.withResolvers();
  sink.onSeal(() => sealed.resolve());
  let settled = false;
  const observation = wrapper.runAutomationTurn("Parallel batch", { timeoutMs: 2_000, sink }).then((value) => {
    settled = true;
    return value;
  });
  t.after(() => release.resolve());
  await started.promise;
  await sealed.promise;
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(existsSync(path.join(cwd, "before.txt")), false);
  assert.equal(existsSync(path.join(cwd, "after.txt")), false);
  release.resolve();
  const result = await observation;
  assert.equal(result.kind, "applied");
  assert.equal(result.output.mutatingToolCalls, 1);
  assert.equal(readFileSync(path.join(cwd, "before.txt"), "utf8"), "committed");
  assert.equal(existsSync(path.join(cwd, "after.txt")), false);
  assert.equal(faux.state.callCount, 1);
});

for (const ending of ["timeout", "aborted", "agent_no_result"]) {
  for (const mutating of [false, true]) {
    test(`${ending} reports ${mutating ? "possible writes" : "no writes"}`, { timeout: 5_000 }, async (t) => {
      const started = Promise.withResolvers();
      const toolName = mutating ? "write" : "read";
      const { wrapper, faux, sink, cwd } = await openAutomation(t, {
        tools: [toolName],
        prepare(session, directory) {
          writeFileSync(path.join(directory, "source.txt"), "read only");
          if (ending === "agent_no_result") return;
          const definition = session.getToolDefinition(toolName);
          const execute = definition.execute.bind(definition);
          definition.execute = async (...args) => {
            const result = await execute(...args);
            started.resolve();
            const signal = args[2];
            if (!signal.aborted)
              await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
            return result;
          };
        },
      });
      faux.setResponses([
        toolResponse(
          fauxToolCall(toolName, mutating ? { path: "effect.txt", content: "written" } : { path: "source.txt" }),
        ),
        fauxAssistantMessage("No structured result"),
      ]);
      const controller = new globalThis.AbortController();
      const running = wrapper.runAutomationTurn("Observe effect", {
        timeoutMs: ending === "timeout" ? 150 : 2_000,
        signal: controller.signal,
        sink,
      });
      if (ending === "aborted") {
        await started.promise;
        controller.abort();
      }
      const observation = await running;
      assert.equal(observation.kind, mutating ? "maybe_applied" : "not_applied");
      assert.equal(observation.error.code, ending);
      if (!mutating) assert.equal(observation.transient, ending !== "agent_no_result");
      else {
        assert.equal(observation.error.detail.mutatingToolCalls, 1);
        assert.equal(readFileSync(path.join(cwd, "effect.txt"), "utf8"), "written");
      }
    });
  }
}

test("persisted automation stays sealed with isolated metadata and origin-aware mutation permissions", () => {
  const file = path.join(base, "origins.json");
  const store = new runtime.SessionOriginStore(file);
  const originalStep = { ...step };
  store.set("historical", { relation: "automation", automationStep: originalStep, createdAt: "2026-01-01" });
  originalStep.taskId = "changed";
  store.set("legacy", { relation: "automation", createdAt: "old" });
  store.set("malformed", {
    relation: "automation",
    createdAt: "old",
    sourceType: 17,
    automationStep: { ...step, attemptNo: 0 },
  });
  const reopened = new runtime.SessionOriginStore(file);
  assert.deepEqual(reopened.get("historical").automationStep, step);
  reopened.get("historical").automationStep.taskId = "changed";
  assert.deepEqual(reopened.get("historical").automationStep, step);
  const authorize = (id, operation, activeIds) =>
    runtime.SessionAccess.authorizeMutation(reopened, id, operation, { activeAutomationSessionIds: activeIds });
  for (const operation of ["agent_command", "rename", "session_prompt"])
    assert.throws(() => authorize("historical", operation), /sealed/);
  for (const type of "get_state get_tools get_commands get_session_stats get_last_assistant_text".split(" "))
    assert.equal(runtime.isReadOnlyAgentCommand(type), true);
  for (const type of ["prompt", "set_tools", "abort", "unknown", undefined])
    assert.equal(runtime.isReadOnlyAgentCommand(type), false);
  const activeIds = new Set(["historical", "delegate", "fork", "channel"]);
  assert.throws(() => authorize("historical", "delete", activeIds), /active/);
  assert.doesNotThrow(() => authorize("historical", "delete"));
  for (const id of ["legacy", "malformed"]) {
    assert.deepEqual(reopened.get(id), { relation: "automation", createdAt: "old" });
    assert.equal(runtime.profileFromOrigin(reopened.get(id)).kind, "sealed");
    assert.throws(() => authorize(id, "session_prompt"), /sealed/);
  }
  for (const relation of ["delegate", "fork", "channel"]) {
    reopened.set(relation, { relation, createdBySessionId: "creator", createdAt: "old" });
    assert.equal(runtime.profileFromOrigin(reopened.get(relation)).kind, "interactive");
    assert.doesNotThrow(() => authorize(relation, "delete", activeIds));
  }
});

function mainToolchainBoundary(observe = () => {}) {
  runtime.setStandaloneMainRequestHandler(async (method, params) => {
    observe(method);
    if (method === "toolchain.getSnapshot")
      return {
        revision: 9,
        defaults: {},
        candidates: [],
        platform: process.platform,
        arch: process.arch,
        publicState: {},
      };
    if (method === "toolchain.resolve")
      return {
        id: "local-resolution",
        inventoryRevision: 9,
        workspaceKey: params.cwd,
        requirementsHash: "local",
        commands: {},
        summary: ["Local toolchain"],
      };
    throw new Error(`Unexpected main request ${method}`);
  });
}

test("RPC persists origins before startup and reopens sealed", { timeout: 10_000 }, async (t) => {
  const cwd = mkdtempSync(path.join(base, "rpc-workspace-"));
  const marker = path.join(cwd, "extension-ran");
  const extensionDir = path.join(process.env.PI_CODING_AGENT_DIR, "extensions");
  mkdirSync(extensionDir, { recursive: true });
  const extensionFile = path.join(extensionDir, "forbidden.ts");
  writeFileSync(
    extensionFile,
    `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "loaded"); export default function(pi) { pi.registerCommand("forbidden", {handler:async()=>{}}); }`,
  );
  t.after(() => rmSync(extensionFile, { force: true }));
  let observedBeforeWrapper = false;
  mainToolchainBoundary((method) => {
    if (method !== "toolchain.resolve") return;
    const persisted = JSON.parse(
      readFileSync(path.join(process.env.PI_CODING_AGENT_DIR, "desktop", "session-origins.json"), "utf8"),
    );
    observedBeforeWrapper = Object.values(persisted.sessions).some(
      (origin) => origin.automationStep?.runId === "rpc-run",
    );
  });
  t.after(() => runtime.setStandaloneMainRequestHandler(null));
  const execution = { ...profile(), step: { ...step, runId: "rpc-run" } };
  const launched = await runtime.startRpcSession("rpc-auto-new", "", cwd, undefined, undefined, {
    profile: execution,
    origin: { relation: "automation", sourceType: "automation", automationStep: execution.step },
  });
  const wrapper = launched.session;
  t.after(() => wrapper.dispose());
  assert.equal(observedBeforeWrapper, true);
  assert.equal(existsSync(marker), false);
  assert.deepEqual(toolNames(wrapper.inner.getAllTools()), ["automation_result"]);
  const handlers = {};
  const server = { handle: (next) => Object.assign(handlers, next), emit() {} };
  runtime.registerAgentHandlers(server);
  runtime.registerSessionHandlers(server, { managedProcesses: { activeForSession: () => [] } });
  await assert.rejects(handlers["sessions.delete"]({ id: wrapper.sessionId, force: true }), /active/);
  const orchestration = new runtime.SessionOrchestrationService();
  await assert.rejects(
    orchestration.prompt("another-session", { sessionId: wrapper.sessionId, message: "Unsafe" }),
    /sealed/,
  );
  assert.equal(orchestration.runningAgentSessions(), 0);
  await wrapper.inner.reload();
  wrapper.syncBrowserToolActivation();
  wrapper.syncSessionToolActivation();
  assert.deepEqual(wrapper.inner.getActiveToolNames(), ["automation_result"]);
  const faux = fauxProvider();
  wrapper.inner.modelRuntime.registerNativeProvider(faux.provider);
  await wrapper.inner.setModel(faux.getModel());
  faux.setResponses([toolResponse(fauxToolCall("automation_result", { count: 4 }))]);
  assert.equal(
    (await wrapper.runAutomationTurn("Persist result", { timeoutMs: 2_000, sink: execution.result.sink })).kind,
    "applied",
  );
  const sessionFile = wrapper.sessionFile;
  await wrapper.dispose();
  const opened = await runtime.startRpcSession(wrapper.sessionId, sessionFile, cwd);
  t.after(() => opened.session.dispose());
  assert.equal(opened.session.executionProfile.kind, "sealed");
  assert.deepEqual(opened.session.inner.getAllTools(), []);
  await assert.rejects(
    handlers["agent.command"]({ sessionId: wrapper.sessionId, command: { type: "prompt", message: "Unsafe" } }),
    /sealed/,
  );
  await assert.rejects(handlers["sessions.rename"]({ id: wrapper.sessionId, name: "Unsafe" }), /sealed/);
  assert.throws(() => opened.session.runOrchestratedTurn({ message: "Unsafe" }), /sealed/);
  assert.equal(existsSync(marker), false);
});

test("the automation launch handle settles after disposal, retains sealed history, and cannot run twice", async (t) => {
  const cwd = mkdtempSync(path.join(base, "launch-workspace-"));
  const events = [];
  runtime.initializeSessionLauncher({ emit: (...event) => events.push(event), handle() {} });
  mainToolchainBoundary();
  t.after(() => runtime.setStandaloneMainRequestHandler(null));
  const handle = await runtime.launchAutomationSession({
    cwd,
    step: { ...step, runId: "launch-run" },
    tools: [],
    resultSchema: schema,
    name: "Automated summary",
  });
  t.after(() => handle.dispose());
  const session = runtime.getRpcSession(handle.sessionId);
  assert.equal(session.inner.sessionName, "Automated summary");
  const faux = fauxProvider();
  session.inner.modelRuntime.registerNativeProvider(faux.provider);
  await session.inner.setModel(faux.getModel());
  faux.setResponses([toolResponse(fauxToolCall("automation_result", { count: 6 }))]);
  const observation = await handle.runTurn("Finish", { timeoutMs: 2_000 });
  assert.equal(observation.kind, "applied");
  assert.deepEqual(observation.output.result, { count: 6 });
  assert.equal(runtime.getRpcSession(handle.sessionId), undefined);
  assert.equal(runtime.getSessionOrigin(handle.sessionId).relation, "automation");
  assert.equal(events.filter(([topic]) => topic === "sessions.changed").length, 0);
  assert.equal((await handle.runTurn("Again", { timeoutMs: 2_000 })).error.code, "invalid_input");
  await Promise.all([handle.dispose(), handle.dispose()]);
});
