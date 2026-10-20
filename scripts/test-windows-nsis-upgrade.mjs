#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSuccessfulSpawn } from "./process-utils.mjs";
import { verifyUpdateConfiguration } from "./verify-update-configuration.mjs";
import {
  appExecutable,
  assertCleanUserInstallState,
  assertNoFilesLeft,
  compareVersions,
  fileVersion,
  firstInstall,
  install,
  regularFile,
  sha256,
  sleepSync,
  stopLockingHelper,
  uninstall,
  validateStartup,
  waitForInstalledHelperHello,
} from "./windows-nsis-harness.mjs";
import { validateUpgradeBaseline } from "./windows-upgrade-baseline.mjs";

if (process.platform !== "win32" || process.arch !== "x64") {
  console.log(JSON.stringify({ ok: true, skipped: "Windows x64 NSIS acceptance only" }));
  process.exit(0);
}

const [previousArgument, currentArgument, ...extra] = process.argv.slice(2);
if (
  !previousArgument ||
  !currentArgument ||
  extra.length > 1 ||
  extra.some((argument) => argument !== "--allow-same-version")
) {
  throw new Error(
    "Usage: test-windows-nsis-upgrade.mjs <previous-installer.exe> <current-installer.exe> [--allow-same-version]",
  );
}
const project = path.resolve(import.meta.dirname, "..");
const baseline = JSON.parse(fs.readFileSync(path.join(project, ".github/windows-upgrade-baseline.json"), "utf8"));
const previousVersion = baseline.version;
const currentVersion = JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8")).version;
const repository = process.env.GITHUB_REPOSITORY ?? "oDaiSuno/dexon";
const scenario = validateUpgradeBaseline(baseline, currentVersion, repository, extra.includes("--allow-same-version"));
const previousInstaller = regularFile(previousArgument);
const currentInstaller = regularFile(currentArgument);
assert.equal(sha256(previousInstaller), baseline.sha256, "Previous installer does not match the reviewed baseline");
assert.equal(compareVersions(fileVersion(previousInstaller), previousVersion), 0);
assert.equal(compareVersions(fileVersion(currentInstaller), currentVersion), 0);
assertCleanUserInstallState();

const root = fs.mkdtempSync(path.join(os.tmpdir(), "Pi NSIS upgrade 回滚 "));
const installPath = path.join(root, "Install Unicode 空格 With Spaces");
const isolated = path.join(root, "isolated-user");
fs.mkdirSync(isolated, { recursive: true });
const reports = [];
let installed = false;
let completed = false;

try {
  firstInstall(previousInstaller, installPath);
  installed = true;
  assert.equal(compareVersions(fileVersion(appExecutable(installPath)), previousVersion), 0);
  await verifyPreviousHelper(installPath);
  reports.push(validateStartup(appExecutable(installPath), isolated, previousVersion, "previous"));

  install(currentInstaller, installPath);
  assert.equal(compareVersions(fileVersion(appExecutable(installPath)), currentVersion), 0);
  const helper = await verifyInstalledHelper(installPath);
  verifyUpdateConfiguration(fs.readFileSync(path.join(installPath, "resources/app-update.yml"), "utf8"), repository);
  assertSuccessfulSpawn(
    spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        path.join(project, "scripts/verify-packaged-toolchains.mjs"),
        "win32-x64",
        installPath,
        "--release-helper",
      ],
      { cwd: project, stdio: "inherit", timeout: 240_000 },
    ),
    "Installed Windows package acceptance",
  );
  reports.push(validateStartup(appExecutable(installPath), isolated, currentVersion, "upgraded"));

  install(previousInstaller, installPath);
  assert.equal(compareVersions(fileVersion(appExecutable(installPath)), previousVersion), 0);
  await verifyPreviousHelper(installPath);
  reports.push(validateStartup(appExecutable(installPath), isolated, previousVersion, "rolled-back"));

  uninstall(installPath);
  installed = false;
  assertCleanUserInstallState(20_000);
  assertNoFilesLeft(installPath, 20_000);
  completed = true;
  console.log(
    JSON.stringify({
      ok: true,
      scenario,
      previousVersion,
      currentVersion,
      previousInstallerSha256: sha256(previousInstaller),
      currentInstallerSha256: sha256(currentInstaller),
      helper,
      reports,
      scenarios: [
        "previous packaged startup",
        scenario === "upgrade" ? "cross-version upgrade" : "same-version replacement",
        "direct rollback",
        "official uninstall",
      ],
    }),
  );
} finally {
  if (installed) {
    try {
      uninstall(installPath);
    } catch {
      // Preserve the primary failure; residue checks below still fail closed.
    }
  }
  if (completed) fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  else console.error(`[nsis-upgrade] retained failed fixture for inspection: ${root}`);
}

async function verifyPreviousHelper(directory) {
  if (baseline.helperSha256 === null) {
    assert.equal(
      fs.existsSync(path.join(directory, "resources", "managed-process")),
      false,
      "direct rollback must remove the newer helper directory for the historical no-helper baseline",
    );
  } else {
    const helper = await verifyInstalledHelper(directory);
    assert.equal(helper.sha256, baseline.helperSha256, "Previous helper must be restored exactly");
  }
}

async function verifyInstalledHelper(directory) {
  const helperRoot = path.join(directory, "resources", "managed-process", "win32-x64");
  const manifest = JSON.parse(fs.readFileSync(path.join(helperRoot, "manifest.json"), "utf8"));
  const executable = regularFile(path.join(helperRoot, "pi-managed-process-helper.exe"));
  assert.equal(sha256(executable), manifest.sha256);
  assert.equal(manifest.provenance, "release-authoritative");
  const selfTest = spawnSync(executable, ["--self-test-json-v1"], { encoding: "utf8", windowsHide: true });
  assert.equal(selfTest.status, 0);
  const result = JSON.parse(selfTest.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.buildId, manifest.buildId);
  const fileLock = await verifyInstalledHelperLock(executable);
  return { buildId: manifest.buildId, sha256: manifest.sha256, provenance: manifest.provenance, fileLock };
}

async function verifyInstalledHelperLock(executable) {
  const probe = `${executable}.replaceability-probe-${process.pid}`;
  const child = spawn(executable, ["--owner-stdio-v1"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  await once(child, "spawn");
  await waitForInstalledHelperHello(child);
  let runningRenameFailed = false;
  try {
    try {
      fs.renameSync(executable, probe);
    } catch {
      runningRenameFailed = true;
    }
    if (fs.existsSync(probe) && !fs.existsSync(executable)) fs.renameSync(probe, executable);
    assert.equal(runningRenameFailed, true, "running installed helper must prevent replacement");
  } finally {
    await stopLockingHelper({ child });
  }

  const deadline = Date.now() + 20_000;
  let replaceable = false;
  while (!replaceable && Date.now() <= deadline) {
    try {
      fs.renameSync(executable, probe);
      fs.renameSync(probe, executable);
      replaceable = true;
    } catch {
      if (fs.existsSync(probe) && !fs.existsSync(executable)) fs.renameSync(probe, executable);
      if (Date.now() < deadline) sleepSync(100);
    }
  }
  assert.equal(replaceable, true, "stopped installed helper must become replaceable");
  return { lockedWhileRunning: true, replaceableAfterExit: true };
}
