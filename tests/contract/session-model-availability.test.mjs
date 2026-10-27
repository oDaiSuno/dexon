import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import {
  ENABLED_SETTINGS,
  expectToolPayload,
  expectToolRefusal,
  resultReader,
  startSessionOrchestrationHost,
  textOf,
  toolCall,
  waitUntil,
} from "../support/session-orchestration-host.mjs";

const MODELS = [
  { id: "held-model", reasoning: true },
  { id: "held-model-b", reasoning: true },
  { id: "held-model-c", reasoning: true },
  { id: "held-model-plain", reasoning: false },
];

const EXTRA_PROVIDERS = [
  { provider: "held-extra", models: [{ id: "held-model-two", reasoning: false }] },
  { provider: "held-keyless", models: [{ id: "held-model-nokey", reasoning: false }], apiKey: null },
];

const host = await startSessionOrchestrationHost({
  name: "session-model-availability",
  models: MODELS,
  extraProviders: EXTRA_PROVIDERS,
  settings: ENABLED_SETTINGS,
  modules: {
    ChannelManager: "./src/agent-host/channels/channel-manager.ts",
    AdapterRegistry: "./src/agent-host/channels/adapter-registry.ts",
  },
});
after(() => host.close());

function at(second) {
  return new Date(Date.UTC(2026, 7, 6, 9, 0, second)).toISOString();
}

function user(id, parentId, second, text) {
  return {
    id,
    parentId,
    type: "message",
    timestamp: at(second),
    message: { role: "user", content: text, timestamp: second * 1000 },
  };
}

function assistant(id, parentId, second, modelId, text, provider = "held-fixture") {
  return {
    id,
    parentId,
    type: "message",
    timestamp: at(second),
    message: {
      role: "assistant",
      provider,
      model: modelId,
      content: [{ type: "text", text }],
      stopReason: "stop",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: second * 1000,
    },
  };
}

function modelChange(id, parentId, second, modelId, provider = "held-fixture") {
  return { id, parentId, type: "model_change", provider, modelId, timestamp: at(second) };
}

async function openSession(sessionId) {
  await host.command(sessionId, { type: "get_state" });
  return waitUntil(
    async () => {
      const result = await host.state(sessionId);
      return result.running && result.state ? result.state : null;
    },
    { timeoutMs: 20_000, label: `session ${sessionId} to be open` },
  );
}

function requestsMentioning(text) {
  return host.model.requests().filter((request) => request.messages.some((message) => textOf(message).includes(text)));
}

function assistantMessages(detail) {
  return detail.context.messages.filter((message) => message.role === "assistant");
}

async function waitForReply(sessionId, expected) {
  return waitUntil(
    async () => {
      const replies = assistantMessages(await host.detail(sessionId));
      return replies.at(-1) && textOf(replies.at(-1)) === expected ? replies.at(-1) : null;
    },
    { timeoutMs: 30_000, label: `session ${sessionId} to reply "${expected}"` },
  );
}

function expectUnavailableModel(rejection, modelId) {
  assert.equal(rejection.code, "MODEL_UNAVAILABLE", `the refusal carries the MODEL_UNAVAILABLE code`);
  assert.match(rejection.message, new RegExp(modelId), "the refusal names the model that cannot be used");
  assert.match(rejection.message, /unavailable/i, "the refusal says the model is unavailable");
}

async function pickerModels(cwd) {
  return (await host.client.call("models.list", { cwd })).models.map((model) => model.id);
}

async function waitForPickerWithout(cwd, modelId) {
  await waitUntil(async () => !(await pickerModels(cwd)).includes(modelId), {
    timeoutMs: 20_000,
    label: `the model picker to stop showing ${modelId}`,
  });
}

async function enabledModels(cwd, refs) {
  return host.client.call("models.preferences.set", { cwd, enabledModels: refs });
}

