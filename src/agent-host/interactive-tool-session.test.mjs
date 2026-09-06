import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  createEventBus,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { importTestBundle } from "#test-bundle";
const { AgentSessionWrapper, InteractiveToolStore, createQuestionnaireOverride } = await importTestBundle(
  "interactive-session",
  {
    packages: "external",
    tsconfig: "tsconfig.renderer.json",
    stdin: {
      contents:
        'export {AgentSessionWrapper} from "./src/agent-host/rpc-manager"; export {InteractiveToolStore} from "./src/renderer/lib/interactive-tool-store"; export {createQuestionnaireOverride} from "./src/agent-host/agent-session/questionnaire-adapter";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
  },
);

async function createSdkFixture(t, factory, extraOptions = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "dexon-interactive-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const cwd = path.join(base, "project"),
    agentDir = path.join(base, "agent"),
    sessionDir = path.join(base, "sessions");
  [cwd, agentDir, sessionDir].forEach((dir) => mkdirSync(dir));
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: {
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [{ name: "interactive-fixture", factory }],
      ...extraOptions,
    },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.create(cwd, sessionDir),
  });
  const wrapper = new AgentSessionWrapper(session, undefined, () => {});
  wrapper.start();
  t.after(async () => {
    await wrapper.dispose();
    await session.dispose();
  });
  return { services, session, wrapper };
}

test(
  "real SDK command: trigger, collapse, read context, reconnect, answer, finish and continue",
  { timeout: 10000 },
  async (t) => {
    let continued = 0;
    let answer;
    const ended = Promise.withResolvers();
    const ready = Promise.withResolvers();
    const { wrapper } = await createSdkFixture(t, (pi) => {
      pi.registerCommand("interactive-fixture", {
        handler: async (_args, ctx) => {
          answer = await ctx.ui.input("Read context and return");
          continued++;
          ctx.ui.notify("Command continued after answer", "info");
        },
      });
    });
    const data = new Map();
    const storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    };
    const commands = [];
    const send = (_sid, command) => {
      commands.push(command);
      return wrapper.send(command);
    };
    let store = new InteractiveToolStore(wrapper.sessionId, send, storage);
    let unsubscribe = wrapper.onEvent((event) => {
      if (event.type === "extension_ui_snapshot") {
        store.reconcile(event.snapshot);
        if (event.snapshot.requests.length) ready.resolve(event.snapshot.requests[0]);
      }
      if (event.type === "prompt_error") ended.reject(new Error(event.errorMessage));
      if (event.type === "prompt_done") ended.resolve();
    });
    await wrapper.send({ type: "prompt", message: "/interactive-fixture" });
    const request = await ready.promise;
    store.updateDraft(request.id, (d) => ({ ...d, value: "actual SDK answer" }));
    store.setCollapsed(request.id, true);
    assert.equal(continued, 0);
    assert.equal(wrapper.getInteractiveSnapshot().requests.length, 1);
    assert.deepEqual(commands, [], "reading/collapsing never responds to the tool");
    unsubscribe();
    store = new InteractiveToolStore(wrapper.sessionId, send, storage);
    unsubscribe = wrapper.onEvent((event) => {
      if (event.type === "extension_ui_snapshot") store.reconcile(event.snapshot);
      if (event.type === "prompt_done") ended.resolve();
    });
    t.after(unsubscribe);
    assert.equal(store.getSnapshot().entries[0].draft.collapsed, true);
    store.setCollapsed(request.id, false);
    await store.respond(request.id, { value: store.getSnapshot().entries[0].draft.value });
    await ended.promise;
    assert.equal(answer, "actual SDK answer");
    assert.equal(continued, 1);
    assert.equal(wrapper.getInteractiveSnapshot().requests.length, 0);
    assert.equal(wrapper.isRunning(), false);
  },
);

test(
  "public SDK override preserves tool registration, toggles, full input, events and result meaning",
  { timeout: 10000 },
  async (t) => {
    const events = createEventBus();
    const observed = [];
    events.on("rpiv:ask-user:blocked", (data) => observed.push(data));
    const bridge = {};
    const questions = [
      {
        question: "Which options?",
        header: "Options",
        multiSelect: true,
        options: [
          { label: "One", description: "First", preview: "untruncated\n".repeat(100) },
          { label: "Two", description: "Second" },
        ],
      },
    ];
    let originalCalls = 0;
    const adapter = createQuestionnaireOverride({
      events,
      supportsSource: () => true,
      request: (q, signal) => bridge.wrapper.requestQuestionnaire(q, signal),
    });
    const { services, session, wrapper } = await createSdkFixture(
      t,
      (pi) => {
        pi.registerTool({
          name: "ask_user_question",
          label: "Questionnaire",
          description: "Fixture questionnaire",
          parameters: { type: "object", properties: { questions: { type: "array" } } },
          async execute() {
            originalCalls++;
            return { content: [{ type: "text", text: "fallback" }] };
          },
        });
      },
      { eventBus: events, extensionsOverride: adapter },
    );
    bridge.wrapper = wrapper;
    await wrapper.send({ type: "get_commands" });
    const registered = services.resourceLoader
      .getExtensions()
      .extensions.flatMap((ext) => [...ext.tools.values()])
      .find((tool) => tool.definition.name === "ask_user_question");
    assert.ok(registered);
    session.setActiveToolsByName([]);
    assert.deepEqual(session.getActiveToolNames(), []);
    assert.ok(session.getAllTools().some((tool) => tool.name === "ask_user_question"));
    session.setActiveToolsByName(["ask_user_question"]);
    assert.ok(session.getActiveToolNames().includes("ask_user_question"));
    const resultPromise = registered.definition.execute("call", { questions }, undefined, undefined, {
      hasUI: true,
      mode: "rpc",
    });
    const snapshot = wrapper.getInteractiveSnapshot();
    assert.deepEqual(snapshot.requests[0].questions, questions);
    await wrapper.send({
      type: "extension_ui_response",
      id: snapshot.requests[0].id,
      answers: [{ selected: [0, 1], text: "supplement" }],
    });
    const result = await resultPromise;
    assert.equal(originalCalls, 0);
    assert.deepEqual(result.details.answers[0].selected, ["One", "Two"]);
    assert.equal(result.details.answers[0].notes, "supplement");
    assert.deepEqual(observed, [{ active: true }, { active: false }]);
    await registered.definition.execute("fallback", { questions: [] }, undefined, undefined, {
      hasUI: true,
      mode: "rpc",
    });
    assert.equal(originalCalls, 1);
  },
);

