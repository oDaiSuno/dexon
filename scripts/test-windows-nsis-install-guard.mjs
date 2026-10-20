#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { firstInstall, refusedFreshInstall } from "./windows-nsis-first-install.mjs";
import {
  appExecutable,
  assertCleanUserInstallState,
  assertDirectoryRemoved,
  assertUserFilesKept,
  compareVersions,
  fileVersion,
  install,
  installExpectingStatus,
  readInstalledVersion,
  regularFile,
  runInstallerWith,
  seedUserFiles,
  sha256,
  sleepSync,
  snapshotFiles,
  startLockingHelper,
  stopLockingHelper,
  uninstall,
  walkFiles,
} from "./windows-nsis-harness.mjs";
import { runNsisScenario } from "./windows-nsis-scenarios.mjs";

if (process.platform !== "win32" || process.arch !== "x64") {
  console.log(JSON.stringify({ ok: true, skipped: "Windows x64 NSIS acceptance only" }));
  process.exit(0);
}

const [previousArgument, currentArgument, ...extra] = process.argv.slice(2);
if (!previousArgument || !currentArgument || extra.length > 0) {
  throw new Error("Usage: test-windows-nsis-install-guard.mjs <previous-installer.exe> <current-installer.exe>");
}
const project = path.resolve(import.meta.dirname, "..");
const baseline = JSON.parse(fs.readFileSync(path.join(project, ".github/windows-upgrade-baseline.json"), "utf8"));
const previousVersion = baseline.version;
const previousInstaller = regularFile(previousArgument);
const currentInstaller = regularFile(currentArgument);
assert.equal(sha256(previousInstaller), baseline.sha256, "Previous installer does not match the reviewed baseline");
assertCleanUserInstallState();

const label = "nsis-install-guard";
const HELPER_RELATIVE = "resources/managed-process/win32-x64/pi-managed-process-helper.exe";
const results = [];

results.push(
  await runNsisScenario({
    label,
    slug: "guard refusal",
    name: "when a silent install targets a folder that already holds other files, it stops with code 2 and touches nothing",
    body: async ({ root }) => {
      const variants = [];
      for (const extraArguments of [[], ["--updated"]]) {
        for (const name of ["Notes", "Dexon项目"]) {
          const directory = path.join(root, name);
          fs.mkdirSync(path.join(directory, "nested"), { recursive: true });
          fs.writeFileSync(path.join(directory, "note.txt"), "not ours\n");
          fs.writeFileSync(path.join(directory, "nested", "inner.txt"), "not ours either\n");
          const variant = [name, ...extraArguments].join(" ");
          const before = snapshotFiles(directory);
          refusedFreshInstall(currentInstaller, directory, extraArguments);
          assert.deepEqual(
            snapshotFiles(directory),
            before,
            `${variant} must stay untouched when the installer refuses it`,
          );
          assertCleanUserInstallState();
          variants.push(variant);
        }
      }
      return { variants };
    },
  }),
);

results.push(
  await runNsisScenario({
    label,
    slug: "guard busy",
    name: "when program files are busy during a silent upgrade from v0.1.0, it stops with code 2 and the old install keeps working",
    body: async ({ root, track, untrack }) => {
      const installPath = path.join(root, "Dexon 占用");
      firstInstall(previousInstaller, installPath);
      track(installPath);
      const userFiles = seedUserFiles(installPath);
      const before = snapshotFiles(installPath);
      const helper = await startLockingHelper(installPath);
      try {
        installExpectingStatus(currentInstaller, installPath, 2);
      } finally {
        await stopLockingHelper(helper);
      }
      const after = snapshotFiles(installPath);
      const changed = Object.keys(after).filter(
        (relative) => relative !== "Uninstall Dexon.exe" && after[relative] !== before[relative],
      );
      const added = Object.keys(after).filter((relative) => !(relative in before));
      assert.deepEqual(changed, [], "a stopped upgrade must leave every old file byte for byte");
      assert.deepEqual(added, [], "a stopped upgrade must not add files");
      assert.equal(readInstalledVersion(), previousVersion, "the old version must still be the registered one");
      assert.equal(
        compareVersions(fileVersion(appExecutable(installPath)), previousVersion),
        0,
        "the old executable must still be the old version",
      );
      install(currentInstaller, installPath);
      assertUserFilesKept(installPath, userFiles, "recovered upgrade");
      uninstall(installPath);
      untrack(installPath);
      return { recovered: true };
    },
  }),
);

