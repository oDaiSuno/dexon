import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  createCodemodeExtension,
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

const CODEMODE_EXTENSION = { name: "codemode", factory: createCodemodeExtension(), replaceable: true };

async function openPolicySession(
  t,
  { bound = true, globals, toolchain = null, customTools = [], extensions = [] } = {},
) {
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
      extensionFactories: [RunPolicy.extension(() => bridge.policy), deferredToolExtension, ...extensions],
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
    globals: globals ?? (() => ({ browserToolNames: new Set(), orchestrationEnabled: false, codemodeEnabled: false })),
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
    globals: () => ({
      browserToolNames: new Set(globals.browser),
      orchestrationEnabled: globals.orchestration,
      codemodeEnabled: false,
    }),
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

test("the codemode tool is declared only while codemode is enabled, even if Pi activated it itself", async (t) => {
  const state = { enabled: true };
  const { session, ask, intend } = await openPolicySession(t, {
    extensions: [CODEMODE_EXTENSION],
    globals: () => ({ browserToolNames: new Set(), orchestrationEnabled: false, codemodeEnabled: state.enabled }),
  });
  intend(agent(["read"]));

  const enabled = await ask("enabled");
  assert.deepEqual(enabled.tools, ["read", "codemode"]);

  state.enabled = false;
  session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
  const disabled = await ask("disabled");
  assert.deepEqual(disabled.tools, ["read"]);

  state.enabled = true;
  const restored = await ask("restored");
  assert.deepEqual(restored.tools, ["read", "codemode"]);
});

test("each run follows live codemode globals before it declares tools", async (t) => {
  const state = { enabled: false };
  const { ask, intend } = await openPolicySession(t, {
    extensions: [CODEMODE_EXTENSION],
    globals: () => ({ browserToolNames: new Set(), orchestrationEnabled: false, codemodeEnabled: state.enabled }),
  });
  intend(agent(["read"]));

  assert.deepEqual((await ask("first")).tools, ["read"]);
  state.enabled = true;
  assert.deepEqual((await ask("second")).tools, ["read", "codemode"]);
});

test("a bare session declares no tools even when codemode is enabled", async (t) => {
  const { ask, intend } = await openPolicySession(t, {
    extensions: [CODEMODE_EXTENSION],
    globals: () => ({ browserToolNames: new Set(), orchestrationEnabled: false, codemodeEnabled: true }),
  });
  intend(BARE);

  const request = await ask("bare");
  assert.deepEqual(request.tools, []);
  assert.equal(request.prompt, "");
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

const QUOTE_VERBATIM = "第一行原文\n第二行 <b>原文</b>";
const quotePrompt = (attributes) =>
  ["<quotes>", `<quote ${attributes}>`, QUOTE_VERBATIM, "</quote>", "</quotes>", "", "请解释 [quote:1]"].join("\n");
const STORED_QUOTE_PROMPT = quotePrompt('id="1" from="assistant" entry="e-42" pre="前文" suf="后文"');
const MODEL_QUOTE_PROMPT = quotePrompt('id="1" from="assistant"');

const messageText = (message) =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((block) => (block.type === "text" ? block.text : "")).join("");

function captureContextHook() {
  let hook;
  RunPolicy.extension(() => undefined).factory({
    on: (name, handler) => {
      if (name === "context") hook = handler;
    },
  });
  return hook;
}

test("selection quotes reach the model without jump coordinates while the transcript keeps them, and a second pass changes nothing", async (t) => {
  const { session, ask, intend } = await openPolicySession(t);
  intend(agent(["read"]));

  const first = await ask(STORED_QUOTE_PROMPT);
  const again = await ask("再问一次");
  for (const request of [first, again]) {
    const sent = request.messages.find((message) => message.role === "user");
    assert.equal(messageText(sent), MODEL_QUOTE_PROMPT);
  }
  const stored = session.agent.state.messages.find((message) => message.role === "user");
  assert.equal(messageText(stored), STORED_QUOTE_PROMPT);

  const hook = captureContextHook();
  const userText = { role: "user", content: STORED_QUOTE_PROMPT, timestamp: 1 };
  const userBlocks = { role: "user", content: [{ type: "text", text: STORED_QUOTE_PROMPT }], timestamp: 2 };
  const assistant = { role: "assistant", content: [{ type: "text", text: STORED_QUOTE_PROMPT }], timestamp: 3 };
  const plain = { role: "user", content: "没有引用的问题", timestamp: 4 };
  const original = [userText, userBlocks, assistant, plain];

  const firstPass = hook({ messages: original }).messages;
  assert.deepEqual(firstPass.map(messageText), [
    MODEL_QUOTE_PROMPT,
    MODEL_QUOTE_PROMPT,
    STORED_QUOTE_PROMPT,
    "没有引用的问题",
  ]);
  assert.equal(messageText(userText), STORED_QUOTE_PROMPT);
  assert.equal(messageText(userBlocks), STORED_QUOTE_PROMPT);
  assert.equal(firstPass[2], assistant);
  assert.equal(firstPass[3], plain);

  const secondPass = hook({ messages: firstPass }).messages;
  secondPass.forEach((message, index) => assert.equal(message, firstPass[index]));
});
