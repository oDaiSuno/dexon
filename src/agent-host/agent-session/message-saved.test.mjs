import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { importTestBundle } from "#test-bundle";

const { AgentSessionWrapper } = await importTestBundle("agent-session-message-saved", {
  packages: "external",
  tsconfig: "tsconfig.renderer.json",
  stdin: {
    contents: 'export {AgentSessionWrapper} from "./src/agent-host/rpc-manager";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
});

const MESSAGE_EVENT = /^message_(?:start|end|saved)$/;

function savedMessageIds(sessionFile) {
  return readFileSync(sessionFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.id);
}

async function realSession(t, responses) {
  const base = mkdtempSync(path.join(tmpdir(), "dexon-message-saved-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const cwd = path.join(base, "project");
  const agentDir = path.join(base, "agent");
  const sessionDir = path.join(base, "sessions");
  [cwd, agentDir, sessionDir].forEach((dir) => mkdirSync(dir));
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
  });
  const sessionManager = SessionManager.create(cwd, sessionDir);
  const { session } = await createAgentSessionFromServices({ services, sessionManager });
  const api = "faux-message-saved";
  const faux = createFauxCore({
    api,
    provider: api,
    models: [{ id: "faux-model", name: "faux-model", reasoning: true, input: ["text"] }],
  });
  faux.setResponses(responses);
  session.modelRuntime.registerProvider(api, {
    name: api,
    baseUrl: "http://127.0.0.1:0",
    api,
    apiKey: "x",
    streamSimple: faux.streamSimple,
    models: [
      {
        id: "faux-model",
        name: "faux-model",
        api,
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32000,
        maxTokens: 2048,
      },
    ],
  });
  await session.setModel(session.modelRuntime.getModel(api, "faux-model"));
  const wrapper = new AgentSessionWrapper(session, undefined, () => {});
  wrapper.start();
  t.after(async () => {
    await wrapper.dispose({ abort: false, reason: "test" });
    await session.dispose();
  });
  return { session, sessionManager, wrapper };
}

function simplifiedSession() {
  let listener = () => undefined;
  return {
    sessionId: "simplified-session",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: false,
    autoRetryEnabled: false,
    model: undefined,
    modelRuntime: { getModel: () => undefined },
    sessionManager: { getHeader: () => ({ cwd: "/tmp/simplified-workspace" }) },
    settingsManager: {},
    agent: { state: {} },
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe(next) {
      listener = next;
      return () => undefined;
    },
    announce(event) {
      listener(event);
    },
  };
}

test("after every message is saved, the agent host tells the renderer the id the session file holds, before anything about the next message arrives", async (t) => {
  const { sessionManager, wrapper } = await realSession(t, [
    fauxAssistantMessage([fauxThinking("先看看配置。"), fauxToolCall("read", { path: "missing-config.toml" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxThinking("文件不存在。"), fauxText("结论：配置正常。")]),
  ]);
  const events = [];
  const done = Promise.withResolvers();
  wrapper.onEvent((event) => {
    events.push(event);
    if (event.type === "prompt_done") done.resolve();
    if (event.type === "prompt_error") done.reject(new Error(String(event.errorMessage)));
  });
  await wrapper.send({ type: "prompt", message: "帮我检查这个项目的配置。" });
  await done.promise;
  await new Promise((resolve) => setImmediate(resolve));

  const milestones = events.filter((event) => MESSAGE_EVENT.test(event.type));
  for (let index = 0; index < milestones.length; index += 1) {
    if (milestones[index].type !== "message_end") continue;
    assert.equal(
      milestones[index + 1]?.type,
      "message_saved",
      `the ${milestones[index].message.role} message reports being saved right after it ends`,
    );
    assert.ok(
      index + 2 >= milestones.length || milestones[index + 2].type === "message_start",
      "the notice arrives before anything about the next message",
    );
  }

  const fileIds = savedMessageIds(sessionManager.getSessionFile());
  const announced = events.filter((event) => event.type === "message_saved").map((event) => event.entryId);
  assert.deepEqual(
    announced,
    fileIds,
    "the question, the reply, the tool result and the closing reply each report the id written to the session file",
  );
});

test("a session that cannot say which entry was saved last keeps running and reports nothing", async (t) => {
  const inner = simplifiedSession();
  const wrapper = new AgentSessionWrapper(inner, undefined, () => {});
  t.after(() => wrapper.dispose({ abort: false, reason: "test" }));
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();

  inner.announce({ type: "message_end", message: { role: "assistant", content: [], timestamp: 1 } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(events.filter((event) => event.type === "message_saved").length, 0, "nothing is announced as saved");
  assert.ok(wrapper.isAlive(), "the session keeps running");
  assert.equal(wrapper.cwd, "/tmp/simplified-workspace");
});
