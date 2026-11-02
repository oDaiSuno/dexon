#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetVersion = "1.4.0";
const directPackages = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-telemetry"];
const runtimePackages = [
  "pi-ai",
  "pi-agent-core",
  "pi-coding-agent",
  "pi-codemode",
  "pi-mcp",
  "pi-telemetry",
  "pi-tui",
];

function fail(message) {
  console.error(`[pi-140-compat] ${message}`);
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

const packageJson = readJson("package.json");
const lockfile = readJson("package-lock.json");
for (const packageName of directPackages) {
  if (packageJson.dependencies?.[packageName] !== targetVersion) {
    fail(`${packageName} must be pinned exactly to ${targetVersion}`);
  }
  if (lockfile.packages?.[""]?.dependencies?.[packageName] !== targetVersion) {
    fail(`lockfile root dependency ${packageName} must be ${targetVersion}`);
  }
  const installed = readJson(`node_modules/${packageName}/package.json`).version;
  if (installed !== targetVersion) fail(`installed ${packageName} is ${installed}, expected ${targetVersion}`);
}
if (packageJson.overrides?.["@earendil-works/pi-telemetry"] !== targetVersion) {
  fail(`@earendil-works/pi-telemetry override must be ${targetVersion}`);
}
if (packageJson.dependencies?.["@earendil-works/pi-telemetry"] !== targetVersion) {
  fail(`@earendil-works/pi-telemetry must be an exact root dependency at ${targetVersion}`);
}
const telemetryLocks = Object.entries(lockfile.packages ?? {}).filter(([packagePath]) =>
  packagePath.endsWith("node_modules/@earendil-works/pi-telemetry"),
);
if (telemetryLocks.length === 0 || telemetryLocks.some(([, entry]) => entry.version !== targetVersion)) {
  fail(`every locked @earendil-works/pi-telemetry instance must be ${targetVersion}`);
}
if (lockfile.packages?.["node_modules/@earendil-works/pi-telemetry"]?.version !== targetVersion) {
  fail(`the root @earendil-works/pi-telemetry lock entry must be ${targetVersion}`);
}

for (const name of runtimePackages) {
  const packagePath = `node_modules/@earendil-works/${name}`;
  if (
    lockfile.packages?.[packagePath]?.version !== targetVersion ||
    readJson(`${packagePath}/package.json`).version !== targetVersion
  ) {
    fail(`${name} must resolve to ${targetVersion} in the lockfile and installation`);
  }
}
if (
  packageJson.dependencies?.typebox !== "1.3.27" ||
  lockfile.packages?.["node_modules/typebox"]?.version !== "1.3.27"
) {
  fail("typebox must be an exact root dependency at 1.3.27");
}
for (const asset of [
  "node_modules/quickjs-wasi/quickjs.wasm",
  "node_modules/@earendil-works/pi-tui/native/darwin/prebuilds/darwin-arm64/darwin-platform.node",
  "node_modules/@earendil-works/pi-tui/native/darwin/prebuilds/darwin-x64/darwin-platform.node",
  "node_modules/@earendil-works/pi-tui/native/win32/prebuilds/win32-x64/win32-platform.node",
  "node_modules/@earendil-works/pi-tui/native/linux/prebuilds/linux-x64/linux-platform-x11.node",
]) {
  if (!existsSync(path.join(root, asset))) fail(`installed Pi runtime asset is missing: ${asset}`);
}
if (existsSync(path.join(root, "src/agent-host/agent-session/tool-activation.ts"))) {
  fail("legacy eager tool activation must be removed");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [absolute] : [];
  });
}

const forbidden = [
  ["removed ModelRuntime.reloadConfig", /\.reloadConfig\s*\(/],
  ["removed ModelsStreamTransforms", /\bModelsStreamTransforms\b/],
  ["removed TypeBox helper", /\bType\.(?:Base|Awaited|Promise|AsyncIterator|Iterator|Options)\s*\(/],
  ["removed Value.Mutate", /\bValue\.Mutate\s*\(/],
  ["legacy extension context.store", /\bcontext\.store\b/],
  [
    "legacy tool activation fan-out",
    /\b(?:withExtensionTools|syncBrowserToolsForAllSessions|syncSessionToolsForAllSessions)\b/,
  ],
  ["direct transcript-derived prompt mutation", /\b(?:agent\.state|state)\??\.systemPrompt\s*=(?!=)/],
  ["direct transcript-derived message mutation", /\b(?:agent\.state|state)\??\.messages\s*=(?!=)/],
];
for (const file of [
  ...sourceFiles(path.join(root, "src")),
  path.join(root, "vite.config.ts"),
  path.join(root, "tsup.config.ts"),
]) {
  const source = readFileSync(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) fail(`${label} found in ${path.relative(root, file)}`);
  }
  if (/0\.80\.(?:0|10)/.test(source)) fail(`stale Pi version fallback found in ${path.relative(root, file)}`);
}

const requiredMarkers = [
  ["src/agent-host/model-runtime.ts", "allowNetwork: true"],
  ["src/agent-host/model-runtime.ts", "allowNetwork: false"],
  ["src/contract/api.ts", '"models.refresh"'],
  ["src/contract/api.ts", '"models.refreshCancel"'],
  ["src/agent-host/credential-sync.ts", "recoverCommittedCredential"],
  ["src/renderer/lib/models-config-state.ts", "samplingParams"],
  ["src/agent-host/rpc-manager.ts", "services.diagnostics"],
];
for (const [relativePath, marker] of requiredMarkers) {
  if (!readFileSync(path.join(root, relativePath), "utf8").includes(marker)) {
    fail(`${relativePath} is missing required marker ${JSON.stringify(marker)}`);
  }
}

console.log(
  `[pi-140-compat] exact dependencies, removed APIs, model refresh, credential/config, and extension diagnostics passed (${targetVersion})`,
);
