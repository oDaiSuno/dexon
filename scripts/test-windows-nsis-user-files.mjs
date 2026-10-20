#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertCleanUserInstallState,
  firstInstall,
  install,
  regularFile,
  sha256,
  uninstall,
} from "./windows-nsis-harness.mjs";

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
const previousInstaller = regularFile(previousArgument);
const currentInstaller = regularFile(currentArgument);
assert.equal(sha256(previousInstaller), baseline.sha256, "Previous installer does not match the reviewed baseline");
assertCleanUserInstallState();

const root = fs.mkdtempSync(path.join(os.tmpdir(), "Pi NSIS upgrade user-files "));
const installPath = path.join(root, "Dexon 用户文件");
let installed = false;
let completed = false;

try {
  firstInstall(previousInstaller, installPath);
  installed = true;
  const userFiles = seedUserFiles(installPath);

  install(currentInstaller, installPath);

  const missing = Object.keys(userFiles).filter((relative) => !fs.existsSync(path.join(installPath, relative)));
  assert.deepEqual(missing, [], `upgrade deleted user files: ${missing.join(", ")}`);
  for (const [relative, content] of Object.entries(userFiles)) {
    assert.equal(
      fs.readFileSync(path.join(installPath, relative), "utf8"),
      content,
      `upgrade must keep user file ${relative} byte for byte`,
    );
  }

  uninstall(installPath);
  installed = false;
  completed = true;
  console.log(
    JSON.stringify({
      ok: true,
      scenario: "upgrade keeps user files inside the install folder",
      previousInstallerSha256: sha256(previousInstaller),
      currentInstallerSha256: sha256(currentInstaller),
      userFiles: Object.keys(userFiles),
    }),
  );
} finally {
  if (installed) uninstallQuietly(installPath);
  if (completed) fs.rmSync(root, { recursive: true, force: true });
  else console.error(`[nsis-user-files] retained failed fixture for inspection: ${root}`);
}

function seedUserFiles(directory) {
  const files = {
    "我的笔记.txt": "Dexon 升级说明：这一行是用户自己写的笔记，升级后必须还在。\n",
    "Project Files/data.csv": "project,tasks\n阿尔法,3\n贝塔,7\n",
    "resources/my-plugin/config.json": '{"plugin":"my-plugin","enabled":true}',
    "locales/custom-dictionary.txt": "Dexon\n用户词典\n不能删除\n",
  };
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(directory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return files;
}

function uninstallQuietly(directory) {
  try {
    uninstall(directory);
    return true;
  } catch {
    return false;
  }
}
