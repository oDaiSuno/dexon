import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
export const base = await mkdtemp(path.join(tmpdir(), "dexon-automation-profile-"));
const previous = [
  ["PI_CODING_AGENT_DIR", process.env.PI_CODING_AGENT_DIR],
  ["PI_CODING_AGENT_SESSION_DIR", process.env.PI_CODING_AGENT_SESSION_DIR],
  ["PI_OFFLINE", process.env.PI_OFFLINE],
];
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
process.env.PI_OFFLINE = "1";
test.after(async () => {
  for (const [key, value] of previous)
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  await rm(base, { recursive: true, force: true });
});
export const runtime = await importTestBundle(
  "automation-execution-profile",
  {
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
  },
  { companions: { "model-catalog-worker.mjs": "src/agent-host/model-catalog/catalog-worker.ts" } },
);
