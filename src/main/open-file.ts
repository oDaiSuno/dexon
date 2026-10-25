import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export type OpenFileDeps = {
  realpath?: typeof realpath;
  stat?: typeof stat;
  /** Electron's shell.openPath resolves with "" on success or an error message. */
  openPath: (target: string) => Promise<string>;
};

export async function openValidatedMarkdownFile(rawPath: unknown, deps: OpenFileDeps): Promise<void> {
  const { realpath: resolveReal, stat: statPath, openPath } = deps;
  if (typeof rawPath !== "string" || !path.isAbsolute(rawPath) || rawPath.includes("\0")) {
    throw new Error("Invalid file path");
  }
  let target: string;
  try {
    target = await (resolveReal ?? realpath)(rawPath);
  } catch {
    throw new Error("File does not exist");
  }
  if (path.extname(target).toLowerCase() !== ".md") throw new Error("Only Markdown files can be opened");
  const info = await (statPath ?? stat)(target);
  if (!info.isFile()) throw new Error("Not a file");
  const failure = await openPath(target);
  if (failure) throw new Error(failure);
}