results.push(
  await runNsisScenario({
    label,
    slug: "guard drive",
    name: "when the install lives on another drive than the temp folder, user files survive an upgrade and a busy file still stops the next one",
    body: async ({ root, track, untrack, cleanup }) => {
      const drive = attachVirtualDrive(root);
      cleanup(() => drive.detach());
      const installPath = path.join(drive.root, "Dexon 用户文件");
      firstInstall(previousInstaller, installPath);
      track(installPath);
      const userFiles = seedUserFiles(installPath);
      install(currentInstaller, installPath);
      assertUserFilesKept(installPath, userFiles, "cross-drive upgrade");
      const before = snapshotFiles(installPath);
      const helper = await startLockingHelper(installPath);
      const facts = { drive: drive.letter };
      let staging;
      try {
        facts.lock = probeLock(helper.executable);
        if (facts.lock.restored === false) failWithFacts("cross-drive lock probe could not restore the helper", facts);
        facts.probeStatus = probeUninstaller(installPath, facts);
        Object.assign(facts, probeFacts(installPath, before, helper));
        if (facts.probeStatus === 0 || facts.missingAfterProbe.count > 0) {
          failWithFacts("cross-drive busy uninstall did not stop", facts);
        }
        const installerStatus = runInstallerWith(currentInstaller, installPath, []).status;
        Object.assign(facts, { installerStatus }, installFacts(installPath, before, helper));
        staging = facts.stagingDirsAfterInstall;
        if (installerStatus !== 2) failWithFacts("cross-drive busy upgrade must stop with 2", facts);
        assert.deepEqual(
          snapshotFiles(installPath),
          before,
          `a busy file on another drive must stop the upgrade without changing anything: ${JSON.stringify(facts)}`,
        );
        console.log(`[nsis-install-guard] cross-drive facts: ${JSON.stringify(facts)}`);
      } finally {
        await stopLockingHelper(helper);
      }
      uninstall(installPath);
      untrack(installPath);
      assertDirectoryRemoved(installPath, 20_000);
      return { drive: drive.letter, crossDriveStaging: staging };
    },
  }),
);

console.log(
  JSON.stringify({
    ok: true,
    previousVersion,
    scenarios: results,
    previousInstallerSha256: sha256(previousInstaller),
    currentInstallerSha256: sha256(currentInstaller),
  }),
);

function freeDriveLetter() {
  for (const letter of "RSTUVWXYZ") {
    if (!fs.existsSync(`${letter}:\\`)) return letter;
  }
  throw new Error("cross-drive acceptance needs a free drive letter between R and Z");
}

function runDiskpart(root, lines) {
  const script = path.join(root, `diskpart-${Date.now()}.txt`);
  fs.writeFileSync(script, `${lines.join("\r\n")}\r\n`, "utf8");
  const result = spawnSync("diskpart", ["/s", script], { encoding: "buffer", timeout: 300_000, windowsHide: true });
  fs.rmSync(script, { force: true });
  return {
    status: result.status,
    error: result.error ? String(result.error) : (result.signal ?? null),
    output: `${decodeDiskpart(result.stdout)}${decodeDiskpart(result.stderr)}`.trim(),
  };
}

function decodeDiskpart(buffer) {
  if (!buffer || buffer.length === 0) return "";
  let zeros = 0;
  for (const byte of buffer) if (byte === 0) zeros += 1;
  return zeros > buffer.length / 4 ? buffer.toString("utf16le") : buffer.toString("utf8");
}

function describeDiskpart(result) {
  return `status=${result.status ?? "none"} error=${result.error ?? "none"} output=${result.output || "(empty)"}`;
}

function waitForVolume(directory, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(directory) && Date.now() < deadline) sleepSync(500);
  return fs.existsSync(directory);
}

