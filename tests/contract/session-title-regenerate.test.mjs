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
model.configure(agent, {
  models: [{ id: heldModel.modelId }, { id: "naming-model" }],
  settings: { defaultModel: "naming-model" },
});

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

const conversationModel = { provider: heldModel.provider, modelId: heldModel.modelId };
const namingModel = { provider: heldModel.provider, modelId: "naming-model" };

async function titleSession(
  sessionId,
  { name, prompt = "Fix the styling of the login page", conversation = conversationModel } = {},
) {
  const sessionPath = path.join(sessions, `2026-10-25T00-00-00-000Z_${sessionId}.jsonl`);
  const timestamp = "2026-10-25T00:00:00.000Z";
  const entries = [
    { type: "session", version: 3, id: sessionId, timestamp, cwd: workspace },
    ...(conversation
      ? [{ type: "model_change", id: `${sessionId}-model`, parentId: null, timestamp, ...conversation }]
      : []),
    ...(prompt === null
      ? []
      : [
          {
            type: "message",
            id: `${sessionId}-user`,
            parentId: conversation ? `${sessionId}-model` : null,
            timestamp,
            message: { role: "user", content: prompt, timestamp: Date.parse(timestamp) },
          },
        ]),
  ];
  writeFileSync(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  await client.call("sessions.list");
  if (name) await client.call("sessions.rename", { id: sessionId, name });
  return () => SessionManager.open(sessionPath).getSessionName();
}

test("regenerating a name replaces a name the user typed using the stored first prompt", async () => {
  const storedName = await titleSession("regenerate-manual", { name: "My own name" });
  const result = await client.call("agent.generateTitle", {
    sessionId: "regenerate-manual",
    trigger: "regenerate",
    namingModel,
  });
  assert.deepEqual(result, { title: "Login page styling fix" });
  assert.equal(storedName(), "Login page styling fix");
});

test("when the naming model fails, regenerating keeps the current name instead of a cut-off message", async () => {
  model.script("Broken naming request", [{ error: { status: 400, message: "model refused" } }]);
  const storedName = await titleSession("regenerate-failure", {
    name: "Name worth keeping",
    prompt: "Broken naming request",
  });
  const result = await client.call("agent.generateTitle", {
    sessionId: "regenerate-failure",
    trigger: "regenerate",
  });
  assert.deepEqual(result, { title: null });
  assert.equal(storedName(), "Name worth keeping");
});

test("automatic naming leaves an already named session untouched without calling the model", async () => {
  const storedName = await titleSession("automatic-named", { name: "Chosen by hand" });
  const before = model.requests().length;
  const result = await client.call("agent.generateTitle", {
    sessionId: "automatic-named",
    trigger: "first-prompt",
    prompt: "Fix the styling of the login page",
    namingModel,
  });
  assert.deepEqual(result, { title: null });
  assert.equal(storedName(), "Chosen by hand");
  assert.equal(model.requests().length, before);
});

test("regenerating a long expanded skill prompt sends the stored user's goal first and the hint last", async () => {
  const goal = "帮我梳理架构";
  const expanded = `<skill name="fast-context" location="/x/SKILL.md">\n${"Skill body ".repeat(400)}\n</skill>\n\n${goal}`;
  const storedName = await titleSession("regenerate-long-skill", { name: "Old skill name", prompt: expanded });
  const before = model.requests().length;
  const result = await client.call("agent.generateTitle", {
    sessionId: "regenerate-long-skill",
    trigger: "regenerate",
    namingModel,
  });
  assert.deepEqual(result, { title: "Login page styling fix" });
  assert.equal(storedName(), "Login page styling fix");
  const request = model.requests()[before];
  assert.equal(request.messages.find((message) => message.role === "user").content, `${goal}\n\n(Skill: fast-context)`);
});

test("an HTTP 400 from the preferred naming model is retried with the conversation model", async () => {
  const prompt = "Preferred model refuses this naming request";
  model.script(prompt, [
    { error: { status: 400, message: "preferred model refused" } },
    { text: "Conversation model recovered" },
  ]);
  const storedName = await titleSession("regenerate-retry", { name: "Old name", prompt });
  const before = model.requests().length;
  const result = await client.call("agent.generateTitle", {
    sessionId: "regenerate-retry",
    trigger: "regenerate",
    namingModel,
  });
  assert.deepEqual(result, { title: "Conversation model recovered" });
  assert.equal(storedName(), "Conversation model recovered");
  assert.deepEqual(
    model
      .requests()
      .slice(before)
      .map((request) => request.model),
    ["naming-model", heldModel.modelId],
  );
});

test("an unreachable naming preference falls back to the session's own model instead of the settings default", async () => {
  const storedName = await titleSession("regenerate-stale", { name: "Old name" });
  const before = model.requests().length;
  const result = await client.call("agent.generateTitle", {
    sessionId: "regenerate-stale",
    trigger: "regenerate",
    namingModel: { provider: "removed-provider", modelId: "removed-model" },
  });
  assert.deepEqual(result, { title: "Login page styling fix" });
  assert.equal(storedName(), "Login page styling fix");
  assert.deepEqual(
    model
      .requests()
      .slice(before)
      .map((request) => request.model),
    [heldModel.modelId],
  );
});

test("an unset naming preference uses the session's own model", async () => {
  await titleSession("regenerate-unset", { name: "Old name" });
  const before = model.requests().length;
  await client.call("agent.generateTitle", { sessionId: "regenerate-unset", trigger: "regenerate" });
  assert.deepEqual(
    model
      .requests()
      .slice(before)
      .map((request) => request.model),
    [heldModel.modelId],
  );
});

test("a session without a recorded model uses the settings default", async () => {
  await titleSession("regenerate-default", { conversation: null });
  const before = model.requests().length;
  await client.call("agent.generateTitle", { sessionId: "regenerate-default", trigger: "regenerate" });
  assert.deepEqual(
    model
      .requests()
      .slice(before)
      .map((request) => request.model),
    ["naming-model"],
  );
});

test("automatic naming writes nothing when both models fail and later regeneration remains possible", async () => {
  const prompt = "Both naming models fail for this first prompt";
  model.script(prompt, [
    { error: { status: 400, message: "preferred refused" } },
    { error: { status: 400, message: "conversation refused" } },
  ]);
  const storedName = await titleSession("automatic-failure", { prompt });
  const before = model.requests().length;
  const result = await client.call("agent.generateTitle", {
    sessionId: "automatic-failure",
    trigger: "first-prompt",
    prompt,
    namingModel,
  });
  assert.deepEqual(result, { title: null });
  assert.equal(storedName(), undefined);
  assert.deepEqual(
    model
      .requests()
      .slice(before)
      .map((request) => request.model),
    ["naming-model", heldModel.modelId],
  );
  const regenerated = await client.call("agent.generateTitle", {
    sessionId: "automatic-failure",
    trigger: "regenerate",
  });
  assert.deepEqual(regenerated, { title: "Login page styling fix" });
  assert.equal(storedName(), "Login page styling fix");
});

test("an unusable generated title retries the conversation model", async () => {
  const prompt = "The preferred model returns only punctuation";
  model.script(prompt, [{ text: "...。！" }, { text: "Recovered from empty title" }]);
  await titleSession("regenerate-empty-title", { prompt });
  const result = await client.call("agent.generateTitle", {
    sessionId: "regenerate-empty-title",
    trigger: "regenerate",
    namingModel,
  });
  assert.deepEqual(result, { title: "Recovered from empty title" });
});

test(
  "a hanging preferred model leaves the conversation model time to generate a complete title",
  { timeout: 20_000 },
  async (t) => {
    const prompt = "Preferred naming request hangs after partial output";
    const held = model.hold(prompt, { partial: "Incomplete title", rest: " must not be saved" });
    t.after(() => held.release());
    const storedName = await titleSession("regenerate-hanging", { prompt });
    const before = model.requests().length;
    const result = await client.call("agent.generateTitle", {
      sessionId: "regenerate-hanging",
      trigger: "regenerate",
      namingModel,
    });
    assert.deepEqual(result, { title: "Login page styling fix" });
    assert.equal(storedName(), "Login page styling fix");
    assert.deepEqual(
      model
        .requests()
        .slice(before)
        .map((request) => request.model),
      ["naming-model", heldModel.modelId],
    );
  },
);

test("commands and bare skills write no name and make no model request", async () => {
  const storedName = await titleSession("automatic-no-goal", { prompt: "/skill:fast-context" });
  const before = model.requests().length;
  for (const prompt of ["/skill:fast-context", "/skill:fast-context 好", "/model chosen"]) {
    assert.deepEqual(
      await client.call("agent.generateTitle", {
        sessionId: "automatic-no-goal",
        trigger: "first-prompt",
        prompt,
        namingModel,
      }),
      { title: null },
    );
  }
  assert.deepEqual(
    await client.call("agent.generateTitle", { sessionId: "automatic-no-goal", trigger: "regenerate" }),
    { title: null },
  );
  assert.equal(storedName(), undefined);
  assert.equal(model.requests().length, before);
});

test("a manual rename saved during automatic naming always wins", async (t) => {
  const prompt = "Generate a name while the user renames by hand";
  const held = model.hold(prompt, { partial: "Automatic", rest: " title" });
  t.after(() => held.release());
  const storedName = await titleSession("automatic-manual-wins", { prompt });
  const pending = client.call("agent.generateTitle", {
    sessionId: "automatic-manual-wins",
    trigger: "first-prompt",
    prompt,
  });
  await held.partialSent();
  await client.call("sessions.rename", { id: "automatic-manual-wins", name: "Chosen by hand during naming" });
  held.release();
  assert.deepEqual(await pending, { title: null });
  assert.equal(storedName(), "Chosen by hand during naming");
});

test("invalid naming requests fail at the RPC boundary", async () => {
  for (const params of [
    { sessionId: "regenerate-manual", trigger: "unknown" },
    { sessionId: "regenerate-manual", trigger: "first-prompt", prompt: 123 },
    { trigger: "regenerate" },
  ]) {
    await assert.rejects(client.call("agent.generateTitle", params), (error) => error.code === "BAD_REQUEST");
  }
});
