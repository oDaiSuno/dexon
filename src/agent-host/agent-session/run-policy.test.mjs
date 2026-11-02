import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { importTestBundle } from "#test-bundle";

const { RunPolicy, renderToolchainSection } = await importTestBundle("agent-session-run-policy", {
  packages: "external",
  tsconfig: "tsconfig.renderer.json",
  stdin: {
    contents: 'export {RunPolicy, renderToolchainSection} from "./src/agent-host/agent-session/run-policy";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
});

const DEFERRED_TOOL = "lookup_docs";

function tool(name, extra = {}) {
  return {
    name,
    label: name,
    description: `${name} tool`,
    promptSnippet: `${name}: test tool`,
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: name }], details: undefined }),
    ...extra,
  };
}

function deferredToolExtension(pi) {
  pi.registerTool(tool(DEFERRED_TOOL, { exposure: "deferred" }));
}

async function openPolicySession(t, { bound = true, globals, toolchain = null, customTools = [] } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "dexon-run-policy-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cwd = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  const sessionDir = path.join(base, "sessions");
  [cwd, agentDir, sessionDir].forEach((directory) => mkdirSync(directory));

  const bridge = {};
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: {
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [RunPolicy.extension(() => bridge.policy), deferredToolExtension],
    },
  });
  const faux = fauxProvider();
  services.modelRuntime.registerNativeProvider(faux.provider);
  const sessionManager = SessionManager.create(cwd, sessionDir);
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model: faux.getModel(),
    ...(customTools.length ? { customTools } : {}),
  });
  t.after(() => session.dispose());
  await session.bindExtensions({ mode: "rpc" });

  const intents = new Map();
  const store = {
    get: (sessionId) => intents.get(sessionId),
    set: (sessionId, intent) => intents.set(sessionId, intent),
  };
  const policy = new RunPolicy({
    session,
    toolchain,
    intents: store,
    globals: globals ?? (() => ({ browserToolNames: new Set(), orchestrationEnabled: false })),
  });
  if (bound) bridge.policy = policy;

  const requests = [];
  const ask = async (text) => {
    faux.setResponses([
      (context) => {
        requests.push({
          prompt: getCurrentSystemPrompt(context.messages),
          tools: getCurrentTools(context.messages).map((declared) => declared.name),
          messages: context.messages,
        });
        return fauxAssistantMessage([fauxText("ok")]);
      },
    ]);
    await session.prompt(text);
    return requests.at(-1);
  };
  const intend = (intent) => policy.setToolIntent(intent);

  return { session, sessionManager, policy, ask, intend };
}

const BARE = { kind: "bare" };
const agent = (coding) => ({ kind: "agent", coding });

test("a bare session sends no prompt and no tools, and returning to the construction tool set declares it again", async (t) => {
  const { session, ask, intend } = await openPolicySession(t, {
    toolchain: renderToolchainSection(3, ["node 22"]),
  });
  const constructionTools = session.getActiveToolNames();
  assert.deepEqual(constructionTools, ["read", "bash", "edit", "write"]);

  intend(BARE);
  const bare = await ask("bare");
  assert.deepEqual(bare.tools, []);
  assert.equal(bare.prompt, "");

  intend(agent(["read", "bash", "edit", "write"]));
  const restored = await ask("agent");
  assert.deepEqual(restored.tools, constructionTools);
  assert.match(restored.prompt, /<dexon-toolchain>\nnode 22\nrevision 3\n<\/dexon-toolchain>/);
});

test("a session whose policy is not bound yet fails closed with no prompt and no tools", async (t) => {
  const { session, ask } = await openPolicySession(t, { bound: false });

  const request = await ask("unbound");
  assert.deepEqual(request.tools, []);
  assert.equal(request.prompt, "");
  assert.deepEqual(session.getActiveToolNames(), []);
});

test("a deferred tool stays off after it is explicitly deactivated, even though the transcript once declared it", async (t) => {
  const { session, ask, intend } = await openPolicySession(t);
  intend(agent(["read"]));

  const first = await ask("first");
  assert.deepEqual(first.tools, ["read"]);

  session.setActiveToolsByName([...session.getActiveToolNames(), DEFERRED_TOOL]);
  const loaded = await ask("loaded");
  assert.deepEqual(loaded.tools, ["read", DEFERRED_TOOL]);

  session.setActiveToolsByName(["read"]);
  const deactivated = await ask("deactivated");
  assert.deepEqual(deactivated.tools, ["read"]);
});

test("moving the leaf back before a deferred tool was loaded drops that tool from later runs", async (t) => {
  const { session, sessionManager, policy, ask, intend } = await openPolicySession(t);
  intend(agent(["read"]));
  await ask("first");
  const beforeLoad = sessionManager.getLeafId();

  session.setActiveToolsByName([...session.getActiveToolNames(), DEFERRED_TOOL]);
  const loaded = await ask("loaded");
  assert.ok(loaded.tools.includes(DEFERRED_TOOL));

  sessionManager.branch(beforeLoad);
  session.refreshContext();
  policy.reconcileLiveToolsFromBranch();
  assert.deepEqual(session.getActiveToolNames(), ["read"]);

  const afterMove = await ask("after move");
  assert.deepEqual(afterMove.tools, ["read"]);
});

test("capability-gated tools stay inactive on registration and follow the live globals at the next run", async (t) => {
  const globals = { browser: [], orchestration: false };
  const { session, policy, ask, intend } = await openPolicySession(t, {
    customTools: [
      tool("browser_open", { exposure: "direct", defaultActive: false, dexonOwner: "browser" }),
      tool("session_list", { exposure: "direct", defaultActive: false, dexonOwner: "orchestration" }),
    ],
    globals: () => ({ browserToolNames: new Set(globals.browser), orchestrationEnabled: globals.orchestration }),
  });
  intend(agent(["read"]));
  assert.ok(!session.getActiveToolNames().includes("browser_open"));
  assert.equal(policy.view().tools.find((entry) => entry.name === "browser_open")?.owner, "browser");

  const gated = await ask("gated");
  assert.deepEqual(gated.tools, ["read"]);

  globals.browser = ["browser_open"];
  globals.orchestration = true;
  const widened = await ask("widened");
  assert.deepEqual([...widened.tools].sort(), ["browser_open", "read", "session_list"]);
});

test("the policy view shows the next run's tools immediately and the prompt only after Pi records it", async (t) => {
  const { policy, ask, intend } = await openPolicySession(t);
  intend(agent(["read"]));

  assert.deepEqual(
    policy
      .view()
      .tools.filter((entry) => entry.active)
      .map((entry) => entry.name),
    ["read"],
  );
  assert.equal(policy.view().systemPrompt, "");

  const first = await ask("first");
  assert.equal(policy.view().systemPrompt, first.prompt);

  intend(BARE);
  assert.equal(policy.view().profile, "bare");
  assert.equal(policy.view().systemPrompt, "");
});

test("legacy channel prompt headers are stripped from provider requests without rewriting the transcript", async (t) => {
  const { session, ask, intend } = await openPolicySession(t);
  intend(agent(["read"]));

  const request = await ask("[外部消息来源：微信]\n发送者标识：123\n---\nreal question");
  const sent = JSON.stringify(request.messages.find((message) => message.role === "user").content);
  assert.match(sent, /real question/);
  assert.doesNotMatch(sent, /外部消息来源/);
  const stored = JSON.stringify(session.agent.state.messages.find((message) => message.role === "user").content);
  assert.match(stored, /外部消息来源/);
});