test(
  "a prompt in a session whose chosen model is not in models.json is refused with MODEL_UNAVAILABLE and answered once the model is switched",
  { timeout: 120_000 },
  async () => {
    const sessionId = "availability-model-gone";
    const cwd = host.workspace("availability-model-gone");
    const firstQuestion = "Which model did this conversation run on before the model disappeared?";
    const newQuestion = "Can you still answer me on the model I chose?";
    await host.writeSession(sessionId, cwd, [
      modelChange("m1", null, 1, "held-model-gone"),
      user("q1", "m1", 2, firstQuestion),
      assistant("a1", "q1", 3, "held-model-gone", "The reply written while that model was still installed."),
    ]);

    const state = await openSession(sessionId);
    assert.deepEqual(
      state.model,
      { id: "held-model-gone", provider: "held-fixture" },
      "the session still reports the model the reader chose, not the default model",
    );

    const historyBefore = (await host.detail(sessionId)).context.messages.length;
    const requestsBefore = requestsMentioning(newQuestion).length;
    const rejection = await host.command(sessionId, { type: "prompt", message: newQuestion }).then(
      () => null,
      (error) => error,
    );
    assert.ok(rejection, "the prompt is refused instead of running on another model");
    expectUnavailableModel(rejection, "held-model-gone");
    assert.deepEqual(
      rejection.detail,
      { provider: "held-fixture", modelId: "held-model-gone" },
      "the refusal reports which model the reader has to replace",
    );
    assert.equal(
      requestsMentioning(newQuestion).length,
      requestsBefore,
      "nothing about the refused prompt reached the model server",
    );
    const historyAfter = await host.detail(sessionId);
    assert.equal(historyAfter.context.messages.length, historyBefore, "the refused prompt added no message");
    assert.equal(
      historyAfter.context.messages.some((message) => message.role === "user" && textOf(message) === newQuestion),
      false,
      "the refused prompt is not waiting in the conversation",
    );

    host.model.script(firstQuestion, [{ text: "Answered on the model I switched to" }]);
    await host.command(sessionId, { type: "set_model", provider: "held-fixture", modelId: "held-model-b" });
    await host.prompt(sessionId, newQuestion);
    const reply = await waitForReply(sessionId, "Answered on the model I switched to");
    assert.equal(reply.model, "held-model-b", "the same prompt is answered once the model is usable again");
  },
);

test(
  "a prompt in a session that stayed open is refused as soon as its provider channel is disabled",
  { timeout: 120_000 },
  async (t) => {
    const cwd = host.workspace("availability-channel-off");
    const firstQuestion = "Please answer once before the channel is switched off.";
    const secondQuestion = "Do you still answer after the channel was switched off?";
    const sessionId = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    host.model.script(firstQuestion, [{ text: "Answered before the channel was switched off" }]);
    await host.prompt(sessionId, firstQuestion);
    await waitForReply(sessionId, "Answered before the channel was switched off");

    t.after(() => host.client.call("modelsConfig.channels.setEnabled", { provider: "held-fixture", enabled: true }));
    await host.client.call("modelsConfig.channels.setEnabled", { provider: "held-fixture", enabled: false });
    await waitForPickerWithout(cwd, "held-model");

    const requestsBefore = requestsMentioning(secondQuestion).length;
    const rejection = await host.command(sessionId, { type: "prompt", message: secondQuestion }).then(
      () => null,
      (error) => error,
    );
    assert.ok(rejection, "the next prompt in the still open session is refused");
    expectUnavailableModel(rejection, "held-model");
    assert.deepEqual(rejection.detail, { provider: "held-fixture", modelId: "held-model" });
    assert.equal(
      requestsMentioning(secondQuestion).length,
      requestsBefore,
      "nothing about the refused prompt reached the model server",
    );
  },
);

