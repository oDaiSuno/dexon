import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function atomicWriteText(filePath: string, text: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, text, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(temporaryPath, filePath);
    try {
      chmodSync(filePath, 0o600);
    } catch {
      /* best effort on platforms without POSIX modes */
    }
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      /* ignore cleanup failure */
    }
    throw error;
  }
}

export function atomicWrite(filePath: string, value: unknown): void {
  atomicWriteText(filePath, JSON.stringify(value, null, 2));
}

export function desktopUserDataPath(): string {
  return (
    process.env.PI_DESKTOP_USER_DATA?.trim() ||
    (process.env.PI_CODING_AGENT_DIR ? path.join(process.env.PI_CODING_AGENT_DIR, "desktop") : "") ||
    path.join(homedir(), ".pi", "desktop")
  );
}
