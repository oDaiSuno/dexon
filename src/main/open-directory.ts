import { realpath, stat } from "node:fs/promises";
import path from "node:path";

// Phase 6: "open current folder" is a real open, not a reveal. The desktop
// menu hands over a path; the main process re-validates it (absolute, real,
// a directory) before asking the shell to open it. Opening is strictly
// narrower than arbitrary shell execution and follows the same trust boundary
// as the existing show-item-in-folder channel (HC-18).

export type OpenDirectoryDeps = {
  realpath?: typeof realpath;
  stat?: typeof stat;
  /** Electron's shell.openPath resolves with "" on success or an error message. */
  openPath: (target: string) => Promise<string>;
};

export async function openValidatedDirectory(rawPath: unknown, deps: OpenDirectoryDeps): Promise<void> {
  const { realpath: resolveReal, stat: statPath, openPath } = deps;
  if (typeof rawPath !== "string" || !path.isAbsolute(rawPath) || rawPath.includes("\0")) {
    throw new Error("Invalid directory path");
  }
  let target: string;
  try {
    target = await (resolveReal ?? realpath)(rawPath);
  } catch {
    throw new Error("Directory does not exist");
  }
  const info = await (statPath ?? stat)(target);
  if (!info.isDirectory()) throw new Error("Not a directory");
  const failure = await openPath(target);
  if (failure) throw new Error(failure);
}
