#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { workflowWarning } from "./ci-retry.mjs";
import { FIRST_INSTALL_ATTEMPTS, firstInstallCrashWarning } from "./windows-installer-retry.mjs";
import { assertCleanUserInstallState, regularFile, sha256, uninstall } from "./windows-nsis-harness.mjs";
import { runNsisScenario } from "./windows-nsis-scenarios.mjs";

const USER32 = String.raw`
param([string]$Mode)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DexonW32 {
  public delegate bool EnumProc(IntPtr handle, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint owner);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int id);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageW")] public static extern IntPtr SendMessageText(IntPtr window, uint message, IntPtr wParam, string text);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$script:owner = 0
$script:found = New-Object System.Collections.ArrayList
$script:callback = [DexonW32+EnumProc]{
  param([IntPtr]$handle, [IntPtr]$state)
  $ownerId = 0
  [void][DexonW32]::GetWindowThreadProcessId($handle, [ref]$ownerId)
  if ($ownerId -eq $script:owner -and [DexonW32]::IsWindowVisible($handle)) { [void]$script:found.Add($handle) }
  return $true
}
function Get-OwnedWindows([int]$ownerId) {
  $script:owner = $ownerId
  $script:found.Clear()
  [void][DexonW32]::EnumWindows($script:callback, [IntPtr]::Zero)
  return @($script:found)
}
function Get-WizardWindow([int]$ownerId) {
  foreach ($candidate in (Get-OwnedWindows $ownerId)) {
    if ([int64][DexonW32]::FindWindowEx($candidate, [IntPtr]::Zero, "#32770", $null) -ne 0) { return $candidate }
  }
  return [IntPtr]::Zero
}
function Get-PageEdit([IntPtr]$outer) {
  $inner = [DexonW32]::FindWindowEx($outer, [IntPtr]::Zero, "#32770", $null)
  if ([int64]$inner -eq 0) { return [IntPtr]::Zero }
  return [DexonW32]::GetDlgItem($inner, 1019)
}
function Test-DirectoryPage([IntPtr]$outer) { return [int64](Get-PageEdit $outer) -ne 0 }
$process = Start-Process -FilePath $env:DEXON_NSIS_INSTALLER -ArgumentList "/currentuser" -PassThru
$report = [ordered]@{ mode = $Mode; window = $false; pageReached = $false; nextEnabledAfterTyping = $false; nextEnabledAfterNext = $false; pageAdvanced = $false; exited = $false; exitCode = $null }
try {
  $deadline = (Get-Date).AddSeconds(40)
  $window = [IntPtr]::Zero
  while ([int64]$window -eq 0 -and (Get-Date) -lt $deadline) {
    $window = Get-WizardWindow $process.Id
    if ([int64]$window -eq 0) { Start-Sleep -Milliseconds 250 }
  }
  if ([int64]$window -eq 0) {
    $report.reason = "installer wizard window did not appear"
    $process.Refresh()
    if ($process.HasExited) { $report.exitCode = $process.ExitCode }
    return ($report | ConvertTo-Json -Compress)
  }
  $report.window = $true
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (Test-DirectoryPage $window) { break }
    [void][DexonW32]::SendMessage($window, 0x0111, [IntPtr]1, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 600
  }
  $report.pageReached = Test-DirectoryPage $window
  if (-not $report.pageReached) { $report.reason = "directory page did not appear"; return ($report | ConvertTo-Json -Compress) }
  $edit = Get-PageEdit $window
  [void][DexonW32]::SendMessageText($edit, 0x000C, [IntPtr]::Zero, $env:DEXON_NSIS_TARGET)
  Start-Sleep -Milliseconds 600
  $report.nextEnabledAfterTyping = [DexonW32]::IsWindowEnabled([DexonW32]::GetDlgItem($window, 1))
  [void][DexonW32]::SendMessage($window, 0x0111, [IntPtr]1, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 1500
  $report.pageAdvanced = -not (Test-DirectoryPage $window)
  $report.nextEnabledAfterNext = [DexonW32]::IsWindowEnabled([DexonW32]::GetDlgItem($window, 1))
  if ($Mode -eq "advanced") {
    $target = Join-Path $env:DEXON_NSIS_TARGET "resources\app.asar"
    $nested = Join-Path $env:DEXON_NSIS_TARGET "Dexon\resources\app.asar"
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
      $uninstaller = Get-Item -LiteralPath (Join-Path $env:DEXON_NSIS_TARGET "Uninstall Dexon.exe") -ErrorAction SilentlyContinue
      if ((Test-Path -LiteralPath $target) -or (Test-Path -LiteralPath $nested)) { break }
      if ($null -ne $uninstaller -and $uninstaller.Length -gt 1MB) { break }
      Start-Sleep -Milliseconds 500
    }
    Start-Sleep -Milliseconds 1500
  }
  if ($Mode -eq "disabled") {
    $rect = [DexonW32+RECT]::new()
    if ([DexonW32]::GetWindowRect($window, [ref]$rect)) {
      $bitmap = [System.Drawing.Bitmap]::new($rect.Right - $rect.Left, $rect.Bottom - $rect.Top)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
      $bitmap.Save($env:DEXON_NSIS_SHOT, [System.Drawing.Imaging.ImageFormat]::Png)
      $graphics.Dispose()
      $bitmap.Dispose()
      $report.screenshot = $true
    }
  }
  if ($Mode -ne "advanced") {
    [void][DexonW32]::SendMessage($window, 0x0111, [IntPtr]2, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 900
    foreach ($candidate in (Get-OwnedWindows $process.Id)) {
      if ([int64]$candidate -ne [int64]$window) { [void][DexonW32]::SendMessage($candidate, 0x0111, [IntPtr]6, [IntPtr]::Zero) }
    }
  }
  $deadline = (Get-Date).AddSeconds(10)
  while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
  }
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  $process.Refresh()
  $report.exited = $process.HasExited
  return ($report | ConvertTo-Json -Compress)
}
finally {
  $process.Refresh()
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
`;

