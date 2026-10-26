import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const isolatedAgentDirectory = mkdtempSync(path.join(tmpdir(), "dexon-model-defaults-agent-"));
const otherProject = mkdtempSync(path.join(tmpdir(), "dexon-model-defaults-project-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(isolatedAgentDirectory, "sessions");
process.env.PI_OFFLINE = "1";
process.env.OPENAI_API_KEY = "sk-model-defaults-test";
test.after(() => {
  rmSync(isolatedAgentDirectory, { recursive: true, force: true });
  rmSync(otherProject, { recursive: true, force: true });
});

const { registerModelHandlers } = await importTestBundle("src/agent-host/handlers/models-defaults-test", {
  packages: "external",
  absWorkingDir: root,
  entryPoints: ["src/agent-host/handlers/models.ts"],
});

function captureModelHandlers() {
  const handlers = {};
  registerModelHandlers({
    handle(next) {
      Object.assign(handlers, next);
    },
    emit() {},
  });
  return handlers;
}

const handlers = captureModelHandlers();

test("before anything is chosen, the defaults report no model and Pi's own medium thinking level", async () => {
  assert.deepEqual(await handlers["models.defaults.get"]({ cwd: root }), { model: null, thinkingLevel: "medium" });
});

test("a default model and thinking level chosen once are shared by every project and become the new-session default", async () => {
  const saved = await handlers["models.defaults.set"]({
    cwd: root,
    model: { provider: "openai", modelId: "gpt-4.1" },
    thinkingLevel: "high",
  });
  assert.deepEqual(saved, { model: { provider: "openai", modelId: "gpt-4.1" }, thinkingLevel: "high" });
  assert.deepEqual(await handlers["models.defaults.get"]({ cwd: otherProject }), {
    model: { provider: "openai", modelId: "gpt-4.1" },
    thinkingLevel: "high",
  });
  const listed = await handlers["models.list"]({ cwd: otherProject });
  assert.deepEqual(listed.defaultModel, { provider: "openai", modelId: "gpt-4.1" });
});

test("changing only the thinking level keeps the default model, and changing only the model keeps the level", async () => {
  await handlers["models.defaults.set"]({ cwd: root, model: { provider: "openai", modelId: "gpt-4.1" } });
  await handlers["models.defaults.set"]({ cwd: root, thinkingLevel: "low" });
  assert.deepEqual(await handlers["models.defaults.get"]({ cwd: root }), {
    model: { provider: "openai", modelId: "gpt-4.1" },
    thinkingLevel: "low",
  });
  await handlers["models.defaults.set"]({ cwd: root, model: { provider: "openai", modelId: "gpt-4" } });
  assert.deepEqual(await handlers["models.defaults.get"]({ cwd: root }), {
    model: { provider: "openai", modelId: "gpt-4" },
    thinkingLevel: "low",
  });
});

test("an unavailable model, an unknown thinking level, or an empty change is refused and changes nothing", async () => {
  await handlers["models.defaults.set"]({
    cwd: root,
    model: { provider: "openai", modelId: "gpt-4.1" },
    thinkingLevel: "medium",
  });
  for (const params of [
    { cwd: root, model: { provider: "openai", modelId: "no-such-model" } },
    { cwd: root, model: { provider: "openai" } },
    { cwd: root, thinkingLevel: "auto" },
    { cwd: root, thinkingLevel: 3 },
    { cwd: root },
  ]) {
    await assert.rejects(handlers["models.defaults.set"](params), (error) => error.code === "BAD_REQUEST");
  }
  assert.deepEqual(await handlers["models.defaults.get"]({ cwd: root }), {
    model: { provider: "openai", modelId: "gpt-4.1" },
    thinkingLevel: "medium",
  });
});
