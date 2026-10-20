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
  seedUserFiles,
  sha256,
  sleepSync,
  snapshotFiles,
  startLockingHelper,
  stopLockingHelper,
  uninstall,
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
      try {
        installExpectingStatus(currentInstaller, installPath, 2);
      } finally {
        await stopLockingHelper(helper);
      }
      assert.deepEqual(
        snapshotFiles(installPath),
        before,
        "a busy file on another drive must stop the upgrade without changing anything",
      );
      const staging = tempStagingFacts();
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
  const result = spawnSync("diskpart", ["/s", script], { encoding: "utf8", timeout: 300_000, windowsHide: true });
  fs.rmSync(script, { force: true });
  return `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
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
    throw new Error(`cross-drive acceptance needs a second volume; diskpart failed: ${created}`);
  }
  return {
    letter,
    root: volume,
    detach: () => {
      const detached = runDiskpart(root, [`select vdisk file="${image}"`, "detach vdisk"]);
      const deadline = Date.now() + 20_000;
      while (fs.existsSync(volume) && Date.now() < deadline) sleepSync(500);
      if (fs.existsSync(volume)) {
        throw new Error(`cross-drive acceptance could not detach ${letter}: ${detached}`);
      }
      fs.rmSync(image, { force: true, recursive: true, maxRetries: 20, retryDelay: 500 });
    },
  };
}

function tempStagingFacts() {
  const temporary = os.tmpdir();
  const pluginDirectories = fs
    .readdirSync(temporary, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^ns.*\.tmp$/u.test(entry.name))
    .map((entry) => entry.name);
  return {
    pluginDirectories: pluginDirectories.length,
    stagingDirectories: pluginDirectories.filter((name) => fs.existsSync(path.join(temporary, name, "old-install"))),
  };
}
