import { randomUUID } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const unsupportedHardLinkCodes = new Set(["EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV"]);

function removeTemporaryFile(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function readOrCreatePrivateFile(filePath: string, contents: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    const existing = readFileSync(filePath, "utf8");
    chmodSync(filePath, 0o600);
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      linkSync(temporaryPath, filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        if (!code || !unsupportedHardLinkCodes.has(code)) throw error;
        try {
          writeFileSync(filePath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
        } catch (creationError) {
          if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError;
        }
      }
    }
    chmodSync(filePath, 0o600);
    return readFileSync(filePath, "utf8");
  } finally {
    removeTemporaryFile(temporaryPath);
  }
}

export function writePrivateJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, filePath);
    chmodSync(filePath, 0o600);
  } finally {
    removeTemporaryFile(temporaryPath);
  }
}
