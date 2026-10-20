#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
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
  snapshotFiles,
  startLockingHelper,
  stopLockingHelper,
  uninstall,
} from "./windows-nsis-harness.mjs";
import {
  attachVirtualDrive,
  changeFacts,
  fileIds,
  startProcessMonitor,
  stopProcessMonitor,
} from "./windows-nsis-cross-drive.mjs";
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
      const installerName = path.basename(currentInstaller);
      firstInstall(previousInstaller, installPath);
      track(installPath);
      const userFiles = seedUserFiles(installPath);

      const before = snapshotFiles(installPath);
      const beforeIds = fileIds(installPath);
      const upgrade = await busyInstall(root, installPath, installerName, []);
      const upgradeFacts = {
        drive: drive.letter,
        upgradeStatus: upgrade.status,
        monitor: upgrade.processes,
        displayVersion: readInstalledVersion(),
        fileVersion: fileVersion(appExecutable(installPath)),
        ...changeFacts(installPath, before, beforeIds),
      };
      console.log(`[nsis-install-guard] cross-drive upgrade facts: ${JSON.stringify(upgradeFacts)}`);
      assert.equal(
        upgrade.status,
        2,
        `a busy file on another drive must stop the upgrade: ${JSON.stringify(upgradeFacts)}`,
      );
      assert.equal(upgradeFacts.missing.count, 0, `nothing may disappear: ${JSON.stringify(upgradeFacts)}`);
      assert.equal(upgradeFacts.changed.count, 0, `no kept file may change: ${JSON.stringify(upgradeFacts)}`);
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
        monitor: reinstall.processes,
        ...changeFacts(installPath, before2, beforeIds2),
      };
      console.log(`[nsis-install-guard] cross-drive reinstall facts: ${JSON.stringify(reinstallFacts)}`);
      assert.equal(reinstall.status, 2, `a busy same-version reinstall must stop: ${JSON.stringify(reinstallFacts)}`);
      assert.deepEqual(
        snapshotFiles(installPath),
        before2,
        `a stopped same-version reinstall must change nothing: ${JSON.stringify(reinstallFacts)}`,
      );
      const staging = reinstallFacts.stagingDirs;
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

async function busyInstall(root, installPath, installerName, extraArguments) {
  const helper = await startLockingHelper(installPath);
  const monitor = startProcessMonitor(root, installerName);
  try {
    const status = runInstallerWith(currentInstaller, installPath, extraArguments).status;
    return { status, processes: await stopProcessMonitor(monitor) };
  } finally {
    await stopLockingHelper(helper);
  }
}
