import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { captureHandlers, root, isolatedAgentDirectory } from "./handlers-test-support.mjs";

test("sessions.get reconstructs context usage when no live agent session exists", async (t) => {
  const fixtureDirectory = path.join(process.env.PI_CODING_AGENT_SESSION_DIR, "context-usage-fixture");
  mkdirSync(fixtureDirectory, { recursive: true });
  t.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

  const timestamp = "2026-08-17T00:00:00.000Z";
  const contextUsage = {
    input: 300,
    output: 50,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 350,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const writeFixture = (sessionId, extraEntries, model = "context-model", leadingEntries = []) => {
    const firstParentId = leadingEntries.at(-1)?.id ?? null;
    const sessionPath = path.join(fixtureDirectory, `2026-08-17T00-00-00-000Z_${sessionId}.jsonl`);
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp, cwd: root }),
        ...leadingEntries.map((entry) => JSON.stringify(entry)),
        JSON.stringify({
          type: "message",
          id: "caaaaaaa",
          parentId: firstParentId,
          timestamp,
          message: { role: "user", content: "hello", timestamp: 1 },
        }),
        JSON.stringify({
          type: "message",
          id: "cbbbbbbb",
          parentId: "caaaaaaa",
          timestamp,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hi" }],
            provider: "context-provider",
            model,
            usage: contextUsage,
            stopReason: "stop",
            timestamp: 2,
          },
        }),
        ...extraEntries,
      ].join("\n") + "\n",
      "utf8",
    );
  };

  writeFixture("context-usage-reconstructed", []);
  writeFixture("context-usage-aliased-model", [], "upstream-proxy-signature:1017", [
    {
      type: "model_change",
      id: "c0000000",
      parentId: null,
      timestamp,
      provider: "context-provider",
      modelId: "context-model",
    },
  ]);
  writeFixture("context-usage-signed-fallback", [], "context-model", [
    {
      type: "model_change",
      id: "c0000000",
      parentId: null,
      timestamp,
      provider: "context-provider",
      modelId: "removed-catalog-model",
    },
  ]);
  writeFixture("context-usage-branched", [
    JSON.stringify({
      type: "message",
      id: "cddddddd",
      parentId: "caaaaaaa",
      timestamp,
      message: { role: "user", content: "other branch", timestamp: 3 },
    }),
    JSON.stringify({
      type: "message",
      id: "ceeeeeee",
      parentId: "cddddddd",
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "other branch reply" }],
        provider: "context-provider",
        model: "context-model",
        usage: {
          input: 700,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 800,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 4,
      },
    }),
  ]);
  const leafChoicesDir = path.join(process.env.PI_CODING_AGENT_DIR, "desktop");
  mkdirSync(leafChoicesDir, { recursive: true });
  writeFileSync(
    path.join(leafChoicesDir, "session-leaf-choices.json"),
    JSON.stringify({
      version: 1,
      sessions: {
        "context-usage-branched": {
          leafId: "cbbbbbbb",
          lastEntryId: "ceeeeeee",
        },
      },
    }),
    "utf8",
  );
  writeFixture("context-usage-compacted", [
    JSON.stringify({
      type: "compaction",
      id: "cccccccc",
      parentId: "cbbbbbbb",
      timestamp,
      summary: "summary",
      firstKeptEntryId: "caaaaaaa",
      tokensBefore: 350,
    }),
  ]);
  writeFixture("context-usage-unknown-model", [], "ghost-model");

  const { handlers } = await captureHandlers();
  await handlers["sessions.list"]();
  const modelsPath = path.join(process.env.PI_CODING_AGENT_DIR, "models.json");
  t.after(() => rmSync(modelsPath, { force: true }));
  const editor = await handlers["modelsConfig.get"]();
  await handlers["modelsConfig.set"]({
    config: {
      providers: {
        ...editor.config.providers,
        "context-provider": {
          baseUrl: "https://context.invalid/v1",
          api: "openai-completions",
          apiKey: "test-key",
          models: [{ id: "context-model", contextWindow: 1000 }],
        },
      },
    },
    expectedVersion: editor.version,
  });

  const restored = await handlers["sessions.get"]({ id: "context-usage-reconstructed", includeState: true });
  assert.deepEqual(restored.agentState, { running: false });
  assert.ok(restored.contextUsage, "usage must be reconstructed without a live session");
  assert.equal(restored.contextUsage.tokens, 350);
  assert.equal(restored.contextUsage.contextWindow, 1000);
  assert.ok(Math.abs(restored.contextUsage.percent - 35) < 1e-9);

  const aliased = await handlers["sessions.get"]({ id: "context-usage-aliased-model", includeState: true });
  assert.deepEqual(aliased.context.model, { provider: "context-provider", modelId: "context-model" });
  assert.ok(
    aliased.contextUsage,
    "usage must resolve from the user-selected model when assistant signature is an upstream alias",
  );
  assert.equal(aliased.contextUsage.tokens, 350);
  assert.equal(aliased.contextUsage.contextWindow, 1000);
  assert.ok(Math.abs(aliased.contextUsage.percent - 35) < 1e-9);

  const signedFallback = await handlers["sessions.get"]({ id: "context-usage-signed-fallback", includeState: true });
  assert.ok(
    signedFallback.contextUsage,
    "usage must fall back to the assistant-signed model when the chosen model was removed from catalog",
  );
  assert.equal(signedFallback.contextUsage.tokens, 350);
  assert.equal(signedFallback.contextUsage.contextWindow, 1000);

  const branched = await handlers["sessions.get"]({ id: "context-usage-branched", includeState: true });
  assert.equal(branched.leafId, "cbbbbbbb");
  assert.deepEqual(branched.context.entryIds, ["caaaaaaa", "cbbbbbbb"]);
  assert.ok(branched.contextUsage, "usage must be reconstructed for the resolved active branch");
  assert.equal(branched.contextUsage.tokens, 350);
  assert.ok(Math.abs(branched.contextUsage.percent - 35) < 1e-9);

  const compacted = await handlers["sessions.get"]({ id: "context-usage-compacted", includeState: true });
  assert.deepEqual(compacted.contextUsage, { tokens: null, percent: null, contextWindow: 1000 });

  const unknownModel = await handlers["sessions.get"]({ id: "context-usage-unknown-model", includeState: true });
  assert.equal(unknownModel.contextUsage, null);

  const withoutState = await handlers["sessions.get"]({ id: "context-usage-reconstructed" });
  assert.equal("contextUsage" in withoutState, false);
});

