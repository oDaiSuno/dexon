#!/usr/bin/env node
/**
 * ISSUE-010: single quality gate that blocks pack/dist.
 * format → lint → typecheck → unit → contract → security → build → smoke
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { assertSuccessfulSpawn } from "./process-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length > 1 || args.some((argument) => argument !== "--skip-unit-tests")) {
  throw new Error("Usage: verify.mjs [--skip-unit-tests]");
}

function run(label, cmd, args) {
  console.log(`\n==> ${label}\n> ${cmd} ${args.join(" ")}\n`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  assertSuccessfulSpawn(r, `[verify] ${label}`);
}

run("format check", "npm", ["run", "format:check"]);
run("lint", "npm", ["run", "lint"]);
run("typecheck (main/host)", "npx", ["tsc", "--noEmit", "-p", "tsconfig.json"]);
run("typecheck (renderer)", "npx", ["tsc", "--noEmit", "-p", "tsconfig.renderer.json"]);
run("dependency contract", "node", ["scripts/check-dependency-contract.mjs"]);
run("architecture constraints", "node", ["scripts/check-architecture.mjs"]);
run("design constraints", "node", [
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "--experimental-strip-types",
  "scripts/check-design.mjs",
]);
if (!args.includes("--skip-unit-tests")) run("unit tests", "npm", ["test"]);
run("managed process development workflows", "npm", ["run", "test:managed-process-workflows"]);
run("managed process 60s flood", "npm", ["run", "test:managed-process-flood"]);
run("contract coverage", "node", ["scripts/check-contract-coverage.mjs"]);
run("Pi 0.84 compatibility", "node", ["scripts/check-pi-084-compatibility.mjs"]);
run("toolchain contract safety", "node", ["scripts/check-toolchain-contract.mjs"]);
run("toolchain catalog", "node", [
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
  "scripts/verify-toolchain-catalog.mjs",
]);
run("Browser i18n invariants", "npm", ["run", "check:browser-i18n"]);
run("desktop security invariants", "node", ["scripts/check-desktop-security.mjs"]);
run("desktop workflow invariants", "node", ["scripts/check-desktop-workflow.mjs"]);
run("test infrastructure invariants", "node", ["scripts/check-test-infra.mjs"]);
run("build", "npm", ["run", "build"]);
run("production artifact isolation", "node", ["scripts/check-production-artifacts.mjs"]);
run("smoke electron", "npm", ["run", "smoke"]);
run("Interactive tool cards Electron integration", "npm", ["run", "test:interactive-tools-electron"]);
run("Real chat layout and composer Electron integration", "npm", ["run", "test:chat-layout-electron"]);
run("Long history reading Electron integration", "npm", ["run", "test:chat-history-electron"]);
run("Composer editing Electron integration", "npm", ["run", "test:composer-editing-electron"]);
run("User bubble chips Electron integration", "npm", ["run", "test:user-bubble-electron"]);
run("Navigation layout and keyboard Electron integration", "npm", ["run", "test:nav-layout-electron"]);
run("Browser Electron integration", "npm", ["run", "test:browser-electron"]);
run("Browser real Agent E2E", "npm", ["run", "test:browser-agent-e2e"]);

console.log("\n[verify] all checks passed\n");
