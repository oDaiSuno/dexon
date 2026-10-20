import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sleepSync, snapshotFiles, walkFiles } from "./windows-nsis-harness.mjs";

const UNINSTALLER_RELATIVE = "Uninstall Dexon.exe";

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

export function statFacts(file) {
  const stats = fs.statSync(file, { bigint: true, throwIfNoEntry: false });
  return stats ? { ino: String(stats.ino), birthtimeMs: String(stats.birthtimeMs) } : null;
}

export function fileIds(installPath) {
  const ids = {};
  for (const file of walkFiles(installPath)) {
    ids[path.relative(installPath, file).split(path.sep).join("/")] = statFacts(file)?.ino ?? null;
  }
  return ids;
}

export function changeFacts(installPath, before, beforeIds) {
  const current = snapshotFiles(installPath);
  const missing = Object.keys(before).filter((relative) => !(relative in current));
  const changed = Object.keys(before).filter(
    (relative) => relative !== UNINSTALLER_RELATIVE && relative in current && current[relative] !== before[relative],
  );
  const afterIds = fileIds(installPath);
  const moved = Object.keys(beforeIds).filter(
    (relative) => relative in afterIds && afterIds[relative] !== beforeIds[relative],
  );
  return {
    missing: { count: missing.length, first: missing.slice(0, 20) },
    changed: { count: changed.length, first: changed.slice(0, 20) },
    idsChanged: { count: moved.length, first: moved.slice(0, 20) },
    stagingDirs: stagingFacts(),
  };
}

export function startProcessMonitor(root, installerName) {
  const script = path.join(root, "process-monitor.ps1");
  const stop = path.join(root, "process-monitor.stop");
  const ready = path.join(root, "process-monitor.ready");
  fs.writeFileSync(script, MONITOR_SCRIPT, "utf8");
  fs.rmSync(stop, { force: true });
  fs.rmSync(ready, { force: true });
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        DEXON_MONITOR_STOP: stop,
        DEXON_MONITOR_READY: ready,
        DEXON_MONITOR_INSTALLER: installerName,
      },
    },
  );
  const output = { text: "" };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output.text += chunk;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    output.text += chunk;
  });
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(ready) && child.exitCode === null && Date.now() < deadline) sleepSync(100);
  return { child, stop, output };
}

export async function stopProcessMonitor(handle) {
  fs.writeFileSync(handle.stop, "", "utf8");
  await exitWithin(handle.child, 15_000);
  const line = handle.output.text
    .split(/\r?\n/u)
    .reverse()
    .find((candidate) => candidate.trim().startsWith("["));
  if (!line) {
    console.error(`[nsis-install-guard] process monitor produced no report: ${handle.output.text.trim() || "(empty)"}`);
    return [];
  }
  try {
    return JSON.parse(line);
  } catch {
    console.error(`[nsis-install-guard] process monitor report is not valid JSON: ${line}`);
    return [];
  }
}

function exitWithin(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill();
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const MONITOR_SCRIPT = String.raw`
$stop = $env:DEXON_MONITOR_STOP
$installer = $env:DEXON_MONITOR_INSTALLER
$start = Get-Date
$seen = @{}
$ready = $false
while (-not (Test-Path -LiteralPath $stop)) {
  foreach ($item in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $name = $item.Name
    $path = $item.ExecutablePath
    $hit = ($name -eq "old-uninstaller.exe") -or ($name -eq "Uninstall Dexon.exe") -or ($name -match "^(Au_|Un_[A-Z])\.exe$") -or ($null -ne $path -and $path.EndsWith($installer))
    if ($hit) {
      $key = [string]$item.ProcessId
      if (-not $seen.ContainsKey($key)) {
        $seen[$key] = [pscustomobject]@{ pid = $item.ProcessId; parentPid = $item.ParentProcessId; name = $name; commandLine = $item.CommandLine; firstSeenMs = [int64]((Get-Date) - $start).TotalMilliseconds }
      }
    }
  }
  if (-not $ready) { New-Item -ItemType File -Path $env:DEXON_MONITOR_READY -Force | Out-Null; $ready = $true }
  Start-Sleep -Milliseconds 150
}
ConvertTo-Json -Compress -InputObject @($seen.Values)
`;
