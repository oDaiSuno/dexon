import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sleepSync, snapshotFiles, walkFiles } from "./windows-nsis-harness.mjs";
import { waitForUninstallerCopy } from "./windows-nsis-uninstaller.mjs";

const HELPER_RELATIVE = "resources/managed-process/win32-x64/pi-managed-process-helper.exe";

export function freeDriveLetter() {
  for (const letter of "RSTUVWXYZ") {
    if (!fs.existsSync(`${letter}:\\`)) return letter;
  }
  throw new Error("cross-drive acceptance needs a free drive letter between R and Z");
}

export function runDiskpart(root, lines) {
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

export function decodeDiskpart(buffer) {
  if (!buffer || buffer.length === 0) return "";
  let zeros = 0;
  for (const byte of buffer) if (byte === 0) zeros += 1;
  return zeros > buffer.length / 4 ? buffer.toString("utf16le") : buffer.toString("utf8");
}

export function describeDiskpart(result) {
  return `status=${result.status ?? "none"} error=${result.error ?? "none"} output=${result.output || "(empty)"}`;
}

export function dismountImage(image) {
  const escaped = image.replaceAll("'", "''");
  let error = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Dismount-DiskImage -ImagePath '${escaped}' -ErrorAction Stop`,
      ],
      { encoding: "utf8", timeout: 120_000, windowsHide: true },
    );
    if (result.status === 0) return { attempts: attempt, error: null };
    error = `attempt ${attempt}: ${(result.stderr ?? "").trim() || (result.stdout ?? "").trim() || `exit ${result.status}`}`;
    if (attempt < 5) sleepSync(2000);
  }
  return { attempts: 5, error };
}

export function waitForVolume(directory, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(directory) && Date.now() < deadline) sleepSync(500);
  return fs.existsSync(directory);
}

export function attachVirtualDrive(root) {
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
      const dismounted = dismountImage(image);
      const deadline = Date.now() + 20_000;
      while (fs.existsSync(volume) && Date.now() < deadline) sleepSync(500);
      if (fs.existsSync(volume)) {
        throw new Error(
          `cross-drive acceptance could not detach ${letter}: ${dismounted.error ?? "dismounted but the drive letter remains"}`,
        );
      }
      fs.rmSync(image, { force: true, recursive: true, maxRetries: 20, retryDelay: 500 });
    },
  };
}

export function stagingFacts() {
  const temporary = os.tmpdir();
  const staging = fs
    .readdirSync(temporary, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^ns.*\.tmp$/u.test(entry.name))
    .map((entry) => path.join(temporary, entry.name, "old-install"))
    .filter((directory) => fs.existsSync(directory))
    .map((directory) => ({ path: directory, files: walkFiles(directory).length }));
  return { count: staging.length, first: staging.slice(0, 5) };
}

export function probeLock(executable) {
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

export function registryFacts(installPath) {
  const script = String.raw`
$uninstall=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue|Where-Object{$_.DisplayName -like 'Dexon*'}|Select-Object -First 1
$install=Get-ItemProperty 'HKCU:\Software\*' -ErrorAction SilentlyContinue|Where-Object{$_.InstallLocation -eq $env:DEXON_NSIS_INSTALL_PATH}|Select-Object -First 1
[pscustomobject]@{displayVersion=$uninstall.DisplayVersion;installLocation=$uninstall.InstallLocation;uninstallString=$uninstall.UninstallString;softwareKey=$install.PSChildName;softwareInstallLocation=$install.InstallLocation}|ConvertTo-Json -Compress`;
  const output = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, DEXON_NSIS_INSTALL_PATH: installPath },
  }).trim();
  return output === "" ? null : JSON.parse(output);
}

export function inodeFacts(installPath) {
  return {
    exe: statFacts(path.join(installPath, "Dexon.exe")),
    helper: statFacts(path.join(installPath, HELPER_RELATIVE)),
  };
}

export function statFacts(file) {
  const stats = fs.statSync(file, { bigint: true, throwIfNoEntry: false });
  return stats ? { ino: String(stats.ino), birthtimeMs: String(stats.birthtimeMs) } : null;
}

export function snapshotDiff(installPath, before) {
  const current = snapshotFiles(installPath);
  return {
    helperAtSource: current[HELPER_RELATIVE] === before[HELPER_RELATIVE],
    missing: Object.keys(before).filter((relative) => !(relative in current)),
    changed: Object.keys(before).filter((relative) => relative in current && current[relative] !== before[relative]),
  };
}

export function probeFacts(installPath, before, helper) {
  const diff = snapshotDiff(installPath, before);
  return {
    helperAtSource: diff.helperAtSource,
    helperProcessAlive: helper.child.exitCode === null,
    missingAfterProbe: { count: diff.missing.length, first: diff.missing.slice(0, 20) },
    changedAfterProbe: { count: diff.changed.length, first: diff.changed.slice(0, 20) },
    stagingDirs: stagingFacts(),
  };
}

export function installFacts(installPath, before, helper) {
  const diff = snapshotDiff(installPath, before);
  return {
    helperAtSourceAfterInstall: diff.helperAtSource,
    helperProcessAliveAfterInstall: helper.child.exitCode === null,
    missingAfterInstall: { count: diff.missing.length, first: diff.missing.slice(0, 20) },
    changedAfterInstall: { count: diff.changed.length, first: diff.changed.slice(0, 20) },
    stagingDirsAfterInstall: stagingFacts(),
  };
}

export function probeUninstaller(installPath) {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-probe-"));
  const probe = path.join(probeRoot, "old-uninstaller.exe");
  fs.copyFileSync(path.join(installPath, "Uninstall Dexon.exe"), probe);
  const report = {
    probePath: probe,
    spaced: /\s/u.test(probe),
    probeStatus: null,
    probeMs: 0,
    probeFailure: null,
    strayCopyWaited: false,
  };
  if (!report.spaced) {
    const started = Date.now();
    const result = spawnSync(probe, ["/S", "/KEEP_APP_DATA", "/currentuser", "--updated", `_?=${installPath}`], {
      encoding: "utf8",
      timeout: 180_000,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    report.probeMs = Date.now() - started;
    report.probeStatus = result.status;
    report.probeFailure = result.error?.message ?? result.signal ?? null;
    report.strayCopyWaited = waitForUninstallerCopy();
  }
  fs.rmSync(probeRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  return report;
}
