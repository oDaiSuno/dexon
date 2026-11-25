import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, button, click, text, loadRenderer, mount, restoreGlobals } from "../../../../tests/support/renderer.mjs";

const { AutomationChatCardView, AutomationToolRow, environmentRegistry } = await loadRenderer(
  "automation-chat-card-dom",
  `export { AutomationChatCardView } from "./src/renderer/components/messages/automation-chat-card.tsx";
   export { AutomationToolRow } from "./src/renderer/components/messages/automation-tool-row.tsx";
   export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";`,
);
after(restoreGlobals);

function sampleDraftCard() {
  return {
    kind: "draft_saved",
    mode: "update",
    taskId: "daily-digest",
    taskName: "Daily Digest",
    revision: 2,
    planHash: "a".repeat(64),
    summary: "Summarize repository commits every morning",
    cwd: "/work/repo",
    disarmedPreviousRevision: 1,
    triggers: [{ id: "weekday", kind: "schedule", cron: "0 9 * * 1-5", tz: "Asia/Shanghai" }],
    stepCount: 2,
    requiredGrant: {
      cwd: "/work/repo",
      agentTools: ["read"],
      channelTargets: [{ accountId: "feishu-main", peerId: "ou_user" }],
      allowedChannelTargets: [],
      httpOrigins: ["https://api.example.com"],
      scripts: [],
      secrets: ["github.token"],
      unattendedWrites: [{ stepId: "notify", kind: "channel_send" }],
      requiresTrustedLocalExecution: false,
      stepEffects: [{ stepId: "notify", effect: "unsafe" }],
      planHash: "a".repeat(64),
    },
  };
}

function stubConnection(t, { tasks = [], inbox = [], onCall } = {}) {
  const conn = environmentRegistry.getConnection("primary");
  const origCall = conn.call.bind(conn);
  const origSubscribe = conn.subscribe.bind(conn);
  conn.call = async (method, params) => {
    if (onCall) {
      const handled = await onCall(method, params);
      if (handled !== undefined) return handled;
    }
    if (method === "automation.listTasks") return { tasks };
    if (method === "automation.listInbox") return { items: inbox };
    return { ok: true };
  };
  conn.subscribe = async () => () => {};
  t.after(() => {
    conn.call = origCall;
    conn.subscribe = origSubscribe;
  });
}

test("AutomationToolRow renders localized verb and expands tool details", async (t) => {
  const view = await mount(t, AutomationToolRow, {
    block: { type: "toolCall", toolCallId: "tc-1", toolName: "automation_validate", input: { mode: "create" } },
    result: {
      role: "toolResult",
      toolCallId: "tc-1",
      toolName: "automation_validate",
      content: [{ type: "text", text: JSON.stringify({ valid: true }) }],
      details: { targetTaskName: "Daily Digest" },
    },
    stateKey: "auto-row-1",
  });
  const toggle = button(view.container, /Validate automation.*Daily Digest/);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.ok(text(view.container, '{"valid":true}'));
});

test("draft card configures secret via desktop command and enables revision through native gatekeeper", async (t) => {
  const commands = [];
  const storedSecrets = new Set();
  const prevBridge = globalThis.window.piBridge;
  globalThis.window.piBridge = {
    automationCommand: async (command) => {
      commands.push(command);
      if (command.type === "list-secret-names") return { names: [...storedSecrets] };
      if (command.type === "set-secret") {
        storedSecrets.add(command.name);
        return { ok: true };
      }
      if (command.type === "enable-task") {
        return {
          outcome: "enabled",
          task: {
            id: command.taskId,
            name: "Daily Digest",
            cwd: "/work/repo",
            currentRevision: command.revision,
            enabledRevision: command.revision,
            createdAtMs: 1,
            updatedAtMs: 2,
          },
        };
      }
      return { ok: true };
    },
  };
  t.after(() => {
    globalThis.window.piBridge = prevBridge;
  });
  stubConnection(t, {
    tasks: [
      {
        id: "daily-digest",
        name: "Daily Digest",
        cwd: "/work/repo",
        currentRevision: 2,
        enabledRevision: null,
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    ],
  });

  const view = await mount(t, AutomationChatCardView, {
    environmentId: "primary",
    card: sampleDraftCard(),
  });

  assert.ok(text(view.container, "Daily Digest"));
  assert.match(view.container.textContent, /Previous active revision v1 was paused/);
  assert.ok(text(view.container, "github.token · Missing"));

  await click(button(view.container, "Set secret"));
  const input = view.container.querySelector('input[type="password"]');
  assert.ok(input);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(globalThis.window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "ghp_secret_value");
    input.dispatchEvent(new globalThis.window.Event("input", { bubbles: true }));
  });
  await click(button(view.container, "Save to vault"));

  assert.ok(
    commands.some(
      (cmd) => cmd.type === "set-secret" && cmd.name === "github.token" && cmd.value === "ghp_secret_value",
    ),
  );
  assert.ok(text(view.container, "github.token · Configured"));

  await click(button(view.container, "Review & Enable"));
  assert.ok(
    commands.some(
      (cmd) =>
        cmd.type === "enable-task" &&
        cmd.environmentId === "primary" &&
        cmd.taskId === "daily-digest" &&
        cmd.revision === 2 &&
        cmd.planHash === "a".repeat(64),
    ),
  );
  assert.ok(text(view.container, "Enabled (v2)"));
});

test("delete_task card requires two-step confirmation and approval card resolves inbox via RPC", async (t) => {
  const rpcCalls = [];
  stubConnection(t, {
    tasks: [
      {
        id: "old-task",
        name: "Old Task",
        cwd: "/work",
        currentRevision: 1,
        enabledRevision: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ],
    inbox: [
      {
        kind: "approval",
        taskId: "deploy",
        taskName: "Deploy",
        runId: "run-9",
        stepIndex: 1,
        expectedVersion: 3,
        title: "Deploy release?",
        prompt: "Proceed to production",
        show: null,
        fields: null,
        defaults: null,
        openedAtMs: 1,
        expiresAtMs: null,
      },
    ],
    onCall: async (method, params) => {
      if (method === "automation.deleteTask") {
        rpcCalls.push({ method, params });
        return { ok: true };
      }
      if (method === "automation.resolveInbox") {
        rpcCalls.push({ method, params });
        return { ok: true, run: { id: "run-9", phase: "running" } };
      }
      return undefined;
    },
  });

  const delView = await mount(t, AutomationChatCardView, {
    environmentId: "primary",
    card: {
      kind: "delete_task",
      taskId: "old-task",
      taskName: "Old Task",
      enabledRevision: null,
      reason: "No longer needed",
    },
  });
  await click(button(delView.container, "Delete task"));
  assert.equal(rpcCalls.length, 0);
  await click(button(delView.container, "Confirm permanent delete"));
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].method, "automation.deleteTask");
  assert.ok(text(delView.container, "Task deleted"));

  const approvalView = await mount(t, AutomationChatCardView, {
    environmentId: "primary",
    card: {
      kind: "resolve_approval",
      taskId: "deploy",
      taskName: "Deploy",
      runId: "run-9",
      stepIndex: 1,
      expectedVersion: 3,
      title: "Deploy release?",
      prompt: "Proceed to production",
      show: null,
      fields: null,
      defaults: null,
      expiresAtMs: null,
      reason: "Waiting for your approval",
    },
  });
  await click(button(approvalView.container, "Approve"));
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[1].method, "automation.resolveInbox");
  assert.equal(rpcCalls[1].params.resolution.approved, true);
  assert.ok(text(approvalView.container, "Approved"));
});
