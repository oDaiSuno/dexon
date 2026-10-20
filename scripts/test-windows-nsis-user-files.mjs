#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { firstInstall } from "./windows-nsis-first-install.mjs";
import {
  assertCleanUserInstallState,
  assertDirectoryRemoved,
  assertNoFilesLeft,
  assertUserFilesKept,
  install,
  installExpectingStatus,
  listInstalledFiles,
  regularFile,
  seedUserFiles,
  sha256,
  snapshotFiles,
  uninstall,
} from "./windows-nsis-harness.mjs";
import { runNsisScenario } from "./windows-nsis-scenarios.mjs";

if (process.platform !== "win32" || process.arch !== "x64") {
  console.log(JSON.stringify({ ok: true, skipped: "Windows x64 NSIS acceptance only" }));
  process.exit(0);
}

const [previousArgument, currentArgument, ...extra] = process.argv.slice(2);
if (!previousArgument || !currentArgument || extra.length > 0) {
  throw new Error("Usage: test-windows-nsis-user-files.mjs <previous-installer.exe> <current-installer.exe>");
}
const project = path.resolve(import.meta.dirname, "..");
const baseline = JSON.parse(fs.readFileSync(path.join(project, ".github/windows-upgrade-baseline.json"), "utf8"));
const previousVersion = baseline.version;
const previousInstaller = regularFile(previousArgument);
const currentInstaller = regularFile(currentArgument);
assert.equal(sha256(previousInstaller), baseline.sha256, "Previous installer does not match the reviewed baseline");
assertCleanUserInstallState();

const label = "nsis-user-files";
const results = [];
let currentFiles;

results.push(
  await runNsisScenario({
    label,
    slug: "user-files clean",
    name: "when nothing but Dexon is in the folder, uninstall removes the folder itself",
    body: async ({ root, track, untrack }) => {
      const installPath = path.join(root, "Dexon clean");
      firstInstall(currentInstaller, installPath);
      track(installPath);
      currentFiles = listInstalledFiles(installPath);
      assert.ok(currentFiles.includes("Dexon.exe"), "the packaged install must contain Dexon.exe");
      uninstall(installPath);
      untrack(installPath);
      assertDirectoryRemoved(installPath, 20_000);
      return { referenceFiles: currentFiles.length };
    },
  }),
);

results.push(
  await runNsisScenario({
    label,
    slug: "user-files upgrade",
    name: "when a v0.1.0 folder also holds user files, upgrading keeps them and leaves no v0.1.0-only files",
    body: async ({ root, track, untrack }) => {
      const installPath = path.join(root, "Dexon 用户文件");
      firstInstall(previousInstaller, installPath);
      track(installPath);
      const userFiles = seedUserFiles(installPath);
      install(currentInstaller, installPath);
      assertUserFilesKept(installPath, userFiles, "upgrade");
      assert.deepEqual(
        listInstalledFiles(installPath),
        combined(currentFiles, userFiles),
        "the upgraded folder must hold exactly the current package plus the user files",
      );
      install(previousInstaller, installPath);
      assertUserFilesKept(installPath, userFiles, "rollback");
      const movedOut = path.join(root, "moved-user-files");
      for (const relative of Object.keys(userFiles)) {
        const destination = path.join(movedOut, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(path.join(installPath, relative), destination);
      }
      uninstall(installPath);
      untrack(installPath);
      assertNoFilesLeft(installPath, 20_000);
      return { rolledBackVersion: previousVersion, movedOutBeforeUninstall: Object.keys(userFiles) };
    },
  }),
);

results.push(
  await runNsisScenario({
    label,
    slug: "user-files refusal",
    name: "when the current installer refuses a non-empty folder, the old folder's uninstaller is already safe",
    body: async ({ root, track, untrack }) => {
      const installPath = path.join(root, "Dexon 旧安装");
      firstInstall(previousInstaller, installPath);
      track(installPath);
      const userFiles = seedUserFiles(installPath);
      const refused = path.join(root, "Someone else's folder");
      fs.mkdirSync(path.join(refused, "nested"), { recursive: true });
      fs.writeFileSync(path.join(refused, "note.txt"), "someone else's file\n");
      fs.writeFileSync(path.join(refused, "nested", "inner.txt"), "someone else's nested file\n");
      const before = snapshotFiles(refused);
      installExpectingStatus(currentInstaller, refused, 2);
      assert.deepEqual(snapshotFiles(refused), before, "a refused install must not touch the folder it refused");
      uninstall(installPath);
      untrack(installPath);
      assertUserFilesKept(installPath, userFiles, "uninstall through the replaced uninstaller");
      assert.deepEqual(
        listInstalledFiles(installPath),
        Object.keys(userFiles).sort(),
        "after the safe uninstall only the user files stay behind",
      );
      return { refusedFolderUntouched: true };
    },
  }),
);

results.push(
  await runNsisScenario({
    label,
    slug: "user-files reinstall",
    name: "when the current version is reinstalled over itself, user files stay and uninstall leaves only them",
    body: async ({ root, track, untrack }) => {
      const installPath = path.join(root, "Dexon 重装");
      firstInstall(currentInstaller, installPath);
      track(installPath);
      const userFiles = seedUserFiles(installPath);
      install(currentInstaller, installPath);
      assertUserFilesKept(installPath, userFiles, "same-version reinstall");
      assert.deepEqual(
        listInstalledFiles(installPath),
        combined(currentFiles, userFiles),
        "the reinstalled folder must hold exactly the current package plus the user files",
      );
      uninstall(installPath);
      untrack(installPath);
      assert.deepEqual(
        listInstalledFiles(installPath),
        Object.keys(userFiles).sort(),
        "uninstall must leave exactly the user files",
      );
      return { remainingFiles: Object.keys(userFiles).length };
    },
  }),
);

console.log(
  JSON.stringify({
    ok: true,
    previousVersion,
    referenceFiles: currentFiles.length,
    scenarios: results,
    knownLimitation:
      "v0.1.x uninstallers still delete the whole folder; user files were moved out before the final uninstall",
    previousInstallerSha256: sha256(previousInstaller),
    currentInstallerSha256: sha256(currentInstaller),
  }),
);

function combined(reference, files) {
  return [...new Set([...reference, ...Object.keys(files)])].sort();
}
