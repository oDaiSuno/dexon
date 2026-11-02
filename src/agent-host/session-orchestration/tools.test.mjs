import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { importTestBundle } from "#test-bundle";
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
  createSessionOrchestrationToolDefinitions,
  initializeSessionOrchestrationService,
  initializeSessionOrchestrationSettings,
  refreshSessionOrchestrationSettings,
  setBrowserSessionSource,
} = await importTestBundle("session-orchestration-tool-guards", {
  packages: "external",
  stdin: {
    contents: [
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