test(
  "a prompt in a session whose model was unchecked in the model list is refused",
  { timeout: 120_000 },
  async (t) => {
    const cwd = host.workspace("availability-unchecked");
    const question = "Do you answer while my model is unchecked in the list?";
    const sessionId = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model-c" });
    await openSession(sessionId);
    t.after(() => enabledModels(cwd, null));
    await enabledModels(cwd, ["held-fixture/held-model", "held-fixture/held-model-b"]);
    await waitForPickerWithout(cwd, "held-model-c");

    const requestsBefore = requestsMentioning(question).length;
    const rejection = await host.command(sessionId, { type: "prompt", message: question }).then(
      () => null,
      (error) => error,
    );
    assert.ok(rejection, "the prompt is refused while the chosen model is unchecked");
    expectUnavailableModel(rejection, "held-model-c");
    assert.deepEqual(rejection.detail, { provider: "held-fixture", modelId: "held-model-c" });
    assert.equal(
      requestsMentioning(question).length,
      requestsBefore,
      "nothing about the refused prompt reached the model server",
    );
  },
);

test(
  "asking for a model that is not in models.json starts no session and says which model is unavailable",
  { timeout: 120_000 },
  async () => {
    const cwd = host.workspace("availability-new-missing-model");
    const parent = await host.createUserSession({ cwd });
    const prompt = "Start a worker on the model that was uninstalled.";
    host.model.script(prompt, [
      toolCall("session_new", {
        message: "Worker on a model that is not installed",
        model: { provider: "held-fixture", modelId: "held-model-gone" },
      }),
      { text: "Could not start the worker" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, prompt);
    const refusal = expectToolRefusal(
      (await results.next())[0],
      "a worker on a model that is not installed must be refused",
      /held-model-gone/,
    );
    assert.match(refusal, /unavailable/i, "the refusal says the model is unavailable");
    assert.deepEqual(
      (await host.sessions(cwd)).map((session) => session.id),
      [parent],
      "the refused call started no session",
    );
  },
);

test(
  "a prompt in a session whose model has no credentials is refused instead of running on another model",
  { timeout: 120_000 },
  async () => {
    const sessionId = "availability-model-keyless";
    const cwd = host.workspace("availability-model-keyless");
    const firstQuestion = "Which model did this conversation run on before its key was removed?";
    const newQuestion = "Do you still answer now that the key is gone?";
    await host.writeSession(sessionId, cwd, [
      modelChange("m1", null, 1, "held-model-nokey", "held-keyless"),
      user("q1", "m1", 2, firstQuestion),
      assistant("a1", "q1", 3, "held-model-nokey", "The reply written while the key was still there.", "held-keyless"),
    ]);

    const state = await openSession(sessionId);
    assert.deepEqual(
      state.model,
      { id: "held-model-nokey", provider: "held-keyless" },
      "the session still reports the model the reader chose, not the default model",
    );

    const requestsBefore = requestsMentioning(newQuestion).length;
    const rejection = await host.command(sessionId, { type: "prompt", message: newQuestion }).then(
      () => null,
      (error) => error,
    );
    assert.ok(rejection, "the prompt is refused instead of running on another model");
    expectUnavailableModel(rejection, "held-model-nokey");
    assert.deepEqual(rejection.detail, { provider: "held-keyless", modelId: "held-model-nokey" });
    assert.equal(
      requestsMentioning(newQuestion).length,
      requestsBefore,
      "nothing about the refused prompt reached the model server",
    );
  },
);

test(
  "asking for a model whose provider channel is disabled starts no session and says which model is unavailable",
  { timeout: 120_000 },
  async (t) => {
    const cwd = host.workspace("availability-new-channel-off");
    const parent = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    const prompt = "Start a worker on the second provider.";
    t.after(() => host.client.call("modelsConfig.channels.setEnabled", { provider: "held-extra", enabled: true }));
    await host.client.call("modelsConfig.channels.setEnabled", { provider: "held-extra", enabled: false });
    host.model.script(prompt, [
      toolCall("session_new", {
        message: "Worker on the channel that was switched off",
        model: { provider: "held-extra", modelId: "held-model-two" },
      }),
      { text: "Could not start the worker" },
    ]);
    const results = resultReader(host);

    await host.prompt(parent, prompt);
    const refusal = expectToolRefusal(
      (await results.next())[0],
      "a worker on a disabled provider channel must be refused",
      /held-model-two/,
    );
    assert.match(refusal, /unavailable/i, "the refusal says the model is unavailable");
    assert.deepEqual(
      (await host.sessions(cwd)).map((session) => session.id),
      [parent],
      "the refused call started no session",
    );
  },
);

test(
  "handing a task to a worker whose model became unavailable reports the failure instead of running it",
  { timeout: 120_000 },
  async (t) => {
    const cwd = host.workspace("availability-orchestrated");
    const parent = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model" });
    const firstTask = "Worker takes the first task.";
    const secondTask = "Worker takes the task after my model was unchecked.";
    let childId;
    host.model.script("Start a worker on the model I picked for it", [
      toolCall("session_new", {
        message: firstTask,
        model: { provider: "held-fixture", modelId: "held-model-c" },
        wait: false,
      }),
      { text: "Worker started" },
      { toolCall: { name: "session_prompt", input: () => ({ sessionId: childId, message: secondTask, wait: true }) } },
      { text: "The worker could not answer" },
    ]);
    host.model.script(firstTask, [{ text: "The worker answered the first task" }]);
    const results = resultReader(host);

    await host.prompt(parent, "Start a worker on the model I picked for it");
    childId = expectToolPayload((await results.next())[0], "the worker must be created").sessionId;
    await waitForReply(childId, "The worker answered the first task");

    t.after(() => enabledModels(cwd, null));
    await enabledModels(cwd, ["held-fixture/held-model", "held-fixture/held-model-b"]);
    await waitForPickerWithout(cwd, "held-model-c");

    const events = host.events(parent);
    const requestsBefore = requestsMentioning(secondTask).length;
    await host.prompt(parent, "Ask the worker to take the next task");
    const payload = expectToolPayload((await results.next())[0], "the prompt returns a failure report");
    const ended = await events.next(
      (event) => event.type === "tool_execution_end" && event.toolName === "session_prompt",
    );
    events.off();

    assert.equal(payload.status, "error", "the tool reports the turn could not run");
    assert.match(String(payload.error), /held-model-c/, "the failure names the model that cannot be used");
    assert.match(String(payload.error), /unavailable/i, "the failure says the model is unavailable");
    assert.deepEqual(
      ended.result.details.unavailableModel,
      { provider: "held-fixture", modelId: "held-model-c" },
      "the card is told which model the reader has to replace",
    );
    const statuses = (await host.client.call("sessions.list")).sessionStatuses ?? {};
    assert.equal(statuses[childId], "error", "the worker is reported as failed in the sidebar");
    assert.equal(
      requestsMentioning(secondTask).length,
      requestsBefore,
      "nothing about the refused task reached the model server",
    );
  },
);

test(
  "an inbound channel message to a session whose model is unavailable is answered with the model that has to be replaced",
  { timeout: 120_000 },
  async () => {
    const sessionId = "availability-channel-turn";
    const cwd = host.workspace("availability-channel-turn");
    const earlierQuestion = "Which model did we use in this chat before?";
    const inboundText = "Are you still there on my model?";
    await host.writeSession(sessionId, cwd, [
      modelChange("m1", null, 1, "held-model-gone"),
      user("q1", "m1", 2, earlierQuestion),
      assistant("a1", "q1", 3, "held-model-gone", "The reply written while that model was still installed."),
    ]);

    const sent = [];
    let inbound;
    const registry = new host.module.AdapterRegistry();
    registry.register({
      id: "telegram",
      async start(context) {
        inbound = context.onInbound;
        context.onStatus({ state: "running", connected: true });
        await new Promise((resolve) => context.signal.addEventListener("abort", resolve, { once: true }));
      },
      async send(context) {
        sent.push(context);
        return {
          id: `receipt-${sent.length}`,
          channel: "telegram",
          accountId: context.account.id,
          peerId: context.peerId,
          messageId: `message-${sent.length}`,
          deliveredAt: new Date().toISOString(),
        };
      },
    });
    const manager = new host.module.ChannelManager(
      { handle() {}, attachPort() {}, detachPort() {}, emit() {} },
      () => {},
      {
        dataDirectory: path.join(host.base, "channel-data"),
        registry,
        secretAccess: {
          get: async () => ({ token: "token", providerAccountId: "42", baseUrl: "https://telegram.example" }),
          set: async () => {},
          delete: async () => {},
        },
      },
    );
    const now = new Date().toISOString();
    await manager.upsertAccount({
      id: "availability-telegram",
      channel: "telegram",
      name: "@availability_bot",
      enabled: true,
      providerAccountId: "42",
      dmPolicy: "open",
      allowFrom: [],
      groupPolicy: "disabled",
      groupIds: [],
      groupAllowFrom: [],
      requireMention: true,
      toolNames: [],
      defaultCwd: cwd,
      createdAt: now,
      updatedAt: now,
    });
    await manager.upsertBinding({
      id: "availability-binding",
      channel: "telegram",
      accountId: "availability-telegram",
      peerKind: "dm",
      peerId: "user-one",
      cwd,
      sessionId,
      toolNames: [],
      createdAt: now,
      lastUsedAt: now,
    });

    host.model.script(earlierQuestion, [{ text: "A reply written by a model the reader did not choose" }]);
    const requestsBefore = requestsMentioning(inboundText).length;
    try {
      await inbound({
        id: "availability-envelope",
        channel: "telegram",
        accountId: "availability-telegram",
        peer: { kind: "dm", id: "user-one" },
        sender: { id: "user-one" },
        text: inboundText,
        mentionsBot: false,
        attachments: [],
        timestamp: Date.now(),
      });
    } finally {
      await manager.shutdown();
    }

    assert.equal(
      sent.at(-1)?.text,
      "这个会话用的模型 held-model-gone 不可用，请回到 Dexon 换一个模型",
      "the chat answers with the model the reader has to replace",
    );
    assert.equal(
      requestsMentioning(inboundText).length,
      requestsBefore,
      "nothing about the refused message reached the model server",
    );
  },
);

async function removeModelFromModelsJson(provider, modelId) {
  const snapshot = await host.client.call("modelsConfig.get");
  const providers = snapshot.config.providers ?? {};
  const configured = providers[provider];
  const config = {
    ...snapshot.config,
    providers: {
      ...providers,
      [provider]: { ...configured, models: configured.models.filter((model) => model.id !== modelId) },
    },
  };
  await host.client.call("modelsConfig.set", { config, expectedVersion: snapshot.version });
  return snapshot;
}

async function restoreModelsJson(snapshot) {
  const current = await host.client.call("modelsConfig.get");
  await host.client.call("modelsConfig.set", { config: snapshot.config, expectedVersion: current.version });
}

test(
  "a session that stayed open is refused as soon as its model is removed from models.json",
  { timeout: 120_000 },
  async (t) => {
    const cwd = host.workspace("availability-model-removed");
    const firstQuestion = "Please answer once before my model is removed.";
    const secondQuestion = "Do you still answer after my model was removed from the list?";
    const sessionId = await host.createUserSession({ cwd, provider: "held-fixture", modelId: "held-model-c" });
    host.model.script(firstQuestion, [{ text: "Answered before the model was removed" }]);
    await host.prompt(sessionId, firstQuestion);
    await waitForReply(sessionId, "Answered before the model was removed");

    const snapshot = await host.client.call("modelsConfig.get");
    t.after(() => restoreModelsJson(snapshot));
    await removeModelFromModelsJson("held-fixture", "held-model-c");
    await waitForPickerWithout(cwd, "held-model-c");

    const requestsBefore = requestsMentioning(secondQuestion).length;
    const rejection = await host.command(sessionId, { type: "prompt", message: secondQuestion }).then(
      () => null,
      (error) => error,
    );
    assert.ok(rejection, "the next prompt in the still open session is refused");
    expectUnavailableModel(rejection, "held-model-c");
    assert.deepEqual(rejection.detail, { provider: "held-fixture", modelId: "held-model-c" });
    assert.equal(
      requestsMentioning(secondQuestion).length,
      requestsBefore,
      "nothing about the refused prompt reached the model server",
    );
  },
);