test("unrelated same-named tools are not replaced", () => {
  const definition = { name: "ask_user_question", execute() {} };
  const registered = { definition };
  const extension = { resolvedPath: "/unrelated/permission.ts", tools: new Map([["ask_user_question", registered]]) };
  const override = createQuestionnaireOverride({
    events: { emit() {} },
    supportsSource: () => false,
    request: async () => undefined,
  });
  const result = override({ extensions: [extension], errors: [], runtime: {} });
  assert.equal(result.extensions[0], extension);
  assert.equal(result.extensions[0].tools.get("ask_user_question"), registered);
});

test(
  "a deterministic model tool call receives the full questionnaire and resumes exactly once",
  { timeout: 10000 },
  async (t) => {
    const { createFauxCore, fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
    const provider = "interactive-model-fixture";
    const modelId = "questionnaire-model";
    const faux = createFauxCore({
      api: provider,
      provider,
      models: [{ id: modelId, name: "Questionnaire fixture", reasoning: false, input: ["text"] }],
    });
    const questions = [
      {
        question: "Pick and explain?",
        header: "Choice",
        multiSelect: true,
        options: [
          { label: "One", description: "First", preview: "complete\npreview" },
          { label: "Two", description: "Second" },
        ],
      },
    ];
    const observed = [];
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("ask_user_question", { questions }), { stopReason: "toolUse" }),
      (context) => {
        const result = context.messages.find(
          (message) => message.role === "toolResult" && message.toolName === "ask_user_question",
        );
        assert.ok(result, "the model must actually receive a tool result");
        observed.push(result);
        assert.match(JSON.stringify(result.content), /One, Two/);
        assert.match(JSON.stringify(result.content), /original notes/);
        return fauxAssistantMessage("Continued with all answers.");
      },
    ]);
    const events = createEventBus();
    const bridge = {};
    const { session, wrapper } = await createSdkFixture(
      t,
      (pi) => {
        pi.registerTool({
          name: "ask_user_question",
          label: "Questionnaire",
          description: "Ask fixture questions",
          parameters: { type: "object", properties: { questions: { type: "array" } }, required: ["questions"] },
          async execute() {
            throw new Error("The sequential fallback must not execute in desktop mode");
          },
        });
      },
      {
        eventBus: events,
        extensionsOverride: createQuestionnaireOverride({
          events,
          supportsSource: () => true,
          request: (q, signal) => bridge.wrapper.requestQuestionnaire(q, signal),
        }),
      },
    );
    bridge.wrapper = wrapper;
    session.modelRuntime.registerProvider(provider, {
      name: "Local fixture only",
      api: provider,
      apiKey: "local-fixture-no-network",
      baseUrl: "http://127.0.0.1:0",
      streamSimple: faux.streamSimple,
      models: [
        {
          id: modelId,
          name: "Questionnaire fixture",
          api: provider,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32000,
          maxTokens: 2048,
        },
      ],
    });
    await wrapper.send({ type: "get_commands" });
    session.setActiveToolsByName(["ask_user_question"]);
    await wrapper.send({ type: "set_model", provider, modelId });
    const ready = Promise.withResolvers();
    const ended = Promise.withResolvers();
    wrapper.onEvent((event) => {
      if (event.type === "extension_ui_snapshot" && event.snapshot.requests.length)
        ready.resolve(event.snapshot.requests[0]);
      if (event.type === "prompt_error") {
        ready.reject(new Error(event.errorMessage));
        ended.reject(new Error(event.errorMessage));
      }
      if (event.type === "prompt_done") ended.resolve();
    });
    await wrapper.send({ type: "prompt", message: "Ask me through the fixture tool." });
    const request = await ready.promise;
    assert.deepEqual(request.questions, questions);
    const response = {
      type: "extension_ui_response",
      id: request.id,
      answers: [{ selected: [0, 1], text: "original notes" }],
    };
    await wrapper.send(response);
    await wrapper.send(response);
    await ended.promise;
    assert.equal(observed.length, 1);
    assert.equal(session.getLastAssistantText(), "Continued with all answers.");
    assert.equal(wrapper.getInteractiveSnapshot().requests.length, 0);
  },
);
