import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { buildMain } from "./build-main.mjs";
import { runElectronCheck } from "./electron-test-run.mjs";
import { assertSuccessfulSpawn, createProjectBuildTemp, resolvePackageFile } from "./process-utils.mjs";
import { remoteSettingsScenes } from "../tests/fixtures/remote-settings-native.mjs";

const root = path.resolve(import.meta.dirname, "..");
const argumentsList = process.argv.slice(2);
if (argumentsList.some((value, index) => value !== "--out" && argumentsList[index - 1] !== "--out")) {
  throw new Error("Usage: node scripts/test-remote-settings-electron.mjs [--out <evidence-directory>]");
}
const outIndex = argumentsList.indexOf("--out");
if (outIndex >= 0 && !argumentsList[outIndex + 1]) throw new Error("--out requires an evidence directory");
if (Object.hasOwn(process.env, "PI_DESKTOP_USER_DATA")) {
  throw new Error("Run with env -u PI_DESKTOP_USER_DATA to protect the real desktop data");
}
const outputRoot = path.resolve(
  outIndex >= 0 ? argumentsList[outIndex + 1] : path.join(root, ".artifacts/remote-settings-electron"),
);
const temporary = createProjectBuildTemp(root, "dexon-production-remote-settings-");
try {
  fs.mkdirSync(outputRoot, { recursive: true });
  const output = fs.mkdtempSync(path.join(outputRoot, "run-"));
  console.log(`production-remote-settings: evidence directory: ${output}`);
  buildMain(root);
  assertSuccessfulSpawn(
    spawnSync(process.execPath, [resolvePackageFile(root, "vite", "bin/vite.js"), "build"], {
      cwd: root,
      stdio: "inherit",
      timeout: 120000,
    }),
    "production renderer build",
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  await build({
    absWorkingDir: root,
    entryPoints: ["src/agent-host/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    legalComments: "none",
    outfile: path.join(root, "out/agent-host/index.mjs"),
    define: {
      "process.env.PI_DESKTOP_EXPECTED_PI_VERSION": JSON.stringify(
        packageJson.dependencies["@earendil-works/pi-coding-agent"],
      ),
    },
  });
  await build({
    absWorkingDir: root,
    entryPoints: ["tests/e2e/remote-settings.harness.mjs"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    legalComments: "none",
    outfile: path.join(temporary, "main.mjs"),
  });
  await runElectronCheck({
    name: "production-remote-settings",
    root,
    main: path.join(temporary, "main.mjs"),
    env: {
      DEXON_REMOTE_SETTINGS_OUT: output,
      DEXON_REMOTE_SETTINGS_NODE: process.execPath,
      DEXON_REMOTE_SETTINGS_NODE_VERSION: process.versions.node,
    },
    evidence: path.join(output, "evidence.json"),
    log: path.join(output, "main.log"),
    timeoutMs: 240000,
    requiredScenes: remoteSettingsScenes,
  });
  console.log(`production-remote-settings: all ${remoteSettingsScenes.length} scenes verified; evidence: ${output}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