if (process.platform !== "win32" || process.arch !== "x64") {
  console.log(JSON.stringify({ ok: true, skipped: "Windows x64 NSIS acceptance only" }));
  process.exit(0);
}

const [previousArgument, currentArgument, ...extra] = process.argv.slice(2);
if (!previousArgument || !currentArgument || extra.length > 0) {
  throw new Error("Usage: test-windows-nsis-directory-page.mjs <previous-installer.exe> <current-installer.exe>");
}
const project = path.resolve(import.meta.dirname, "..");
const baseline = JSON.parse(fs.readFileSync(path.join(project, ".github/windows-upgrade-baseline.json"), "utf8"));
const previousInstaller = regularFile(previousArgument);
const currentInstaller = regularFile(currentArgument);
assert.equal(sha256(previousInstaller), baseline.sha256, "Previous installer does not match the reviewed baseline");
assertCleanUserInstallState();

const label = "nsis-directory-page";
const evidence = path.join(project, ".artifacts/distribution-evidence");
const screenshot = path.join(evidence, "nsis-directory-page-nonempty.png");

const results = [];

results.push(
  await runNsisScenario({
    label,
    slug: "directory page",
    name: "when the directory page points at a folder holding someone else files, next is greyed out and the folder is untouched",
    body: async ({ root }) => {
      fs.mkdirSync(evidence, { recursive: true });
      const target = path.join(root, "Dexon项目");
      const prepare = () => {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, "note.txt"), "not ours\n");
      };
      const report = runPage(root, target, "disabled", prepare);
      assert.equal(report.window, true, `the installer window must appear: ${JSON.stringify(report)}`);
      assert.equal(report.pageReached, true, `the directory page must appear: ${JSON.stringify(report)}`);
      assert.equal(report.pageAdvanced, false, "the refused directory page must not be left");
      assert.equal(report.nextEnabledAfterNext, false, "next must stay greyed out after the attempt to leave the page");
      if (report.nextEnabledAfterNext === false) {
        assert.equal(
          report.nextEnabledAfterTyping,
          false,
          "typing a folder that already holds other files must grey out next before it is clicked; a failure here means NSIS verified only when leaving the page",
        );
      }
      assert.deepEqual(fs.readdirSync(target).sort(), ["note.txt"], "the refused folder must stay untouched");
      assert.equal(fs.existsSync(screenshot), true, "the disabled next button must be captured");
      return { screenshot: path.relative(project, screenshot), report };
    },
  }),
);

