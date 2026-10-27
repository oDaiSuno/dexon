#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { build } from "esbuild";
import { buildMain } from "./build-main.mjs";
import { createElectronTestEnvironment } from "./electron-test-environment.mjs";
import {
  assertSuccessfulSpawn,
  createProjectBuildTemp,
  resolveElectronBinary,
  resolvePackageFile,
  terminateProcessTree,
} from "./process-utils.mjs";
import { assertSmokeCompletion } from "../src/smoke/result.ts";

const firstScenes = [
  "01-default-space-created",
  "02-folders-joined",
  "03-drag-reorder",
  "04-drag-cancelled",
  "05-drag-above-default-refused",
];
const secondScenes = [
  "06-order-survived-restart",
  "07-missing-folder-greyed",
  "08-missing-folder-closed",
  "09-closed-after-restart",
];

const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0 && !process.argv[outIndex + 1]) throw new Error("--out requires an evidence directory");
const outputRoot = path.resolve(
  outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/project-list-electron"),
);
fs.mkdirSync(outputRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(outputRoot, "run-"));
console.log(`project-list-electron: evidence directory: ${output}`);
const temporary = createProjectBuildTemp(root, "dexon-project-list-");
const main = path.join(temporary, "main.mjs");
const sandbox = createElectronTestEnvironment();

async function launch(phase, requiredScenes) {
  const resultPath = path.join(output, `${phase}.json`);
  const child = spawn(resolveElectronBinary(root), [main], {
    cwd: root,
    stdio: "inherit",
    detached: process.platform !== "win32",
    env: {
      ...sandbox.env,
      DEXON_PROJECT_LIST_OUT: output,
      DEXON_PROJECT_LIST_PHASE: phase,
      DEXON_ELECTRON_RESULT: resultPath,
    },
  });
  let timer;
  let timedOut = false;
  try {
    const exit = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child, { signal: "SIGKILL" });
      }, 120000);
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, pid: child.pid }));
    });
    if (timedOut) throw new Error(`${phase} exceeded its deadline`);
    const completion = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null;
    assertSmokeCompletion(exit, completion, requiredScenes);
  } finally {
    clearTimeout(timer);
  }
}

try {
  buildMain(root);
  assertSuccessfulSpawn(
    spawnSync(process.execPath, [resolvePackageFile(root, "vite", "bin/vite.js"), "build"], {
      cwd: root,
      stdio: "inherit",
    }),
    "production renderer build",
  );
  await build({
    absWorkingDir: root,
    entryPoints: ["tests/e2e/project-list.harness.mjs"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: main,
  });
  await launch("first", firstScenes);
  await launch("second", secondScenes);
  console.log(`project-list-electron: all scenes verified; evidence: ${output}`);
} finally {
  sandbox.dispose();
  fs.rmSync(temporary, { recursive: true, force: true });
}
