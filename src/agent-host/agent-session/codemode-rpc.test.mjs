import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { importTestBundle } from "#test-bundle";

const base = await mkdtemp(path.join(tmpdir(), "dexon-codemode-rpc-"));
const previous = new Map(
  ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_OFFLINE"].map((key) => [key, process.env[key]]),
);
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
process.env.PI_OFFLINE = "1";
const runtime = await importTestBundle(
  "codemode-rpc",
  {
    packages: "external",
    stdin: {
      contents: `export { startRpcSession, disposeAllRpcSessions } from "./src/agent-host/rpc-manager";
      export { writeCodemodeSettings } from "./src/agent-host/codemode-settings";
      export { setStandaloneMainRequestHandler } from "./src/agent-host/parent-rpc";`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
  },
  { companions: { "model-catalog-worker.mjs": "src/agent-host/model-catalog/catalog-worker.ts" } },
);

test.after(async () => {
  await runtime.disposeAllRpcSessions();
  runtime.setStandaloneMainRequestHandler(null);
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(base, { recursive: true, force: true });
});

test("an interactive RPC session runs a real sandbox call and reloads Code Mode settings before later runs", async () => {
  const cwd = path.join(base, "project");
  await mkdir(cwd, { recursive: true });
  await writeFile(path.join(cwd, "note.txt"), "sandbox fixture");
  runtime.setStandaloneMainRequestHandler(async (method, params) => {
    if (method === "toolchain.getSnapshot")
      return {
        revision: 1,
        defaults: {},
        candidates: [],
        platform: process.platform,
        arch: process.arch,
        publicState: {},
      };
    if (method === "toolchain.resolve")
      return {
        id: "fixture",
        inventoryRevision: 1,
        workspaceKey: params.cwd,
        requirementsHash: "fixture",
        commands: {},
        summary: [],
      };
    throw new Error(`Unexpected main request: ${method}`);
  });
  const { session: wrapper } = await runtime.startRpcSession("codemode-fixture", "", cwd, ["read"]);
  const faux = fauxProvider();
  wrapper.inner.modelRuntime.registerNativeProvider(faux.provider);
  await wrapper.inner.setModel(faux.getModel());
  const results = [];
  wrapper.onEvent((event) => {
    if (event.type === "tool_execution_end" && event.toolName === "codemode") results.push(event);
  });
  faux.setResponses([
    (context) => {
      assert.ok(getCurrentTools(context.messages).some((tool) => tool.name === "codemode"));
      return fauxAssistantMessage(
        [fauxToolCall("codemode", { code: 'return await tools.read({path: "note.txt"});' })],
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage([fauxText("已读取")]),
  ]);
  const first = await wrapper.runExternalTurn({ runId: "sandbox", message: "Read fixture", channel: "telegram" });
  assert.equal(first.finalText, "已读取");
  assert.equal(results.length, 1);
  assert.equal(results[0].isError, false);
  assert.equal(results[0].result.details.calls[0].name, "read");
  assert.equal(results[0].result.details.calls[0].status, "ok");
  assert.match(JSON.stringify(results[0].result.content), /sandbox fixture/);

  await runtime.writeCodemodeSettings({ enabled: false, cwd });
  assert.equal(wrapper.runPolicy.view().tools.find((tool) => tool.name === "codemode").active, false);
  faux.setResponses([
    (context) => {
      assert.deepEqual(
        getCurrentTools(context.messages).map((tool) => tool.name),
        ["read"],
      );
      return fauxAssistantMessage([fauxText("关闭后仍可读取")]);
    },
  ]);
  await wrapper.runExternalTurn({ runId: "disabled", message: "Continue", channel: "telegram" });

  await runtime.writeCodemodeSettings({ enabled: true, mode: "only", cwd });
  faux.setResponses([
    (context) => {
      assert.deepEqual(
        getCurrentTools(context.messages).map((tool) => tool.name),
        ["codemode"],
      );
      return fauxAssistantMessage([fauxText("仅脚本模式")]);
    },
  ]);
  await wrapper.runExternalTurn({ runId: "only", message: "Continue", channel: "telegram" });
});
