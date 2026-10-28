import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

export const SESSION_TOOL_NAMES = [
  "session_new",
  "session_prompt",
  "session_wait",
  "session_list",
  "session_read",
  "session_stop",
  "session_close",
  "session_models",
  "session_set_model",
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

export function resultQueue(host) {
  let cursor = host.model.toolResults().length;
  const pending = [];
  return {
    async named(name) {
      for (;;) {
        while (pending.length > 0) {
          const next = pending.shift();
          if (next.name === name) return next;
        }
        const all = await host.model.waitForToolResults(cursor + 1);
        pending.push(...all.slice(cursor));
        cursor = all.length;
      }
    },
  };
}

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
  agentSettings,
  models = [{ id: heldModel.modelId, reasoning: true }],
  extraProviders = [],
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
    extraProviders,
    ...(agentSettings ? { settings: agentSettings } : {}),
    ...(retry === false || (retry && typeof retry === "object") ? { retry } : {}),
  });
  const mainPort = installMainProcessPort(settings ? { sessionOrchestration: settings } : {});

  const requested = { registerHandlers: "./src/agent-host/handlers.ts", ...modules };

  async function boot(label) {
    const loaded = await importTestBundle(label, {
      packages: "external",
      stdin: {
        contents: Object.entries(requested)
          .map(([exported, modulePath]) => `export { ${exported} } from ${JSON.stringify(modulePath)};`)
          .join("\n"),
        resolveDir: projectRoot,
        loader: "ts",
      },
    });
    const rpcServer = createRpcServer();
    const { port1, port2 } = new MessageChannel();
    rpcServer.attachPort(port1);
    const rpcClient = createRpcClient(port2);
    return { loaded, rpcServer, port1, rpcClient, cleanup: loaded.registerHandlers(rpcServer) };
  }

  let runtime = await boot(name);
  let restarts = 0;
  let closed = false;

  async function stopRuntime() {
    const stopped = runtime;
    runtime = null;
    await stopped.cleanup();
    stopped.rpcClient.close();
    stopped.rpcServer.detachPort(stopped.port1);
  }

  const listed = async (cwd) => (await runtime.rpcClient.call("sessions.list", cwd ? { cwd } : undefined)).sessions;
  const sessionRow = async (sessionId) => (await listed()).find((session) => session.id === sessionId);

  return {
    base,
    get client() {
      return runtime.rpcClient;
    },
    get module() {
      return runtime.loaded;
    },
    model,
    mainPort,
    sessions: listed,
    sessionRow,
    workspace(label) {
      const directory = path.join(workspaceRoot, label);
      mkdirSync(directory, { recursive: true });
      return realpathSync(directory);
    },
    async createUserSession({ cwd, provider, modelId, thinkingLevel } = {}) {
      const directory = cwd ?? this.workspace(`user-${Date.now()}`);
      const result = await runtime.rpcClient.call("agent.new", {
        cwd: directory,
        type: "ensure_session",
        ...(provider && modelId ? { provider, modelId } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
      return result.sessionId;
    },
    async prompt(sessionId, message) {
      await runtime.rpcClient.call("agent.command", { sessionId, command: { type: "prompt", message } });
    },
    async command(sessionId, command) {
      return runtime.rpcClient.call("agent.command", { sessionId, command });
    },
    async tools(sessionId) {
      return runtime.rpcClient.call("agent.command", { sessionId, command: { type: "get_tools" } });
    },
    async activeToolNames(sessionId) {
      return (await this.tools(sessionId))
        .filter((tool) => tool.active)
        .map((tool) => tool.name)
        .sort();
    },
    async state(sessionId) {
      return runtime.rpcClient.call("agent.state", { sessionId });
    },
    async detail(sessionId) {
      return runtime.rpcClient.call("sessions.get", { id: sessionId, includeState: true });
    },
    async runningIds() {
      return (await runtime.rpcClient.call("sessions.list")).runningSessionIds;
    },
    events(sessionId) {
      return collectEvents(runtime.rpcClient, sessionId);
    },
    async writeAgentSettings(extra) {
      const filePath = path.join(agentDirectory, "settings.json");
      const current = JSON.parse(readFileSync(filePath, "utf8"));
      writeFileSync(filePath, JSON.stringify({ ...current, ...extra }));
    },
    async writeSession(sessionId, cwd, entries) {
      await listed();
      const header = {
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: new Date(Date.UTC(2026, 7, 6, 9, 0, 0)).toISOString(),
        cwd,
      };
      const filePath = path.join(sessionDirectory, `2026-08-06T09-00-00-000Z_${sessionId}.jsonl`);
      const lines = [header, ...entries].map((entry) => JSON.stringify(entry));
      writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
      return filePath;
    },
    async restart() {
      await stopRuntime();
      restarts += 1;
      runtime = await boot(`${name}-reopened-${restarts}`);
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        if (runtime) await stopRuntime();
      } finally {
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
