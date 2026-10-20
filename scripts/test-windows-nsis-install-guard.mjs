#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { firstInstall, refusedFreshInstall } from "./windows-nsis-first-install.mjs";
import {
  appExecutable,
  assertCleanUserInstallState,
  assertUserFilesKept,
  compareVersions,
  fileVersion,
  install,
  listInstalledFiles,
  readInstalledVersion,
  regularFile,
  runInstallerWith,
  seedUserFiles,
  sha256,
  snapshotFiles,
  uninstall,
} from "./windows-nsis-harness.mjs";
import {
  attachVirtualDrive,
  captureFailureEvidence,
  changeFacts,
  fileIds,
  startProcessMonitor,
  stopProcessMonitor,
} from "./windows-nsis-cross-drive.mjs";
import { holdFileLock, isFileLocked, releaseFileLock } from "./windows-nsis-file-lock.mjs";
import { waitForUninstallerCopy } from "./windows-nsis-uninstaller.mjs";
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
      const facts = await busyUpgradeFacts({ root, installPath, label: "same-drive" });
      console.log(`[nsis-install-guard] same-drive upgrade facts: ${JSON.stringify(facts)}`);
      assert.equal(facts.lockStillHeld, true, `the fixture must keep the lock: ${JSON.stringify(facts)}`);
      assert.equal(facts.status, 2, `a busy upgrade must stop with 2: ${JSON.stringify(facts)}`);
      assert.equal(facts.missing.count, 0, `nothing may disappear: ${JSON.stringify(facts)}`);
      assert.equal(facts.changed.count, 0, `no kept file may change: ${JSON.stringify(facts)}`);
      assert.equal(facts.added.count, 0, `nothing may be added: ${JSON.stringify(facts)}`);
      assert.equal(
        facts.displayVersion,
        previousVersion,
        `the old version must still be registered: ${JSON.stringify(facts)}`,
      );
      assert.equal(
        compareVersions(facts.fileVersion, previousVersion),
        0,
        `the old executable must still be the old version: ${JSON.stringify(facts)}`,
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
      const installerName = path.basename(currentInstaller);
      firstInstall(previousInstaller, installPath);
      track(installPath);
      const userFiles = seedUserFiles(installPath);

      const upgradeFacts = {
        drive: drive.letter,
        ...(await busyUpgradeFacts({ root, installPath, label: "cross-drive" })),
      };
      console.log(`[nsis-install-guard] cross-drive upgrade facts: ${JSON.stringify(upgradeFacts)}`);
      assert.equal(upgradeFacts.lockStillHeld, true, `the fixture must keep the lock: ${JSON.stringify(upgradeFacts)}`);
      assert.equal(
        upgradeFacts.status,
        2,
        `a busy file on another drive must stop the upgrade: ${JSON.stringify(upgradeFacts)}`,
      );
      assert.equal(upgradeFacts.missing.count, 0, `nothing may disappear: ${JSON.stringify(upgradeFacts)}`);
      assert.equal(upgradeFacts.changed.count, 0, `no kept file may change: ${JSON.stringify(upgradeFacts)}`);
      assert.equal(upgradeFacts.added.count, 0, `nothing may be added: ${JSON.stringify(upgradeFacts)}`);
      assert.equal(
        upgradeFacts.displayVersion,
        previousVersion,
        `the old version must stay registered: ${JSON.stringify(upgradeFacts)}`,
      );
      assert.equal(
        compareVersions(upgradeFacts.fileVersion, previousVersion),
        0,
        `the old executable must stay installed: ${JSON.stringify(upgradeFacts)}`,
      );

      install(currentInstaller, installPath);
      assertUserFilesKept(installPath, userFiles, "cross-drive upgrade");

      const before2 = snapshotFiles(installPath);
      const beforeIds2 = fileIds(installPath);
      const reinstall = await busyInstall(root, installPath, installerName, []);
      const reinstallFacts = {
        reinstallStatus: reinstall.status,
        lockStillHeld: reinstall.lockStillHeld,
        monitor: reinstall.processes,
        ...changeFacts(installPath, before2, beforeIds2),
      };
      console.log(`[nsis-install-guard] cross-drive reinstall facts: ${JSON.stringify(reinstallFacts)}`);
      assert.equal(
        reinstallFacts.lockStillHeld,
        true,
        `the fixture must keep the lock: ${JSON.stringify(reinstallFacts)}`,
      );
      assert.equal(reinstall.status, 2, `a busy same-version reinstall must stop: ${JSON.stringify(reinstallFacts)}`);
      assert.deepEqual(
        snapshotFiles(installPath),
        before2,
        `a stopped same-version reinstall must change nothing: ${JSON.stringify(reinstallFacts)}`,
      );
      const staging = reinstallFacts.stagingDirs;
      uninstall(installPath);
      untrack(installPath);
      assert.deepEqual(
        listInstalledFiles(installPath),
        Object.keys(userFiles).sort(),
        "uninstall on another drive must leave exactly the user files",
      );
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

async function busyUpgradeFacts({ root, installPath, label }) {
  const before = snapshotFiles(installPath);
  const beforeIds = fileIds(installPath);
  const run = await busyInstall(root, installPath, path.basename(currentInstaller), []);
  const facts = {
    status: run.status,
    lockStillHeld: run.lockStillHeld,
    monitor: run.processes,
    strayCopyWaited: run.strayCopyWaited,
    displayVersion: readInstalledVersion(),
    fileVersion: fileVersion(appExecutable(installPath)),
    ...changeFacts(installPath, before, beforeIds),
  };
  if (facts.status !== 2) facts.evidence = captureFailureEvidence(root, label, run.processes);
  return facts;
}

async function busyInstall(root, installPath, installerName, extraArguments) {
  const lock = await holdFileLock(lockTarget(installPath));
  const monitor = startProcessMonitor(root, installerName);
  let outcome;
  try {
    const status = runInstallerWith(currentInstaller, installPath, extraArguments).status;
    const processes = await stopProcessMonitor(monitor);
    outcome = { status, processes, lockStillHeld: isFileLocked(lock.file) };
  } finally {
    await releaseFileLock(lock);
  }
  return { ...outcome, strayCopyWaited: waitForUninstallerCopy() };
}

function lockTarget(installPath) {
  return path.join(installPath, "resources", "managed-process", "win32-x64", "pi-managed-process-helper.exe");
}
