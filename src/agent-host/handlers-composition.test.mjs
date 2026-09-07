import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const isolatedAgentDirectory = mkdtempSync(path.join(tmpdir(), "dexon-composition-agent-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(isolatedAgentDirectory, "sessions");
process.env.PI_OFFLINE = "1";
test.after(() => rmSync(isolatedAgentDirectory, { recursive: true, force: true }));

// Recording stubs for the five services whose teardown the composition root
// must aggregate. Replacing whole modules keeps handler bodies untouched and
// makes the cleanup trail observable via a global channel (stub code is
// evaluated inside the bundle and cannot close over test variables).
globalThis.__compositionCleanupTrail = [];

const serviceStubs = {
  "file-watch": `
    export function createFileWatchService() {
      return { async start() { return () => {}; }, stop() {} };
    }
    export function stopAllFileWatches() {
      globalThis.__compositionCleanupTrail.push("files.stopAllFileWatches");
    }
  `,
  "managed-process/runtime": `
    const service = {
      async stopAll(mode) { globalThis.__compositionCleanupTrail.push(\`processes.stopAll(\${mode})\`); return []; },
      async list() { return []; },
      get() {},
      async read() { return {}; },
      async wait() { return {}; },
      async write() { return {}; },
      async stop() { return {}; },
      async restart() { return {}; },
      dismiss() {},
      async exportLogs() { return {}; },
      activeForSession() { return []; },
      activeWithinCwd() { return []; },
    };
    export function initializeManagedProcessService() {
      return service;
    }
    export function getManagedProcessService() {
      return service;
    }
    export function peekManagedProcessService() {
      return service;
    }
  `,
  "channels/channel-manager": `
    export class ChannelManager {
      constructor() {}
      async initialize() {}
      async shutdown() { globalThis.__compositionCleanupTrail.push("channels.shutdown"); }
      snapshot() { return {}; }
      upsertAccount() { return {}; }
      async connectAccount() { return {}; }
      async deleteAccount() { return {}; }
      async startAccount() { return {}; }
      async stopAccount() { return {}; }
      async restartAccount() { return {}; }
      async probe() { return {}; }
      startLogin() { return {}; }
      waitLogin() { return {}; }
      submitLoginCode() {}
      cancelLogin() {}
      approvePairing() { return {}; }
      rejectPairing() { return {}; }
      upsertBinding() { return {}; }
      deleteBinding() { return {}; }
      testSend() { return {}; }
    }
  `,
  "channels/redaction": `
    export function safeChannelError() { return ""; }
  `,
  "model-runtime": `
    export const modelCatalogRefreshCoordinator = {
      refresh() { throw new Error("not used in composition test"); },
      cancel() { return false; },
      cancelAll() { globalThis.__compositionCleanupTrail.push("models.cancelAll"); },
    };
    export async function getSharedModelRuntime() {
      throw new Error("not used in composition test");
    }
    export async function reloadSharedModelRuntimeConfig() {}
    export async function resolveSessionContextWindow() { return null; }
  `,
  "rpc-manager": `
    export async function disposeAllRpcSessions() {
      globalThis.__compositionCleanupTrail.push("sessions.disposeAllRpcSessions");
    }
    export function getRpcSession() { return undefined; }
    export function getRunningRpcSessionIds() { return []; }
    export async function startRpcSession() {
      throw new Error("not used in composition test");
    }
    export function subscribeRunningSessions() {}
  `,
};

const { registerHandlers } = await importTestBundle("src/agent-host/handlers-composition", {
  stdin: {
    contents: `export { registerHandlers } from "./src/agent-host/handlers.ts";`,
    resolveDir: root,
    sourcefile: "composition-test-entry.ts",
    loader: "ts",
  },
  packages: "external",
  absWorkingDir: root,
  plugins: [
    {
      name: "composition-service-stubs",
      setup(builder) {
        // Import specifiers reaching these modules vary by importer depth
        // ("./file-watch" from agent-host, "../file-watch" from handlers/).
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.path.includes("node_modules") || args.path.endsWith(".ts") || args.path.endsWith(".mjs")) {
            return null;
          }
          const normalized = args.path.replace(/^(\.\/|\.\.\/)+/, "");
          if (normalized in serviceStubs) return { path: normalized, namespace: "composition-stubs" };
          return null;
        });
        builder.onLoad({ filter: /.*/, namespace: "composition-stubs" }, (args) => ({
          contents: serviceStubs[args.path],
          loader: "js",
          resolveDir: root,
        }));
      },
    },
  ],
});

test("every contract method is registered exactly once through split registrars", () => {
  const registrationOrder = [];
  registerHandlers({
    handle(next) {
      registrationOrder.push(...Object.keys(next));
    },
    emit() {},
  });

  const counts = new Map();
  for (const method of registrationOrder) counts.set(method, (counts.get(method) ?? 0) + 1);

  assert.equal(registrationOrder.length, 81);
  assert.equal(counts.size, 81);
  for (const [method, count] of counts) {
    assert.equal(count, 1, `${method} must be registered exactly once`);
  }
});

test("the composition root runs all five host cleanups in the original order", async () => {
  const cleanupTrail = (globalThis.__compositionCleanupTrail = []);
  const cleanup = registerHandlers({
    handle() {},
    emit() {},
  });
  assert.equal(typeof cleanup, "function");

  await cleanup();

  assert.deepEqual(cleanupTrail, [
    "models.cancelAll",
    "processes.stopAll(host)",
    "channels.shutdown",
    "files.stopAllFileWatches",
    "sessions.disposeAllRpcSessions",
  ]);
});
