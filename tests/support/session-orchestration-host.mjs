import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
import { createDeferred } from "#test-timing";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { heldModel, startHeldModelServer } from "../fixtures/held-model-server.mjs";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";

const ENVIRONMENT = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE"];
const projectRoot = path.resolve(import.meta.dirname, "../..");

// The user-visible tool surface from the issue: creation, prompting, waiting,
// listing, reading, stopping and closing. No tool exists for answering another
// session's question, so the list is also the proof of that absence.
export const SESSION_TOOL_NAMES = [
  "session_new",
  "session_prompt",
  "session_wait",
  "session_list",
  "session_read",
  "session_stop",
  "session_close",
];

export const ENABLED_SETTINGS = Object.freeze({
  enabled: true,
  maxRunning: 8,
  model: null,
  thinkingLevel: null,
  allowUserSessions: true,
});

export function toolPayload(toolResult) {
  try {
    return { ok: true, value: JSON.parse(toolResult.content) };
  } catch {
    return { ok: false, value: toolResult.content };
  }
}

export function expectToolPayload(toolResult, expectation) {
  const payload = toolPayload(toolResult);
  assert.equal(payload.ok, true, `${expectation}, but the tool answered: ${toolResult.content}`);
  return payload.value;
}

export function expectToolRefusal(toolResult, expectation, reason = null) {
  const payload = toolPayload(toolResult);
  assert.equal(payload.ok, false, `${expectation}, but the tool succeeded: ${toolResult.content}`);
  if (reason) assert.match(String(payload.value), reason);
  return String(payload.value);
}

export function textOf(message) {
  if (typeof message?.content === "string") return message.content;
  return (message?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export async function waitUntil(check, { timeoutMs = 20_000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await check();
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export function toolCall(name, input) {
  return { toolCall: { name, input } };
}

// Tool results are recorded for the whole file, so every test reads forward from
// where it started instead of guessing absolute indices.
export function resultReader(host) {
  let cursor = host.model.toolResults().length;
  return {
    async next(count = 1) {
      const all = await host.model.waitForToolResults(cursor + count);
      const taken = all.slice(cursor);
      cursor = all.length;
      return taken;
    },
  };
}

// One Agent turn whose model asks for the tools in `steps`. Returns the tool
// results the model itself received back, in order.
export async function runAgentTurn(host, sessionId, { prompt, steps, results = 1 }) {
  const before = host.model.toolResults().length;
  host.model.script(prompt, steps);
  await host.prompt(sessionId, prompt);
  if (results === 0) return [];
  const all = await host.model.waitForToolResults(before + results);
  return all.slice(before);
}

export function collectEvents(client, sessionId) {
  const all = [];
  const waiters = new Set();
  const off = client.subscribe("agent.events", sessionId, (event) => {
    all.push(event);
    for (const waiter of waiters) if (waiter.matches(event)) waiter.deferred.resolve(event);
  });
  return {
    off,
    all,
    next(matches) {
      const found = all.find(matches);
      if (found) return Promise.resolve(found);
      const waiter = { matches, deferred: createDeferred() };
      waiters.add(waiter);
      return waiter.deferred.promise.finally(() => waiters.delete(waiter));
    },
  };
}

export async function startSessionOrchestrationHost({
  name = "session-orchestration",
  settings,
  models = [{ id: heldModel.modelId, reasoning: true }],
  retry,
  modules = {},
  extension = null,
} = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), `dexon-${name}-`)));
  const agentDirectory = path.join(base, "agent");
  const sessionDirectory = path.join(base, "sessions");
  const desktopDirectory = path.join(base, "desktop");
  const workspaceRoot = path.join(base, "workspaces");
  for (const directory of [agentDirectory, sessionDirectory, desktopDirectory, workspaceRoot]) mkdirSync(directory);

  const previous = new Map(ENVIRONMENT.map((variable) => [variable, process.env[variable]]));
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  process.env.PI_CODING_AGENT_SESSION_DIR = sessionDirectory;
  process.env.PI_DESKTOP_USER_DATA = desktopDirectory;
  process.env.PI_OFFLINE = "1";

  if (extension) {
    mkdirSync(path.join(agentDirectory, "extensions"), { recursive: true });
    writeFileSync(path.join(agentDirectory, "extensions", extension.file), extension.source);
  }

  const model = await startHeldModelServer();
  model.configure(agentDirectory, {
    models,
    ...(retry === false ? { retry: false } : {}),
  });
  const mainPort = installMainProcessPort(settings ? { sessionOrchestration: settings } : {});

  const requested = { registerHandlers: "./src/agent-host/handlers.ts", ...modules };
  const module = await importTestBundle(name, {
    packages: "external",
    stdin: {
      contents: Object.entries(requested)
        .map(([exported, modulePath]) => `export { ${exported} } from ${JSON.stringify(modulePath)};`)
        .join("\n"),
      resolveDir: projectRoot,
      loader: "ts",
    },
  });

  const server = createRpcServer();
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const client = createRpcClient(port2);
  const cleanupHost = module.registerHandlers(server);
  let closed = false;

  const listed = async (cwd) => (await client.call("sessions.list", cwd ? { cwd } : undefined)).sessions;
  const sessionRow = async (sessionId) => (await listed()).find((session) => session.id === sessionId);

  return {
    base,
    client,
    model,
    mainPort,
    module,
    sessions: listed,
    sessionRow,
    workspace(label) {
      const directory = path.join(workspaceRoot, label);
      mkdirSync(directory, { recursive: true });
      return realpathSync(directory);
    },
    async createUserSession({ cwd, provider, modelId, thinkingLevel } = {}) {
      const directory = cwd ?? this.workspace(`user-${Date.now()}`);
      const result = await client.call("agent.new", {
        cwd: directory,
        type: "ensure_session",
        ...(provider && modelId ? { provider, modelId } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
      return result.sessionId;
    },
    async prompt(sessionId, message) {
      await client.call("agent.command", { sessionId, command: { type: "prompt", message } });
    },
    async command(sessionId, command) {
      return client.call("agent.command", { sessionId, command });
    },
    async tools(sessionId) {
      return client.call("agent.command", { sessionId, command: { type: "get_tools" } });
    },
    async activeToolNames(sessionId) {
      return (await this.tools(sessionId))
        .filter((tool) => tool.active)
        .map((tool) => tool.name)
        .sort();
    },
    async state(sessionId) {
      return client.call("agent.state", { sessionId });
    },
    async detail(sessionId) {
      return client.call("sessions.get", { id: sessionId, includeState: true });
    },
    async runningIds() {
      return (await client.call("sessions.list")).runningSessionIds;
    },
    events(sessionId) {
      return collectEvents(client, sessionId);
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await cleanupHost();
      } finally {
        client.close();
        server.detachPort(port1);
        await model.close();
        mainPort();
        for (const [variable, value] of previous) {
          if (value === undefined) delete process.env[variable];
          else process.env[variable] = value;
        }
        rmSync(base, { recursive: true, force: true });
      }
    },
  };
}
