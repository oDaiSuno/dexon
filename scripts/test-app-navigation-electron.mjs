#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { buildMain } from "./build-main.mjs";
import { nativeNavigationScenes } from "../tests/fixtures/app-navigation-native.mjs";
import { runElectronCheck } from "./electron-test-run.mjs";
import { assertSuccessfulSpawn, createProjectBuildTemp, resolvePackageFile } from "./process-utils.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0 && !process.argv[outIndex + 1]) throw new Error("--out requires an evidence directory");
const outputRoot = path.resolve(
  outIndex >= 0 ? process.argv[outIndex + 1] : path.join(root, ".artifacts/app-navigation-electron"),
);
const temporary = createProjectBuildTemp(root, "dexon-production-navigation-");
try {
  fs.mkdirSync(outputRoot, { recursive: true });
  // Keep every run's report, screenshots and diagnostics together, even on failure.
  // Never clear a user-supplied output directory or reuse an earlier run's artifacts.
  const output = fs.mkdtempSync(path.join(outputRoot, "run-"));
  console.log(`production-app-navigation: evidence directory: ${output}`);
  const evidence = path.join(output, "evidence.json");
  // Always build the shipped entry: the check must not use a stale build or
  // a renderer scene that assembles a second, test-owned application.
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
    entryPoints: ["tests/e2e/app-navigation.harness.mjs"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: path.join(temporary, "main.mjs"),
  });
  await runElectronCheck({
    name: "production-app-navigation",
    root,
    main: path.join(temporary, "main.mjs"),
    env: { DEXON_NAVIGATION_OUT: output },
    evidence,
    log: path.join(output, "main.log"),
    timeoutMs: 120000,
    requiredScenes: nativeNavigationScenes,
  });
  console.log(`production-app-navigation: all ${nativeNavigationScenes.length} scenes verified; evidence: ${output}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
