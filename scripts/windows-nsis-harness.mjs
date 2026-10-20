import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { workflowWarning } from "./ci-retry.mjs";
import {
  ACCESS_VIOLATION_EXIT_STATUS,
  FIRST_INSTALL_PHASE,
  shouldRetryFirstInstall,
} from "./windows-installer-retry.mjs";

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

export function firstInstall(installer, directory) {
  const result = runInstaller(installer, directory);
  if (!installFailed(result)) return;
  if (
    !shouldRetryFirstInstall({
      phase: FIRST_INSTALL_PHASE,
      result,
      installState: readUserInstallState(),
      installDirectoryEntries: installDirectoryEntries(directory),
    })
  ) {
    throw installerFailure(result);
  }
  console.log(
    workflowWarning(
      `First install of the previous installer exited ${ACCESS_VIOLATION_EXIT_STATUS} (0xC0000005) with no install record left; retrying once. A crash dump may be uploaded for diagnosis.`,
    ),
  );
  install(installer, directory);
}

export function install(installer, directory) {
  const result = runInstaller(installer, directory);
  if (installFailed(result)) throw installerFailure(result);
}

export function runInstaller(installer, directory) {
  return spawnSync(installer, ["/S", `/D=${directory}`], {
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

export function assertNoMaterialInstallResidue(directory, timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  let entries;
  let pending = true;
  while (pending) {
    entries = installDirectoryEntries(directory);
    if (entries.length === 0) return;
    pending = Date.now() < deadline;
    if (pending) sleepSync(250);
  }
  assert.deepEqual(entries, [], "official uninstall must leave no material install residue");
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