results.push(
  await runNsisScenario({
    label,
    slug: "directory page fresh",
    name: "when the directory page points at a new empty folder, next stays available",
    body: async ({ root }) => {
      const target = path.join(root, "Dexon fresh");
      const prepare = () => fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
      const report = runPage(root, target, "advanced", prepare);
      assert.equal(report.pageReached, true, `the directory page must appear: ${JSON.stringify(report)}`);
      assert.equal(report.nextEnabledAfterTyping, true, "next must stay enabled for a new empty folder");
      assert.equal(report.pageAdvanced, true, "an accepted directory page must be left");
      return { nextEnabled: true };
    },
  }),
);

results.push(
  await runNsisScenario({
    label,
    slug: "directory page existing",
    name: "when the directory page points at an existing Dexon folder, next stays available",
    body: async ({ root }) => {
      const target = path.join(root, "Dexon");
      const prepare = () => {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, "Dexon.exe"), "stub\n");
        fs.writeFileSync(path.join(target, "Uninstall Dexon.exe"), "stub\n");
      };
      const report = runPage(root, target, "advanced", prepare);
      assert.equal(report.pageReached, true, `the directory page must appear: ${JSON.stringify(report)}`);
      assert.equal(report.nextEnabledAfterTyping, true, "next must stay enabled for an existing Dexon folder");
      assert.equal(report.pageAdvanced, true, "an accepted directory page must be left");
      return { nextEnabled: true };
    },
  }),
);

console.log(
  JSON.stringify({
    ok: true,
    scenarios: results,
    previousInstallerSha256: sha256(previousInstaller),
    currentInstallerSha256: sha256(currentInstaller),
  }),
);

function runPage(root, target, mode, prepare) {
  const script = path.join(root, `directory-page-${mode}.ps1`);
  fs.writeFileSync(script, USER32, "utf8");
  for (let attempt = 1; ; attempt += 1) {
    prepare();
    const report = runPageOnce(script, target, mode);
    removeInstalledCopy(target);
    if (report.window !== false || !crashedBeforeWindow(report) || attempt >= FIRST_INSTALL_ATTEMPTS) return report;
    console.log(workflowWarning(firstInstallCrashWarning(attempt, report.exitCode)));
  }
}

function runPageOnce(script, target, mode) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, mode],
    {
      encoding: "utf8",
      timeout: 240_000,
      windowsHide: true,
      env: {
        ...process.env,
        DEXON_NSIS_INSTALLER: currentInstaller,
        DEXON_NSIS_TARGET: target,
        DEXON_NSIS_SHOT: screenshot,
      },
    },
  );
  return parseReport(result);
}

function crashedBeforeWindow(report) {
  return report.exitCode === -1073741819 || report.exitCode === 3221225477;
}

function parseReport(result) {
  const line = String(result.stdout ?? "")
    .split(/\r?\n/u)
    .reverse()
    .find((candidate) => candidate.trim().startsWith("{"));
  if (!line) {
    throw new Error(
      `directory page automation produced no report (exit ${result.status ?? "none"}):\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return JSON.parse(line);
}

function removeInstalledCopy(target) {
  for (const candidate of [target, path.join(target, "Dexon")]) {
    const installed = fs.statSync(path.join(candidate, "Uninstall Dexon.exe"), { throwIfNoEntry: false })?.size ?? 0;
    if (installed > 1024 * 1024) {
      uninstall(candidate);
      assertCleanUserInstallState(20_000);
    }
  }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}
