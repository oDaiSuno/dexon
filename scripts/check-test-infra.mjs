#!/usr/bin/env node
// Observe the actual Electron/SDK paths. Source spelling cannot prove isolation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { assertSmokeCompletion } from "../src/smoke/result.ts";
import { createElectronTestEnvironment } from "./electron-test-environment.mjs";
import { createProjectBuildTemp, resolveElectronBinary, terminateProcessTree } from "./process-utils.mjs";

const root = path.resolve(import.meta.dirname, "..");
const directory = createProjectBuildTemp(root, "dexon-infra-probe-");
const sandbox = createElectronTestEnvironment();
const output = path.join(root, ".artifacts/test-infra");
let watchdog;
try {
  const main = path.join(directory, "main.mjs");
  await build({
    absWorkingDir: root,
    entryPoints: ["src/smoke/environment-probe.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: main,
  });
  const child = spawn(resolveElectronBinary(root), [main], {
    cwd: root,
    env: sandbox.env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  const exit = await new Promise((resolve, reject) => {
    watchdog = setTimeout(() => terminateProcessTree(child, { signal: "SIGKILL" }), 20_000);
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, pid: child.pid }));
  });
  const result = path.join(sandbox.env.PI_DESKTOP_SMOKE_USER_DATA, "environment-result.json");
  const report = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result, "utf8")) : null;
  assertSmokeCompletion(exit, report);
  assert.equal(report.configuredBeforeReady, true, "the platform was configured before Electron became ready");
  for (const [name, value] of Object.entries(report.paths)) {
    const relative = path.relative(fs.realpathSync(sandbox.directory), fs.realpathSync(value));
    assert.ok(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
      `${name} escaped its temporary environment: ${value}`,
    );
  }
  sandbox.dispose();
  assert.equal(fs.existsSync(sandbox.directory), false, "the run leaves no profile, home, Agent or sessions behind");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, "evidence.json"),
    JSON.stringify({ ...report, pass: true, removed: true }, null, 2),
  );
  console.log(
    "OK: real Electron home, profile, session storage, Agent, sessions, logs and temp stay isolated and are removed",
  );
} finally {
  clearTimeout(watchdog);
  try {
    sandbox.dispose();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
