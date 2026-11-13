import { importTestBundle } from "#test-bundle";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
export const root = path.resolve(import.meta.dirname, "..", "..");
export const isolatedAgentDirectory = mkdtempSync(path.join(tmpdir(), "pi-handler-agent-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(isolatedAgentDirectory, "sessions");
process.env.PI_OFFLINE = "1";
test.after(() => rmSync(isolatedAgentDirectory, { recursive: true, force: true }));
let modulePromise;
const cleanups = [];
test.afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
export async function loadHandlersModule() {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    return importTestBundle(
      "src/agent-host/handlers",
      {
        packages: "external",
        absWorkingDir: root,
        entryPoints: ["src/agent-host/handlers.ts"],
      },
      { companions: { "model-catalog-worker.mjs": "src/agent-host/model-catalog/catalog-worker.ts" } },
    );
  })();
  return modulePromise;
}
export async function captureHandlers() {
  const { registerHandlers } = await loadHandlersModule();
  const handlers = {};
  const events = [];
  const cleanup = registerHandlers({
    handle(next) {
      Object.assign(handlers, next);
    },
    emit(topic, key, data) {
      events.push({ topic, key, data });
    },
  });
  cleanups.push(cleanup);
  return { handlers, events };
}
export async function waitFor(predicate, timeoutMs, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
