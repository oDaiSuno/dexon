import { execFileSync } from "node:child_process";

export function waitForUninstallerCopy(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let idlePolls = 0;
  while (idlePolls < 2) {
    const running = runningUninstallerCopies();
    idlePolls = running.length === 0 ? idlePolls + 1 : 0;
    if (idlePolls >= 2) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `uninstaller copy still running after ${Math.round(timeoutMs / 1000)} s: ${running
          .map((entry) => `${entry.name} (${entry.path ?? "unknown path"})`)
          .join(", ")}`,
      );
    }
    sleepSync(250);
  }
}

function runningUninstallerCopies() {
  const script = String.raw`
$found=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.Name -match '^(Au_|Un_[A-Z])\.exe$'}|ForEach-Object{[pscustomobject]@{name=$_.Name;path=$_.ExecutablePath}})
ConvertTo-Json -Compress -InputObject $found`;
  const output = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const parsed = output === "" ? [] : JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
