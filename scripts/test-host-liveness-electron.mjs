#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";
import { createProjectBuildTemp } from "./process-utils.mjs";
import { runElectronCheck } from "./electron-test-run.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = createProjectBuildTemp(root, "dexon-host-liveness-build-");
const main = path.join(temp, "host-liveness-harness.cjs");

const scenes = [
  "slow-start-11s-stays-ready",
  "slow-start-20s-stays-ready",
  "hung-host-is-restarted-within-30s",
  "windows-crash-without-cleanup-helper-recovers",
  "leftover-record-blocks-restart-and-retry",
  "damaged-journal-blocks-restart",
  "retry-restarts-crashed-host",
];

try {
  buildSync({
    absWorkingDir: root,
    entryPoints: ["src/smoke/host-liveness-harness.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    external: ["electron"],
    outfile: main,
    logLevel: "info",
  });
  await runElectronCheck({
    name: "host-liveness",
    root,
    main,
    evidence: path.join(root, ".artifacts/host-liveness-electron/evidence.json"),
    log: path.join(root, ".artifacts/host-liveness-electron/main.log"),
    requiredScenes: scenes,
    timeoutMs: 150_000,
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
