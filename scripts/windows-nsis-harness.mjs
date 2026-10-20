import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { waitForUninstallerCopy } from "./windows-nsis-uninstaller.mjs";

export function regularFile(value) {
  const resolved = path.resolve(value);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing installer: ${resolved}`);
  return resolved;
}

export function appExecutable(directory) {
  return regularFile(path.join(directory, "Dexon.exe"));
}

export function fileVersion(file) {
  const escaped = file.replaceAll("'", "''");
  return execFileSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Item -LiteralPath '${escaped}').VersionInfo.FileVersion`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

export function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function install(installer, directory) {
  installExpectingStatus(installer, directory, 0);
}

export function installExpectingStatus(installer, directory, expectedStatus, extraArguments = []) {
  const result = runInstallerWith(installer, directory, extraArguments);
  if (result.error || result.signal || result.status !== expectedStatus) {
    throw installerStatusError(result, directory, expectedStatus);
  }
  waitForUninstallerCopy();
  return result;
}

export function installerStatusError(result, directory, expectedStatus) {
  if (result.error?.code === "ETIMEDOUT") {
    return new Error(
      `installer did not finish in 180 s; a hidden dialog is the likely cause (${directory})\n${result.stderr ?? ""}`,
      { cause: result.error },
    );
  }
  if (result.error) {
    return new Error(`installer failed to start: ${result.error.message}`, { cause: result.error });
  }
  if (result.signal) return new Error(`installer was killed by ${result.signal} (${directory})`);
  return new Error(
    `installer exited ${result.status}, expected ${expectedStatus} (${directory})\n${result.stderr ?? ""}`,
  );
}

export function runInstaller(installer, directory) {
  return runInstallerWith(installer, directory, []);
}

export function runInstallerWith(installer, directory, extraArguments = []) {
  return spawnSync(installer, ["/S", ...extraArguments, `/D=${directory}`], {
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
  });
}

export function installFailed(result) {
  return Boolean(result.error || result.signal || result.status !== 0);
}

export function installerFailure(result) {
  return new Error(
    `installer failed: ${result.error?.message ?? result.signal ?? result.status}\n${result.stderr ?? ""}`,
    { cause: result.error },
  );
}

export function uninstall(directory) {
  const uninstallers = fs
    .readdirSync(directory)
    .filter((name) => /^Uninstall.*\.exe$/iu.test(name))
    .map((name) => path.join(directory, name));
  assert.equal(uninstallers.length, 1, "installed layout must contain exactly one official uninstaller");
  const result = spawnSync(uninstallers[0], ["/currentuser", "/S"], {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `uninstaller failed: ${result.error?.message ?? result.signal ?? result.status}\n${result.stderr ?? ""}`,
      { cause: result.error },
    );
  }
  waitForUninstallerCopy();
}

export function validateStartup(executable, isolatedRoot, expectedVersion, phase) {
  for (const previousReport of walkFiles(isolatedRoot).filter(
    (file) => path.basename(file) === "packaged-startup-check.json",
  )) {
    fs.rmSync(previousReport);
  }
  const userData = path.join(isolatedRoot, "user-data");
  const result = spawnSync(
    executable,
    [`--user-data-dir=${userData}`, "--validate-packaged-startup", "--disable-gpu"],
    {
      cwd: path.dirname(executable),
      env: {
        ...process.env,
        HOME: isolatedRoot,
        USERPROFILE: isolatedRoot,
        APPDATA: path.join(isolatedRoot, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(isolatedRoot, "AppData", "Local"),
        TMP: isolatedRoot,
        TEMP: isolatedRoot,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      },
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    },
  );
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `${phase} packaged startup failed: ${result.error?.message ?? result.signal ?? result.status}\n${result.stderr ?? ""}`,
      { cause: result.error },
    );
  }
  const reportFiles = walkFiles(isolatedRoot).filter((file) => path.basename(file) === "packaged-startup-check.json");
  assert.equal(reportFiles.length, 1, `${phase} startup must write exactly one report`);
  const report = JSON.parse(fs.readFileSync(reportFiles[0], "utf8"));
  assert.equal(report.ok, true);
  assert.equal(report.appVersion, expectedVersion);
  assert.equal(report.platformArch, "win32-x64");
  assert.equal(report.rendererReady, true);
  assert.equal(report.hostReady, true);
  assert.equal(report.hostAckRevision, report.revision);
  return { phase, appVersion: report.appVersion, piVersion: report.piVersion, hostAckRevision: report.hostAckRevision };
}

