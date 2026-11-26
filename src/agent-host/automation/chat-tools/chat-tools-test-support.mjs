import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importTestBundle } from "#test-bundle";

export const loaded = await importTestBundle("automation-chat-tools", {
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

export function sampleSpec(cwd, id = "daily-check", extra = {}) {
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

export async function setupFixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), "dexon-automation-chat-tools-"));
  const cwd = path.join(base, "workspace");
  const dataDir = path.join(base, "automation");
  await mkdir(cwd);
  await mkdir(dataDir);
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
    await rm(base, { recursive: true, force: true });
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