test("session, model configuration, and auth handlers isolate state and preserve error codes", async () => {
  const { handlers } = await captureHandlers();

  const sessions = await handlers["sessions.list"]();
  assert.deepEqual(sessions.sessions, []);
  assert.deepEqual(sessions.runningSessionIds, []);

  await assert.rejects(handlers["sessions.get"]({ id: "missing" }), (error) => error.code === "NOT_FOUND");
  await assert.rejects(handlers["agent.command"]({ sessionId: "missing", command: { type: "abort" } }), (error) =>
    ["NOT_FOUND", "BAD_REQUEST"].includes(error.code),
  );

  const initialModels = await handlers["modelsConfig.get"]();
  assert.deepEqual(initialModels.config, { providers: {} });
  assert.equal(initialModels.version, "missing");
  await assert.rejects(handlers["modelsConfig.set"]({}), (error) => error.code === "BAD_REQUEST");
  await assert.rejects(
    handlers["modelsConfig.set"]({ config: { providers: {} } }),
    (error) => error.code === "BAD_REQUEST",
  );
  const firstSave = await handlers["modelsConfig.set"]({
    config: { providers: {} },
    expectedVersion: initialModels.version,
  });
  assert.equal(firstSave.ok, true);
  assert.match(firstSave.version, /^sha256:/);

  const v084Config = {
    providers: {
      custom: {
        headers: { Authorization: "Bearer test", "X-Remove-Me": null },
        models: [
          {
            id: "model-one",
            samplingParams: { temperature: 0.2, thinking_token_budget: 1024 },
            futureField: { preserved: true },
          },
        ],
      },
    },
    futureTopLevel: "preserved",
  };
  const editorOne = await handlers["modelsConfig.get"]();
  const editorTwo = await handlers["modelsConfig.get"]();
  const winningSave = await handlers["modelsConfig.set"]({
    config: v084Config,
    expectedVersion: editorOne.version,
  });
  assert.equal(winningSave.ok, true);
  assert.notEqual(winningSave.version, editorOne.version);
  await assert.rejects(
    handlers["modelsConfig.set"]({
      config: { providers: { stale: { api: "openai-completions" } } },
      expectedVersion: editorTwo.version,
    }),
    (error) =>
      error.code === "CONFLICT" &&
      error.detail.expectedVersion === editorTwo.version &&
      error.detail.currentVersion === winningSave.version,
  );
  const winningSnapshot = await handlers["modelsConfig.get"]();
  assert.deepEqual(winningSnapshot.config, v084Config);
  assert.equal(winningSnapshot.version, winningSave.version);

  const models = await handlers["models.list"]({ cwd: root });
  assert.equal(models.catalog.source, "offline");
  const refreshedModels = await handlers["models.refresh"]({ cwd: root, requestId: "offline-test" });
  assert.equal(refreshedModels.catalog.source, "offline");
  assert.deepEqual(await handlers["models.refreshCancel"]({ requestId: "offline-test" }), {
    ok: true,
    cancelled: false,
  });

  const invalidModelTest = await handlers["modelsConfig.test"]({});
  assert.deepEqual(invalidModelTest, { ok: false, error: "providerName is required" });

  const oauthProviders = await handlers["auth.providers"]();
  assert.equal(Array.isArray(oauthProviders.providers), true);
  const allProviders = await handlers["auth.allProviders"]();
  assert.equal(Array.isArray(allProviders.providers), true);

  assert.deepEqual(await handlers["auth.setApiKey"]({ provider: "openai", key: "secret" }), {
    ok: true,
    synchronized: true,
  });
  const preferences = await handlers["models.preferences.get"]({ cwd: root });
  assert.equal(Array.isArray(preferences.models), true);
  assert.equal(preferences.enabledModels, null);
  await assert.rejects(
    handlers["models.preferences.set"]({ cwd: root, enabledModels: [] }),
    (error) => error.code === "BAD_REQUEST",
  );
  const selectedModel = preferences.models.find((model) => model.provider === "openai");
  assert.ok(selectedModel, "setting an OpenAI credential should expose OpenAI models");
  const selectedReference = `${selectedModel.provider}/${selectedModel.id}`;
  const updatedPreferences = await handlers["models.preferences.set"]({
    cwd: root,
    enabledModels: [`${selectedReference}:high`, selectedReference],
  });
  assert.deepEqual(updatedPreferences.enabledModels, [selectedReference]);
  const filteredModels = await handlers["models.list"]({ cwd: root });
  assert.deepEqual(
    filteredModels.models.map((model) => `${model.provider}/${model.id}`),
    [selectedReference],
  );
  const resetPreferences = await handlers["models.preferences.set"]({ cwd: root, enabledModels: null });
  assert.equal(resetPreferences.enabledModels, null);
  await assert.rejects(
    handlers["auth.setApiKey"]({ provider: "amazon-bedrock", key: "not-a-bearer-token" }),
    (error) => error.code === "BAD_REQUEST" && /interactive, multi-field/.test(error.message),
  );
  assert.deepEqual(await handlers["auth.deleteApiKey"]({ provider: "openai" }), {
    ok: true,
    synchronized: true,
  });
  assert.deepEqual(await handlers["auth.logout"]({ provider: "openai" }), { ok: true, synchronized: true });
  assert.deepEqual(await handlers["auth.loginCancel"]({ provider: "handler-test" }), { ok: true });
  await assert.rejects(
    handlers["auth.loginSubmit"]({ provider: "one", token: "two-token", code: "code" }),
    (error) => error.code === "NOT_FOUND",
  );

  const modelsPath = path.join(isolatedAgentDirectory, "models.json");
  writeFileSync(modelsPath, "{broken json", "utf8");
  assert.throws(
    () => handlers["modelsConfig.get"](),
    (error) => error.code === "PARSE_ERROR",
  );
  assert.equal(readFileSync(modelsPath, "utf8"), "{broken json");
});
