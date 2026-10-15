#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createProjectBuildTemp, projectNodePath } from "./process-utils.mjs";
import { runElectronCheck } from "./electron-test-run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = createProjectBuildTemp(root, "pi-browser-agent-e2e-build-");
const hostOutfile = path.join(temp, "browser-agent-host.mjs");
const managedWorkerOutfile = path.join(temp, "managed-process-worker.mjs");
const mainOutfile = path.join(temp, "browser-agent-e2e-harness.cjs");
const runtimeRoot = path.join(temp, "runtime");
fs.mkdirSync(runtimeRoot, { recursive: true });

function build(entry, outfile, format, externals) {
  buildSync({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    packages: "external",
    format,
    external: externals,
    outfile,
    logLevel: "info",
  });
}

try {
  build("src/smoke/browser-agent-host.ts", hostOutfile, "esm", [
    "electron",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "silk-wasm",
  ]);
  build("src/agent-host/managed-process/worker.ts", managedWorkerOutfile, "esm", []);
  build("src/smoke/browser-agent-e2e-harness.ts", mainOutfile, "cjs", ["electron"]);

  await runElectronCheck({
    name: "browser-agent-e2e",
    root,
    main: mainOutfile,
    evidence: path.join(root, ".artifacts/browser-agent-e2e/evidence.json"),
    env: {
      NODE_PATH: projectNodePath(root, process.env.NODE_PATH),
      PI_BROWSER_AGENT_E2E_HOST_ENTRY: hostOutfile,
      PI_BROWSER_AGENT_E2E_ROOT: runtimeRoot,
    },
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
