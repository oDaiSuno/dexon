import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { buildSync } from "esbuild";
import { importTestBundle } from "#test-bundle";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { startHeldModelServer } from "../fixtures/held-model-server.mjs";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";
import { branchWorld, currentBranch, sandbox, worktreeAdd } from "../support/worktree-repository.mjs";

const base = sandbox("dexon-worktree-busy-");
const agent = path.join(base, "agent");
mkdirSync(agent, { recursive: true });
const variables = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE"];
const previous = new Map(variables.map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
process.env.PI_DESKTOP_USER_DATA = path.join(base, "desktop");
process.env.PI_OFFLINE = "1";
const restoreMainProcess = installMainProcessPort({ managedProcesses: true });
const model = await startHeldModelServer();
model.configure(agent);

const root = path.resolve(import.meta.dirname, "../..");
const { registerHandlers, getManagedProcessService, hostDirectory } = await importTestBundle("worktree-busy-contract", {
  packages: "external",
  absWorkingDir: root,
  stdin: {
    contents: [
      'import { fileURLToPath } from "node:url";',
      'export { registerHandlers } from "./src/agent-host/handlers.ts";',
      'export { getManagedProcessService } from "./src/agent-host/managed-process/runtime.ts";',
      'export const hostDirectory = fileURLToPath(new URL(".", import.meta.url));',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
});

if (process.platform !== "win32")
  buildSync({
    absWorkingDir: root,
    entryPoints: ["src/agent-host/managed-process/worker.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: path.join(hostDirectory, "managed-process-worker.mjs"),
    logLevel: "silent",
  });

const server = createRpcServer();
const { port1, port2 } = new MessageChannel();
server.attachPort(port1);
const client = createRpcClient(port2);
const cleanupHost = registerHandlers(server);
const service = getManagedProcessService();

after(async () => {
  try {
    await cleanupHost();
  } finally {
    client.close();
    server.detachPort(port1);
    await model.close();
    restoreMainProcess();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(base, { recursive: true, force: true });
  }
});

async function switchBranch(cwd, branch) {
  await client.call("system.allowRoot", { path: cwd });
  return client.call("worktrees.switchBranch", { cwd, branch });
}

async function startConversation(t, cwd, prompt) {
  await client.call("system.allowRoot", { path: cwd });
  const held = model.hold(prompt, { partial: "thinking about it", rest: " and done" });
  t.after(() => held.release());
  const { sessionId } = await client.call("agent.new", { cwd, type: "ensure_session" });
  await client.call("agent.command", { sessionId, command: { type: "prompt", message: prompt } });
  await held.partialSent();
  const listed = await client.call("sessions.list");
  assert.ok(listed.runningSessionIds.includes(sessionId), "the conversation really is running");
  return sessionId;
}

async function startProcess(t, cwd, ownerCwd) {
  const started = await service.startForAgent("fixture-session", ownerCwd, true, {
    command: "sleep 60",
    cwd,
  });
  assert.equal(started.state, "running", "the managed process really is active");
  const { processId, runId } = started.process;
  t.after(async () => {
    await service.stop(processId, runId, "force", "user").catch(() => undefined);
  });
  return started.process;
}

test("a conversation answering in this folder blocks the switch", async (t) => {
  const world = branchWorld(path.join(base, "session-busy"));
  await startConversation(t, world.repository, "Explain the busy rule");
  const result = await switchBranch(world.repository, "feat/alpha");
  assert.deepEqual(result, { ok: false, reason: "busy" });
  assert.equal(currentBranch(world.repository), "main", "the folder stays on the branch it was on");
});

test("a conversation in a worktree nested inside this folder does not count as this folder being busy", async (t) => {
  const world = branchWorld(path.join(base, "session-nested"));
  const nested = worktreeAdd(world.repository, path.join(world.repository, ".worktrees", "alpha"), "feat/alpha");
  await startConversation(t, nested, "Work inside the nested worktree");
  const result = await switchBranch(world.repository, "feat/beta");
  assert.deepEqual(result, { ok: true });
  assert.equal(currentBranch(world.repository), "feat/beta", "the folder really moved to the target branch");
});

test(
  "a managed process running in this folder blocks the switch",
  { skip: process.platform === "win32" },
  async (t) => {
    const world = branchWorld(path.join(base, "process-busy"));
    await startProcess(t, world.repository, world.repository);
    const result = await switchBranch(world.repository, "feat/beta");
    assert.deepEqual(result, { ok: false, reason: "busy" });
    assert.equal(currentBranch(world.repository), "main", "the folder stays on the branch it was on");
  },
);

test(
  "a managed process in a worktree nested inside this folder does not count as this folder being busy",
  { skip: process.platform === "win32" },
  async (t) => {
    const world = branchWorld(path.join(base, "process-nested"));
    const nested = worktreeAdd(world.repository, path.join(world.repository, ".worktrees", "alpha"), "feat/alpha");
    await startProcess(t, nested, world.repository);
    const result = await switchBranch(world.repository, "feat/beta");
    assert.deepEqual(result, { ok: true });
    assert.equal(currentBranch(world.repository), "feat/beta", "the folder really moved to the target branch");
  },
);
