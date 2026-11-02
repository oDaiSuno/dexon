import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const { createManagedProcessToolDefinitions, ManagedProcessService, setBrowserSessionSource } = await importTestBundle(
  "managed-process-tools-behavior",
  {
    packages: "external",
    stdin: {
      contents:
        'export {createManagedProcessToolDefinitions} from "./src/agent-host/managed-process/tools.ts"; export {ManagedProcessService} from "./src/agent-host/managed-process/service.ts"; export {setBrowserSessionSource} from "./src/agent-host/browser-tools.ts";',
      resolveDir: root,
      loader: "ts",
    },
  },
);

test("all managed process tools declare coding ownership and a concise prompt snippet", () => {
  const service = new ManagedProcessService({ emit() {} });
  const tools = createManagedProcessToolDefinitions("/tmp", true, service);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "process_start",
      "process_list",
      "process_read",
      "process_wait",
      "process_write",
      "process_stop",
      "process_restart",
    ],
  );
  for (const tool of tools) {
    assert.equal(tool.dexonOwner, "coding", tool.name);
    assert.equal(tool.exposure, "direct", tool.name);
    assert.equal(tool.defaultActive, true, tool.name);
    assert.equal(typeof tool.promptSnippet, "string", tool.name);
    assert.ok(tool.promptSnippet.trim().length > 0 && tool.promptSnippet.length <= 120, tool.name);
    assert.doesNotMatch(tool.promptSnippet, /[\r\n]/u, tool.name);
  }
});

test("managed process tools activate only with a non-empty local tool selection", async () => {
  const { withExtensionTools } = await importTestBundle("src/agent-host/rpc-manager", {
    packages: "external",
    absWorkingDir: root,
    entryPoints: ["src/agent-host/rpc-manager.ts"],
  });
  const session = {
    getAllTools() {
      return [
        { name: "read" },
        { name: "browser_open" },
        { name: "process_start" },
        { name: "process_stop" },
        { name: "extension_tool" },
      ];
    },
  };
  assert.deepEqual(withExtensionTools(session, []), []);
  assert.deepEqual(withExtensionTools(session, ["read"]), ["read", "process_start", "process_stop", "extension_tool"]);
});

test("managed process tools reject a real messaging-channel context without creating a process", async () => {
  const service = new ManagedProcessService({ emit() {} });
  const sessionManager = SessionManager.inMemory("/tmp");
  setBrowserSessionSource(sessionManager, "channel");
  const tools = createManagedProcessToolDefinitions("/tmp", true, service);
  for (const tool of tools) {
    await assert.rejects(
      tool.execute("channel-turn", {}, undefined, undefined, { sessionManager }),
      /PROCESS_FEATURE_DISABLED.*messaging-channel/,
    );
  }
  assert.deepEqual(service.list(true).processes, []);
});

test("the public tool schema accepts a 256-character literal wait and rejects a longer one", () => {
  const service = new ManagedProcessService({ emit() {} });
  const tools = createManagedProcessToolDefinitions("/tmp", true, service);
  const wait = tools.find((tool) => tool.name === "process_wait");
  assert.equal(Value.Check(wait.parameters, { processId: "process-one", contains: "x".repeat(256) }), true);
  assert.equal(Value.Check(wait.parameters, { processId: "process-one", contains: "x".repeat(257) }), false);
});
