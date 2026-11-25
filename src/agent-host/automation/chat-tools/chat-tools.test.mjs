import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { importTestBundle } from "#test-bundle";

const loaded = await importTestBundle("automation-chat-tools", {
  packages: "external",
  stdin: {
    contents: `export * from "./src/agent-host/automation/index";
      export { deriveRequiredGrant } from "./src/agent-host/automation/spec/grant";
      export { assertTaskSpec } from "./src/agent-host/automation/spec/validate";
      export { normalizeTaskSpec } from "./src/agent-host/automation/spec/normalize";
      export { setBrowserSessionSource } from "./src/agent-host/browser-tools";
      export { activeToolNamesFor, customToolsFor } from "./src/agent-host/agent-session/execution-profile";
      export { AUTOMATION_CHAT_TOOL_NAMES, readAutomationChatCard } from "./src/shared/automation/chat-tools";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
});

function createChannelsSnapshot() {
  return {
    accounts: [
      {
        id: "feishu-main",
        channel: "feishu",
        name: "Team Feishu",
        enabled: true,
        configured: true,
        dmPolicy: "allowlist",
        allowFrom: ["ou_user_1"],
        groupPolicy: "allowlist",
        groupIds: ["oc_group_1"],
        groupAllowFrom: [],
        requireMention: true,
        toolNames: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "disabled-tg",
        channel: "telegram",
        name: "Disabled Bot",
        enabled: false,
        configured: true,
        dmPolicy: "pairing",
        allowFrom: [],
        groupPolicy: "disabled",
        groupIds: [],
        groupAllowFrom: [],
        requireMention: true,
        toolNames: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    statuses: [{ channel: "feishu", accountId: "feishu-main", state: "running", connected: true }],
    pairings: [],
    bindings: [
      {
        id: "b1",
        channel: "feishu",
        accountId: "feishu-main",
        peerKind: "dm",
        peerId: "ou_bound_user",
        cwd: "/work",
        toolNames: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    activities: [],
  };
}

function sampleSpec(cwd, id = "daily-check", extra = {}) {
  return {
    schema: "dexon.automation/v1",
    id,
    name: "Daily Check",
    cwd,
    triggers: [{ id: "manual", kind: "manual" }],
    steps: [
      {
        id: "fetch",
        kind: "action",
        call: {
          action: "http.request",
          with: {
            method: "GET",
            url: { origin: "https://api.example.com", path: "/status" },
            secretHeaders: { Authorization: "api.token" },
            effect: "read",
          },
        },
      },
      {
        id: "approve",
        kind: "wait",
        wait: {
          kind: "approval",
          title: "Approve next action?",
          prompt: "Confirm sending notification",
        },
      },
    ],
    ...extra,
  };
}

async function setupFixture(t) {
  const base = mkdtempSync(path.join(tmpdir(), "dexon-automation-chat-tools-"));
  const cwd = path.join(base, "workspace");
  const dataDir = path.join(base, "automation");
  mkdirSync(cwd);
  mkdirSync(dataDir);
  const runtime = loaded.createAutomationRuntime({
    dataDirectory: dataDir,
    channels: { deliver: async () => ({ delivered: true }) },
    agentSessions: { launch: async () => ({ status: "ok", output: {} }) },
    secrets: { read: async () => "secret-token" },
    fetch: async () =>
      new globalThis.Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  await runtime.start();
  t.after(async () => {
    await runtime.stop();
    rmSync(base, { recursive: true, force: true });
  });
  const host = {
    runtime,
    channels: { snapshot: async () => createChannelsSnapshot() },
  };
  const tools = new Map(loaded.createAutomationChatToolDefinitions(cwd, host).map((tool) => [tool.name, tool]));
  const callTool = async (name, input, sessionManager = { getSessionId: () => "desktop-session" }) => {
    const tool = tools.get(name);
    assert.ok(tool, `missing tool ${name}`);
    const result = await tool.execute("call-1", input, undefined, undefined, { sessionManager });
    return {
      json: JSON.parse(result.content[0].text),
      details: result.details,
    };
  };
  return { cwd, runtime, host, tools, callTool };
}

test("every guide recipe passes real backend validation and normalization", () => {
  const recipes = Object.values(loaded.AUTOMATION_GUIDE_RECIPES);
  assert.ok(recipes.length >= 2);
  for (const recipe of recipes) {
    loaded.assertTaskSpec(recipe);
    const plan = loaded.normalizeTaskSpec(recipe);
    assert.equal(plan.id, recipe.id);
  }
  const approvalPlan = loaded.normalizeTaskSpec(loaded.AUTOMATION_GUIDE_RECIPES.watchEndpointWithApproval);
  const approvalGrant = loaded.deriveRequiredGrant(
    approvalPlan,
    loaded.AUTOMATION_GUIDE_RECIPES.watchEndpointWithApproval,
  );
  assert.deepEqual(approvalGrant.unattendedWrites, []);
  const built = loaded.buildAutomationGuide(["core", "triggers", "steps", "expressions", "recipes"]);
  assert.equal(built.schema, "dexon.automation/v1");
  assert.match(built.guide, /dexon\.automation\/v1/);
});

test("chat tools inspect capabilities, validate, save draft without enabling, stop, and propose user actions", async (t) => {
  const { cwd, runtime, callTool } = await setupFixture(t);

  const caps = await callTool("automation_inspect", { view: "capabilities" });
  assert.equal(caps.json.cwd, cwd);
  assert.equal(caps.json.channels.length, 1);
  assert.equal(caps.json.channels[0].accountId, "feishu-main");
  assert.ok(caps.json.channels[0].targets.some((target) => target.peerId === "ou_bound_user"));
  assert.equal("secrets" in caps.json, false);

  const invalid = await callTool("automation_validate", {
    mode: "create",
    spec: {
      ...sampleSpec(cwd),
      id: "bad-secret",
      steps: [
        {
          id: "s1",
          kind: "action",
          call: {
            action: "http.request",
            with: { url: { origin: "https://api.example.com" }, secretHeaders: { Auth: "INVALID_UPPER" } },
          },
        },
      ],
    },
  });
  assert.equal(invalid.json.valid, false);
  assert.ok(invalid.json.issues.length > 0);

  const valid = await callTool("automation_validate", { mode: "create", spec: sampleSpec(cwd) });
  assert.equal(valid.json.valid, true);
  assert.deepEqual(valid.json.requiredGrant.secrets, ["api.token"]);
  assert.equal(valid.json.impact.disarmsEnabledRevision, null);

  const saved = await callTool("automation_save_draft", {
    mode: "create",
    spec: sampleSpec(cwd),
    summary: "Check status endpoint and request approval",
  });
  assert.equal(saved.json.saved, true);
  assert.equal(saved.json.enabled, false);
  assert.equal(saved.json.revision, 1);
  const card = loaded.readAutomationChatCard(saved.details);
  assert.ok(card);
  assert.equal(card.kind, "draft_saved");
  assert.equal(card.taskId, "daily-check");
  assert.equal(card.planHash, saved.json.planHash);

  const duplicate = await callTool("automation_validate", { mode: "create", spec: sampleSpec(cwd) });
  assert.equal(duplicate.json.valid, false);
  assert.equal(duplicate.json.issues[0].code, "already_exists");

  await assert.rejects(
    () =>
      callTool("automation_request_user_action", {
        action: "start_run",
        taskId: "daily-check",
        triggerId: "manual",
        reason: "Run while disabled",
      }),
    /currently disabled/,
  );

  runtime.enableTask({
    taskId: "daily-check",
    revision: 1,
    planHash: saved.json.planHash,
    unattendedWriteApproved: true,
    trustedLocalExecApproved: true,
  });

  const runProposal = await callTool("automation_request_user_action", {
    action: "start_run",
    taskId: "daily-check",
    triggerId: "manual",
    reason: "Manual test run",
  });
  const startRunCard = loaded.readAutomationChatCard(runProposal.details);
  assert.equal(startRunCard?.kind, "start_run");
  assert.equal(startRunCard?.revision, 1);
  assert.equal(runtime.listRuns({ taskId: "daily-check" }).length, 0);

  const fired = runtime.startRun({ taskId: "daily-check", triggerId: "manual", input: null });
  assert.ok(fired.runId);
  const deadline = Date.now() + 5000;
  while (runtime.listInbox().length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const inbox = await callTool("automation_inspect", { view: "inbox" });
  assert.equal(inbox.json.count, 1);
  const approvalItem = inbox.json.items[0];
  assert.equal(approvalItem.kind, "approval");

  const approvalCardRes = await callTool("automation_request_user_action", {
    action: "resolve_approval",
    runId: approvalItem.runId,
    stepIndex: approvalItem.stepIndex,
    expectedVersion: approvalItem.expectedVersion,
    reason: "Please approve or reject",
  });
  assert.equal(loaded.readAutomationChatCard(approvalCardRes.details)?.kind, "resolve_approval");
  assert.equal(runtime.listInbox().length, 1);

  const runSummary = await callTool("automation_inspect", { view: "run", runId: fired.runId });
  assert.equal(runSummary.json.run.id, fired.runId);
  const stepDetail = await callTool("automation_inspect", { view: "run", runId: fired.runId, stepIndex: 0 });
  assert.equal(stepDetail.json.step.stepId, "fetch");

  const cancelled = await callTool("automation_stop", {
    action: "cancel_run",
    runId: fired.runId,
    reason: "Stop test",
  });
  assert.equal(cancelled.json.action, "cancel_run");
  for (let i = 0; i < 40; i += 1) {
    if (runtime.getRun(fired.runId).phase === "cancelled" && runtime.listInbox().length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(runtime.getRun(fired.runId).phase, "cancelled");
  assert.equal(runtime.listInbox().length, 0);

  const signalProposal = await callTool("automation_request_user_action", {
    action: "emit_signal",
    taskId: "daily-check",
    signalName: "deploy_ready",
    signalKey: " key-with-space ",
    signalPayload: null,
    reason: "Emit exact signal key",
  });
  const signalCard = loaded.readAutomationChatCard(signalProposal.details);
  assert.equal(signalCard?.kind, "emit_signal");
  assert.equal(signalCard?.signalKey, " key-with-space ");

  const updateCheck = await callTool("automation_validate", {
    mode: "update",
    expectedRevision: 1,
    spec: sampleSpec(cwd, "daily-check", { name: "Daily Check v2" }),
  });
  assert.equal(updateCheck.json.valid, true);
  assert.equal(updateCheck.json.impact.disarmsEnabledRevision, 1);

  const disabled = await callTool("automation_stop", { action: "disable_task", taskId: "daily-check" });
  assert.equal(disabled.json.enabledRevision, null);

  const secretCard = await callTool("automation_request_user_action", {
    action: "configure_secret",
    secretName: "api.token",
    reason: "Configure API token",
  });
  assert.equal(loaded.readAutomationChatCard(secretCard.details)?.kind, "configure_secret");

  await assert.rejects(
    () =>
      callTool("automation_request_user_action", {
        action: "configure_secret",
        secretName: "BAD_UPPERCASE",
        reason: "Invalid name",
      }),
    /Invalid secretName/,
  );

  const deleteCard = await callTool("automation_request_user_action", {
    action: "delete_task",
    taskId: "daily-check",
    reason: "Remove obsolete task",
  });
  assert.equal(loaded.readAutomationChatCard(deleteCard.details)?.kind, "delete_task");
  assert.equal(runtime.listTasks().length, 1);
});

test("security boundaries block channel turns and isolate automation/sealed profiles", async (t) => {
  const { callTool, tools } = await setupFixture(t);
  const channelSessionManager = { getSessionId: () => "channel-sess-1" };
  loaded.setBrowserSessionSource(channelSessionManager, "channel", "feishu");

  for (const name of loaded.AUTOMATION_CHAT_TOOL_NAMES) {
    await assert.rejects(() => callTool(name, {}, channelSessionManager), /messaging-channel turns/);
  }

  const allCustom = [...tools.values()];
  const stepRef = { taskId: "t", runId: "r", stepId: "s", attemptNo: 1 };
  const resultToolFactory = () => ({ name: "automation_result" });
  const automationCustom = loaded.customToolsFor(
    { kind: "automation", step: stepRef, tools: ["read"], result: { schema: {}, sink: {} } },
    allCustom,
    resultToolFactory,
  );
  assert.deepEqual(
    automationCustom.map((tool) => tool.name),
    ["automation_result"],
  );
  const sealedCustom = loaded.customToolsFor({ kind: "sealed", step: stepRef }, allCustom, resultToolFactory);
  assert.deepEqual(sealedCustom, []);

  const available = ["read", ...loaded.AUTOMATION_CHAT_TOOL_NAMES];
  const off = loaded.activeToolNamesFor({ kind: "interactive" }, available, {
    browserToolNames: new Set(),
    orchestrationEnabled: false,
    automationEnabled: false,
  });
  assert.deepEqual(off, ["read"]);
  const on = loaded.activeToolNamesFor({ kind: "interactive" }, available, {
    browserToolNames: new Set(),
    orchestrationEnabled: false,
    automationEnabled: true,
  });
  assert.deepEqual(on, available);
});

test("validate schema allows empty lists through SDK validation and card guards reject malformed payloads", async (t) => {
  const { cwd, tools, callTool } = await setupFixture(t);
  const validateTool = tools.get("automation_validate");
  const emptySteps = validateToolArguments(validateTool, {
    type: "toolCall",
    id: "tc-validate-steps",
    name: "automation_validate",
    arguments: {
      mode: "create",
      spec: { ...sampleSpec(cwd, "empty-steps"), steps: [] },
    },
  });
  const emptyStepsOutcome = await callTool("automation_validate", emptySteps);
  assert.equal(emptyStepsOutcome.json.valid, false);
  assert.equal(emptyStepsOutcome.json.issues[0].path, "steps");

  const emptyTriggers = validateToolArguments(validateTool, {
    type: "toolCall",
    id: "tc-validate-triggers",
    name: "automation_validate",
    arguments: {
      mode: "create",
      spec: { ...sampleSpec(cwd, "empty-triggers"), triggers: [] },
    },
  });
  const emptyTriggersOutcome = await callTool("automation_validate", emptyTriggers);
  assert.equal(emptyTriggersOutcome.json.valid, false);
  assert.equal(emptyTriggersOutcome.json.issues[0].path, "triggers");

  await callTool("automation_save_draft", {
    mode: "create",
    summary: "Channel target task",
    spec: {
      ...sampleSpec(cwd, "channel-diff"),
      steps: [
        {
          id: "send",
          kind: "action",
          call: { action: "channel.send", with: { to: { accountId: "a:b", peerId: "c" }, text: "hi" } },
        },
      ],
    },
  });
  const diffCheck = await callTool("automation_validate", {
    mode: "update",
    expectedRevision: 1,
    spec: {
      ...sampleSpec(cwd, "channel-diff"),
      steps: [
        {
          id: "send",
          kind: "action",
          call: { action: "channel.send", with: { to: { accountId: "a", peerId: "b:c" }, text: "hi" } },
        },
      ],
    },
  });
  assert.equal(diffCheck.json.valid, true);
  assert.deepEqual(diffCheck.json.impact.addedChannelTargets, [{ accountId: "a", peerId: "b:c" }]);

  const validGrant = {
    cwd,
    agentTools: ["read"],
    channelTargets: [],
    allowedChannelTargets: [],
    httpOrigins: [],
    scripts: [],
    secrets: [],
    unattendedWrites: [],
    requiresTrustedLocalExecution: false,
    stepEffects: [],
    planHash: "a".repeat(64),
  };
  const baseDraft = {
    kind: "draft_saved",
    mode: "create",
    taskId: "t1",
    taskName: "Task",
    revision: 1,
    planHash: "a".repeat(64),
    summary: "Summary",
    cwd,
    disarmedPreviousRevision: null,
    triggers: [{ id: "manual", kind: "manual" }],
    stepCount: 1,
    requiredGrant: validGrant,
  };
  assert.ok(loaded.readAutomationChatCard({ automationCard: baseDraft }));
  assert.equal(
    loaded.readAutomationChatCard({
      automationCard: { ...baseDraft, requiredGrant: { ...validGrant, scripts: [null] } },
    }),
    null,
  );
  assert.equal(
    loaded.readAutomationChatCard({
      automationCard: { ...baseDraft, requiredGrant: { ...validGrant, stepEffects: undefined } },
    }),
    null,
  );
  assert.equal(loaded.readAutomationChatCard({ automationCard: { ...baseDraft, triggers: [null] } }), null);
  assert.equal(
    loaded.readAutomationChatCard({
      automationCard: { kind: "start_run", taskId: "t1", taskName: "Task", triggerId: "manual", reason: "Run" },
    }),
    null,
  );
  assert.equal(
    loaded.readAutomationChatCard({
      automationCard: {
        kind: "resolve_approval",
        taskId: "t1",
        taskName: "Task",
        runId: "r1",
        stepIndex: 0,
        expectedVersion: 1,
        title: "Approve",
        prompt: null,
        show: null,
        fields: [],
        defaults: null,
        expiresAtMs: null,
        reason: "Approve",
      },
    }),
    null,
  );
  assert.equal(
    loaded.readAutomationChatCard({
      automationCard: {
        kind: "resolve_attention",
        taskId: "t1",
        taskName: "Task",
        runId: "r1",
        stepIndex: 0,
        expectedVersion: 1,
        stepId: "s1",
        suggestedAction: null,
        reason: "Check",
      },
    }),
    null,
  );
  assert.equal(
    loaded.readAutomationChatCard({
      automationCard: {
        kind: "emit_signal",
        taskId: "t1",
        taskName: "Task",
        signalName: "sig",
        signalKey: "k",
        reason: "Emit",
      },
    }),
    null,
  );
});
