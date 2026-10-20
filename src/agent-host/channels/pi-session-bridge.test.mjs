import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { importTestBundle } from "#test-bundle";

const base = mkdtempSync(path.join(tmpdir(), "dexon-real-channel-session-"));
const agent = path.join(base, "agent");
const sessions = path.join(base, "sessions");
const cwd = path.join(base, "workspace");
const restoredCwd = path.join(base, "restored");
[agent, sessions, cwd, restoredCwd].forEach((dir) => mkdirSync(dir));
const variables = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA"];
const previous = new Map(variables.map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_CODING_AGENT_SESSION_DIR = sessions;
process.env.PI_DESKTOP_USER_DATA = path.join(base, "desktop");
const parentDescriptor = Object.getOwnPropertyDescriptor(process, "parentPort");
const modelServer = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      'data: {"id":"fixture","object":"chat.completion.chunk","model":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","model":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
  });
});
await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
writeFileSync(
  path.join(agent, "models.json"),
  JSON.stringify({
    providers: {
      fixture: {
        baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`,
        api: "openai-completions",
        apiKey: "fixture-key",
        models: [
          {
            id: "fixture",
            name: "Fixture",
            reasoning: false,
            input: ["text"],
            contextWindow: 4096,
            maxTokens: 1024,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  }),
);
writeFileSync(
  path.join(agent, "settings.json"),
  JSON.stringify({ defaultProvider: "fixture", defaultModel: "fixture" }),
);

const parentListeners = new Set();
const shell = {
  capability: "shell.bash",
  provider: "system",
  executable: "/bin/bash",
  argvPrefix: [],
  binDir: "/bin",
  cwdSemantics: "native",
  envPatch: {},
};
// Only the separate Main process and model HTTP server are stand-ins. The
// registry, session files, SDK session, wrapper and channel bridge stay real.
process.parentPort = {
  on(type, listener) {
    if (type === "message") parentListeners.add(listener);
  },
  postMessage(message) {
    let result = {};
    if (message.method === "toolchain.getSnapshot")
      result = {
        revision: 1,
        generatedAt: "2026-08-06T00:00:00.000Z",
        platform: process.platform,
        arch: process.arch,
        candidates: [],
        defaults: { "shell.bash": shell },
        publicState: {},
      };
    if (message.method === "toolchain.resolve")
      result = {
        id: "fixture-resolution",
        inventoryRevision: 1,
        workspaceKey: message.params.cwd,
        requirementsHash: "fixture",
        commands: { "shell.bash": shell },
        summary: [],
      };
    globalThis.queueMicrotask(() => {
      for (const listener of parentListeners)
        listener({ data: { type: "host-rpc-result", id: message.id, ok: true, result } });
    });
  },
};
const { PiSessionBridge, disposeAllRpcSessions, getDesktopSessionToolNames } = await importTestBundle(
  "real-pi-session-bridge",
  {
    packages: "external",
    stdin: {
      contents:
        'export {PiSessionBridge} from "./pi-session-bridge.ts"; export {disposeAllRpcSessions} from "../rpc-manager.ts"; export {getDesktopSessionToolNames} from "../session-tool-store.ts";',
      resolveDir: import.meta.dirname,
      loader: "ts",
    },
  },
);
after(async () => {
  try {
    await disposeAllRpcSessions();
  } finally {
    await new Promise((resolve) => modelServer.close(resolve));
    if (parentDescriptor) Object.defineProperty(process, "parentPort", parentDescriptor);
    else delete process.parentPort;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(base, { recursive: true, force: true });
  }
});
function binding(patch = {}) {
  return {
    id: "binding-one",
    channel: "telegram",
    accountId: "account-one",
    peerKind: "dm",
    peerId: "user-one",
    cwd,
    toolNames: [],
    createdAt: "2026-08-06T00:00:00.000Z",
    lastUsedAt: "2026-08-06T00:00:00.000Z",
    ...patch,
  };
}
const activeTools = async (session) =>
  (await session.send({ type: "get_tools" }))
    .filter((tool) => tool.active)
    .map((tool) => tool.name)
    .sort();
const registeredTools = async (session) => (await session.send({ type: "get_tools" })).map((tool) => tool.name).sort();

test("restoring a channel session uses its saved directory and binding tool selection", async () => {
  const file = path.join(sessions, "saved.jsonl");
  writeFileSync(
    file,
    JSON.stringify({
      type: "session",
      version: 3,
      id: "saved-channel",
      timestamp: "2026-08-06T00:00:00.000Z",
      cwd: restoredCwd,
    }) + "\n",
  );
  let opened;
  const bridge = new PiSessionBridge((session) => {
    opened = session;
  });
  await bridge.runCommand(binding({ sessionId: "saved-channel", toolNames: ["read"] }), "reload");
  assert.equal(opened.cwd, restoredCwd);
  assert.equal(opened.sessionId, "saved-channel");
  assert.deepEqual(await activeTools(opened), ["read"]);
});

test("new dedicated sessions and the first channel turn use current account tools, not stale bindings", async () => {
  let opened;
  const bridge = new PiSessionBridge((session) => {
    opened = session;
  });
  const current = ["read", "bash", "edit", "write", "grep", "find", "ls"];
  const stale = binding({ channel: "weixin", toolNames: [] });
  const created = await bridge.newSession(stale, current);
  assert.equal(opened.sessionId, created.sessionId);
  assert.deepEqual(await activeTools(opened), [...current].sort());
  const turn = await bridge.runTurn(
    stale,
    {
      id: "message-one",
      channel: "weixin",
      accountId: "account-one",
      peer: { kind: "dm", id: "user-one" },
      sender: { id: "user-one" },
      text: "hello",
      mentionsBot: false,
      attachments: [],
      timestamp: 1,
    },
    undefined,
    [],
    current,
  );
  assert.equal(turn.finalText, "ok");
  assert.deepEqual(await activeTools(opened), [...current].sort());
});

test("tool synchronization changes a live session's active tools and its persisted preference", async () => {
  let opened;
  const bridge = new PiSessionBridge((session) => {
    opened = session;
  });
  const created = await bridge.newSession(binding(), []);
  await bridge.syncTools(binding({ sessionId: created.sessionId }), ["read"]);
  assert.deepEqual(await activeTools(opened), ["read"]);
  assert.deepEqual(getDesktopSessionToolNames(created.sessionId), ["read"]);
});

test("SDK PowerShell stays unavailable even when global defaultTools lists it", async () => {
  const settingsFile = path.join(agent, "settings.json");
  const originalSettings = readFileSync(settingsFile, "utf8");
  writeFileSync(
    settingsFile,
    JSON.stringify({
      defaultProvider: "fixture",
      defaultModel: "fixture",
      defaultTools: ["read", "powershell", "edit", "write"],
    }),
  );
  writeFileSync(
    path.join(sessions, "powershell.jsonl"),
    JSON.stringify({
      type: "session",
      version: 3,
      id: "powershell-session",
      timestamp: "2026-08-06T00:00:00.000Z",
      cwd: restoredCwd,
    }) + "\n",
  );
  try {
    let opened;
    const bridge = new PiSessionBridge((session) => {
      opened = session;
    });
    await bridge.newSession(binding(), ["read", "edit"]);
    assert.ok(!(await registeredTools(opened)).includes("powershell"));
    await bridge.runCommand(binding({ sessionId: "powershell-session", toolNames: ["read"] }), "reload");
    assert.equal(opened.sessionId, "powershell-session");
    assert.ok(!(await registeredTools(opened)).includes("powershell"));
    await bridge.runTurn(
      binding({ channel: "weixin" }),
      {
        id: "message-powershell",
        channel: "weixin",
        accountId: "account-one",
        peer: { kind: "dm", id: "user-one" },
        sender: { id: "user-one" },
        text: "hello",
        mentionsBot: false,
        attachments: [],
        timestamp: 1,
      },
      undefined,
      [],
      ["read", "edit"],
    );
    assert.ok(!(await registeredTools(opened)).includes("powershell"));
  } finally {
    writeFileSync(settingsFile, originalSettings);
  }
});

test("tool synchronization persists an inactive session's selection without starting it", async () => {
  const bridge = new PiSessionBridge(() => {
    throw new Error("inactive synchronization must not start a session");
  });
  await bridge.syncTools(binding({ sessionId: "inactive-session" }), ["read"]);
  assert.deepEqual(getDesktopSessionToolNames("inactive-session"), ["read"]);
  assert.deepEqual(bridge.getSessionStatus(binding({ sessionId: "inactive-session" })), {
    hasSession: true,
    running: false,
  });
});