function attachVirtualDrive(root) {
  const image = path.join(root, "cross-drive.vhdx");
  const letter = freeDriveLetter();
  const volume = `${letter}:\\`;
  const created = runDiskpart(root, [
    `create vdisk file="${image}" maximum=2048 type=expandable`,
    `select vdisk file="${image}"`,
    "attach vdisk",
    "create partition primary",
    "select partition 1",
    "format fs=ntfs quick label=DexonAcceptance",
    `assign letter=${letter}`,
  ]);
  if (!waitForVolume(volume, 90_000)) {
    throw new Error(`cross-drive acceptance needs a second volume; diskpart failed: ${describeDiskpart(created)}`);
  }
  return {
    letter,
    root: volume,
    detach: () => {
      const detached = runDiskpart(root, [`select vdisk file="${image}"`, "detach vdisk"]);
      const deadline = Date.now() + 20_000;
      while (fs.existsSync(volume) && Date.now() < deadline) sleepSync(500);
      if (fs.existsSync(volume)) {
        throw new Error(`cross-drive acceptance could not detach ${letter}: ${describeDiskpart(detached)}`);
      }
      fs.rmSync(image, { force: true, recursive: true, maxRetries: 20, retryDelay: 500 });
    },
  };
}

function stagingFacts() {
  const temporary = os.tmpdir();
  const staging = fs
    .readdirSync(temporary, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^ns.*\.tmp$/u.test(entry.name))
    .map((entry) => path.join(temporary, entry.name, "old-install"))
    .filter((directory) => fs.existsSync(directory))
    .map((directory) => ({ path: directory, files: walkFiles(directory).length }));
  return { count: staging.length, first: staging.slice(0, 5) };
}

function probeLock(executable) {
  const parked = `${executable}.probe`;
  let renameSameDrive;
  try {
    fs.renameSync(executable, parked);
    fs.renameSync(parked, executable);
    renameSameDrive = { ok: true };
  } catch (error) {
    renameSameDrive = { ok: false, code: error.code ?? String(error) };
    if (fs.existsSync(parked) && !fs.existsSync(executable)) fs.renameSync(parked, executable);
  }
  const copy = path.join(os.tmpdir(), `dexon-helper-copy-${process.pid}.exe`);
  fs.copyFileSync(executable, copy);
  let copyThenDelete;
  let restored = null;
  try {
    fs.unlinkSync(executable);
    copyThenDelete = { deleted: true };
    try {
      fs.copyFileSync(copy, executable);
      restored = true;
    } catch {
      restored = false;
    }
  } catch (error) {
    copyThenDelete = { deleted: false, code: error.code ?? String(error) };
  }
  fs.rmSync(copy, { force: true, maxRetries: 20, retryDelay: 500 });
  return { renameSameDrive, copyThenDelete, restored };
}

function probeUninstaller(installPath, facts) {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-probe-"));
  const probe = path.join(probeRoot, "old-uninstaller.exe");
  fs.copyFileSync(path.join(installPath, "Uninstall Dexon.exe"), probe);
  const result = spawnSync(probe, ["/S", "/KEEP_APP_DATA", "/currentuser", "--updated", `_?=${installPath}`], {
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
  });
  facts.probeFailure = result.error?.message ?? result.signal ?? null;
  fs.rmSync(probeRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  return result.status;
}

function snapshotDiff(installPath, before) {
  const current = snapshotFiles(installPath);
  return {
    helperAtSource: current[HELPER_RELATIVE] === before[HELPER_RELATIVE],
    missing: Object.keys(before).filter((relative) => !(relative in current)),
    changed: Object.keys(before).filter((relative) => relative in current && current[relative] !== before[relative]),
  };
}

function probeFacts(installPath, before, helper) {
  const diff = snapshotDiff(installPath, before);
  return {
    helperAtSource: diff.helperAtSource,
    helperProcessAlive: helper.child.exitCode === null,
    missingAfterProbe: { count: diff.missing.length, first: diff.missing.slice(0, 20) },
    changedAfterProbe: { count: diff.changed.length, first: diff.changed.slice(0, 20) },
    stagingDirs: stagingFacts(),
  };
}

function installFacts(installPath, before, helper) {
  const diff = snapshotDiff(installPath, before);
  return {
    helperAtSourceAfterInstall: diff.helperAtSource,
    helperProcessAliveAfterInstall: helper.child.exitCode === null,
    missingAfterInstall: { count: diff.missing.length, first: diff.missing.slice(0, 20) },
    changedAfterInstall: { count: diff.changed.length, first: diff.changed.slice(0, 20) },
    stagingDirsAfterInstall: stagingFacts(),
  };
}

function failWithFacts(message, facts) {
  console.log(`[nsis-install-guard] cross-drive facts: ${JSON.stringify(facts)}`);
  assert.fail(`${message}: ${JSON.stringify(facts)}`);
}
