import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { importTestBundle } from "#test-bundle";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { heldModel, startHeldModelServer } from "../fixtures/held-model-server.mjs";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dexon-title-regenerate-")));
const agent = path.join(base, "agent");
const workspace = path.join(base, "workspace");
const sessions = path.join(base, "sessions", "regenerate-fixture");
for (const directory of [agent, workspace, sessions]) mkdirSync(directory, { recursive: true });
const variables = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE"];
const previous = new Map(variables.map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
process.env.PI_DESKTOP_USER_DATA = path.join(base, "desktop");
process.env.PI_OFFLINE = "1";
const restoreMainProcess = installMainProcessPort();
const model = await startHeldModelServer({ otherReply: "Login page styling fix" });
model.configure(agent);

const { registerHandlers } = await importTestBundle("host-title-regenerate", {
  packages: "external",
  absWorkingDir: path.resolve(import.meta.dirname, "../.."),
  entryPoints: ["src/agent-host/handlers.ts"],
});
const server = createRpcServer();
const { port1, port2 } = new MessageChannel();
server.attachPort(port1);
const client = createRpcClient(port2);
const cleanupHost = registerHandlers(server);

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

async function namedSession(sessionId, name) {
  const sessionPath = path.join(sessions, `2026-10-25T00-00-00-000Z_${sessionId}.jsonl`);
  writeFileSync(
    sessionPath,
    `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-10-25T00:00:00.000Z", cwd: workspace })}\n`,
    "utf8",
  );
  await client.call("sessions.list");
  await client.call("sessions.rename", { id: sessionId, name });
  return () => SessionManager.open(sessionPath).getSessionName();
}

const namingModel = { provider: heldModel.provider, modelId: heldModel.modelId };

test("regenerating a name replaces a name the user typed with the newly generated one", async () => {
  const storedName = await namedSession("regenerate-manual", "My own name");
  const result = await client.call("agent.generateTitle", {
    sessionId: "regenerate-manual",
    message: "Fix the styling of the login page",
    ...namingModel,
    replace: true,
  });
  assert.deepEqual(result, { title: "Login page styling fix" });
  assert.equal(storedName(), "Login page styling fix");
});

test("when the naming model fails, regenerating keeps the current name instead of a cut-off message", async () => {
  model.script("Broken naming request", [{ error: { status: 400, message: "model refused" } }]);
  const storedName = await namedSession("regenerate-failure", "Name worth keeping");
  const result = await client.call("agent.generateTitle", {
    sessionId: "regenerate-failure",
    message: "Broken naming request",
    ...namingModel,
    replace: true,
  });
  assert.deepEqual(result, { title: null });
  assert.equal(storedName(), "Name worth keeping");
});

test("automatic naming still leaves a session that already has a name untouched", async () => {
  const storedName = await namedSession("automatic-named", "Chosen by hand");
  const result = await client.call("agent.generateTitle", {
    sessionId: "automatic-named",
    message: "Fix the styling of the login page",
    ...namingModel,
  });
  assert.deepEqual(result, { title: null });
  assert.equal(storedName(), "Chosen by hand");
});
