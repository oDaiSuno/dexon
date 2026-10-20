import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sleepSync } from "./windows-nsis-harness.mjs";

const LOCK_SCRIPT = String.raw`
$path = $env:DEXON_LOCK_PATH
$stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
Write-Output "LOCKED"
try { [Console]::In.ReadLine() | Out-Null } finally { $stream.Dispose() }
exit 0
`;

export async function holdFileLock(file) {
  const script = path.join(os.tmpdir(), `dexon-file-lock-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(script, LOCK_SCRIPT, "utf8");
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, DEXON_LOCK_PATH: file } },
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
  await new Promise((resolve) => {
    const timer = setTimeout(finish, 15_000);
    function finish() {
      clearTimeout(timer);
      child.stdout.off("data", check);
      child.off("exit", finish);
      resolve();
    }
    function check() {
      if (output.text.includes("LOCKED")) finish();
    }
    child.stdout.on("data", check);
    child.once("exit", finish);
    check();
  });
  fs.rmSync(script, { force: true });
  if (!output.text.includes("LOCKED")) {
    child.kill();
    throw new Error(`could not lock ${file}: ${output.text.trim() || "no output"}`);
  }
  if (!isFileLocked(file)) {
    child.stdin.end();
    throw new Error(`file lock was not effective: ${file}`);
  }
  return { child, file };
}

export async function releaseFileLock(handle) {
  const { child, file } = handle;
  child.stdin.end();
  await exitWithin(child, 10_000);
  const deadline = Date.now() + 10_000;
  while (isFileLocked(file) && Date.now() < deadline) sleepSync(100);
  if (isFileLocked(file)) throw new Error(`file lock was not released: ${file}`);
}

export function isFileLocked(file) {
  const probe = `${file}.probe`;
  try {
    fs.renameSync(file, probe);
  } catch (error) {
    return error.code !== "ENOENT";
  }
  fs.renameSync(probe, file);
  return false;
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