export function readUserInstallState() {
  const script = String.raw`
$entries=@(
  Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue
  Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue
  Get-ItemProperty 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue
)|Where-Object{$_.DisplayName -like 'Dexon*'}
$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'Dexon.lnk'
$processes=@(Get-CimInstance Win32_Process|Where-Object{$_.Name -in @('Dexon.exe','pi-managed-process-helper.exe')})
[pscustomobject]@{entries=@($entries).Count;shortcut=(Test-Path -LiteralPath $shortcut);processes=$processes.Count}|ConvertTo-Json -Compress`;
  return JSON.parse(
    execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    }),
  );
}

export function assertCleanUserInstallState(timeoutMs = 0) {
  const expected = { entries: 0, shortcut: false, processes: 0 };
  const deadline = Date.now() + timeoutMs;
  let state;
  let pending = true;
  while (pending) {
    state = readUserInstallState();
    if (isDeepStrictEqual(state, expected)) return;
    pending = Date.now() < deadline;
    if (pending) sleepSync(250);
  }
  assert.deepEqual(state, expected, "NSIS test requires a clean user install state");
}

export function installDirectoryEntries(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}

export function assertDirectoryRemoved(directory, timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  let exists = fs.existsSync(directory);
  while (exists && Date.now() < deadline) {
    sleepSync(250);
    exists = fs.existsSync(directory);
  }
  assert.equal(exists, false, `official uninstall must remove the install folder itself: ${directory}`);
}

export function assertNoFilesLeft(directory, timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  let files = listInstalledFiles(directory);
  while (files.length > 0 && Date.now() < deadline) {
    sleepSync(250);
    files = listInstalledFiles(directory);
  }
  assert.deepEqual(files, [], `uninstall must leave no files behind: ${directory}`);
}

export function listInstalledFiles(directory) {
  return walkFiles(directory)
    .map((file) => path.relative(directory, file).split(path.sep).join("/"))
    .sort();
}

export function snapshotFiles(directory) {
  const snapshot = {};
  for (const file of walkFiles(directory)) {
    snapshot[path.relative(directory, file).split(path.sep).join("/")] = sha256(file);
  }
  return snapshot;
}

export function readInstalledVersion() {
  const script = String.raw`
$entry=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|Where-Object{$_.DisplayName -like 'Dexon*'}|Select-Object -First 1
if ($null -eq $entry) { '' } else { $entry.DisplayVersion }`;
  const output = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  return output === "" ? null : output;
}

export async function startLockingHelper(directory) {
  const executable = regularFile(
    path.join(directory, "resources", "managed-process", "win32-x64", "pi-managed-process-helper.exe"),
  );
  const child = spawn(executable, ["--owner-stdio-v1"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  await once(child, "spawn");
  await waitForInstalledHelperHello(child);
  return { child, executable };
}

export async function stopLockingHelper(handle) {
  const child = handle.child;
  child.stdin.destroy();
  if (child.exitCode === null) child.kill();
  if (child.exitCode === null) {
    let timer;
    try {
      await Promise.race([
        once(child, "exit"),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("locked helper did not exit after termination")), 10_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function waitForInstalledHelperHello(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("installed helper did not emit HELLO")), 5_000);
    const onData = () => finish();
    const onExit = (code) => finish(new Error(`installed helper exited before HELLO (${code ?? "unknown"})`));
    const onError = (error) => finish(error);
    const finish = (error) => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    child.stdout.once("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

export function seedUserFiles(directory) {
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

export function assertUserFilesKept(directory, files, phase) {
  const missing = Object.keys(files).filter((relative) => !fs.existsSync(path.join(directory, relative)));
  assert.deepEqual(missing, [], `${phase} deleted user files: ${missing.join(", ")}`);
  for (const [relative, content] of Object.entries(files)) {
    assert.equal(
      fs.readFileSync(path.join(directory, relative), "utf8"),
      content,
      `${phase} must keep user file ${relative} byte for byte`,
    );
  }
}

export function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files;
}
