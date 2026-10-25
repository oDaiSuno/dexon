import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const isolatedAgentDirectory = mkdtempSync(path.join(tmpdir(), "dexon-provider-channels-agent-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(isolatedAgentDirectory, "sessions");
process.env.PI_OFFLINE = "1";
delete process.env.PI_DESKTOP_USER_DATA;

const requests = [];
const healthyServer = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish) =>
      response.write(
        `data: ${JSON.stringify({
          id: "probe",
          object: "chat.completion.chunk",
          created: 1,
          model: "acme-chat",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );
    chunk({ role: "assistant", content: "OK" }, null);
    chunk({}, "stop");
    response.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => healthyServer.listen(0, "127.0.0.1", resolve));
const closedServer = createServer();
await new Promise((resolve) => closedServer.listen(0, "127.0.0.1", resolve));
const closedPort = closedServer.address().port;
await new Promise((resolve) => closedServer.close(resolve));

const modelsConfig = {
  providers: {
    acme: {
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${healthyServer.address().port}/v1`,
      apiKey: "sk-acme",
      models: [{ id: "acme-chat" }],
    },
    broken: {
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${closedPort}/v1`,
      apiKey: "sk-broken",
      models: [{ id: "broken-chat" }],
    },
  },
};
writeFileSync(path.join(isolatedAgentDirectory, "models.json"), JSON.stringify(modelsConfig, null, 2));

test.after(async () => {
  await new Promise((resolve) => healthyServer.close(resolve));
  rmSync(isolatedAgentDirectory, { recursive: true, force: true });
});

async function loadHandlers(name) {
  const bundle = await importTestBundle(`src/agent-host/handlers/${name}`, {
    packages: "external",
    absWorkingDir: root,
    entryPoints: ["src/agent-host/handlers.ts"],
  });
  const handlers = {};
  bundle.registerHandlers({
    handle(next) {
      Object.assign(handlers, next);
    },
    emit() {},
  });
  return handlers;
}

const handlers = await loadHandlers("provider-channels-first");
const listedModelIds = async () => (await handlers["models.list"]({ cwd: root })).models.map((model) => model.id);

test("a channel nobody has touched is reported as enabled with no test result", async () => {
  assert.deepEqual(await handlers["modelsConfig.channels.get"](), { channels: {} });
});

test("turning a channel off keeps its settings, hides its models from the model picker, and is still off after a restart", async () => {
  assert.ok((await listedModelIds()).includes("acme-chat"), "the channel's model is offered before it is turned off");

  const saved = await handlers["modelsConfig.channels.setEnabled"]({ provider: "acme", enabled: false });
  assert.deepEqual(saved.channels.acme, { enabled: false, lastTest: null });

  assert.deepEqual((await handlers["modelsConfig.get"]()).config, modelsConfig, "its settings are kept as they were");
  assert.ok(!(await listedModelIds()).includes("acme-chat"), "its model is no longer offered");
  assert.ok((await listedModelIds()).includes("broken-chat"), "other channels keep their models");

  const restarted = await loadHandlers("provider-channels-restarted");
  assert.equal((await restarted["modelsConfig.channels.get"]()).channels.acme.enabled, false);

  await handlers["modelsConfig.channels.setEnabled"]({ provider: "acme", enabled: true });
  assert.ok((await listedModelIds()).includes("acme-chat"), "turning it back on offers its model again");
});

test("testing a channel reaches its server, reports how long it took, and remembers the result", async () => {
  const before = Date.now();
  const result = await handlers["modelsConfig.channels.test"]({ provider: "acme" });
  assert.equal(result.ok, true);
  assert.equal(typeof result.latencyMs, "number");
  assert.ok(result.latencyMs >= 0);
  const testedAt = Date.parse(result.testedAt);
  assert.ok(testedAt >= before - 1000 && testedAt <= Date.now() + 1000, "the result is stamped with when it ran");
  assert.ok(requests.includes("POST /v1/chat/completions"), "the channel's own server was contacted");

  const restarted = await loadHandlers("provider-channels-after-test");
  assert.deepEqual((await restarted["modelsConfig.channels.get"]()).channels.acme.lastTest, result);
});

test("a channel that cannot be reached is remembered as failed together with the reason", async () => {
  const result = await handlers["modelsConfig.channels.test"]({ provider: "broken" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "error");
  assert.equal(typeof result.error, "string");
  assert.ok(result.error.length > 0, "the reason is not empty");
  assert.deepEqual((await handlers["modelsConfig.channels.get"]()).channels.broken, {
    enabled: true,
    lastTest: result,
  });
});

test("an unknown channel or a malformed request is refused and nothing is recorded", async () => {
  const before = await handlers["modelsConfig.channels.get"]();
  await assert.rejects(
    handlers["modelsConfig.channels.setEnabled"]({ provider: "nobody", enabled: false }),
    (error) => error.code === "BAD_REQUEST",
  );
  await assert.rejects(
    handlers["modelsConfig.channels.setEnabled"]({ provider: "acme", enabled: "no" }),
    (error) => error.code === "BAD_REQUEST",
  );
  await assert.rejects(
    handlers["modelsConfig.channels.test"]({ provider: "nobody" }),
    (error) => error.code === "BAD_REQUEST",
  );
  assert.deepEqual(await handlers["modelsConfig.channels.get"](), before);
});
