import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

export const AUTOMATION_WORKSPACE_SEGMENTS = [".dexon", "automations"] as const;

export function automationWorkspaceRoot(home: string): string {
  const resolver = /^[a-zA-Z]:[\\/]/.test(home) || home.startsWith("\\\\") || home.startsWith("//") ? path.win32 : path;
  return resolver.join(home, ...AUTOMATION_WORKSPACE_SEGMENTS);
}

function isStrictDescendant(root: string, target: string): boolean {
  if (!path.isAbsolute(root) || !path.isAbsolute(target)) return false;
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function notDirectory(directory: string): Error {
  return Object.assign(new Error(`${directory} is not a directory; the existing path was not modified`), {
    code: "ENOTDIR",
  });
}

async function realDirectory(directory: string): Promise<string> {
  if (!(await lstat(directory)).isDirectory()) throw notDirectory(directory);
  const canonical = await realpath(directory);
  if (path.relative(directory, canonical) !== "" || !(await lstat(canonical)).isDirectory()) {
    throw notDirectory(directory);
  }
  return canonical;
}

async function ensureRealDirectory(directory: string): Promise<string> {
  await realDirectory(path.dirname(directory));
  try {
    await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true });
  }
  return realDirectory(directory);
}

export async function prepareAutomationWorkspaceRoot(
  home: string,
): Promise<
  { ok: true; path: string; canonicalPath: string } | { ok: false; reason: "not-directory" | "io-error"; error: string }
> {
  try {
    let canonicalPath = await realpath(home);
    if (!(await lstat(canonicalPath)).isDirectory()) throw notDirectory(home);
    for (const segment of AUTOMATION_WORKSPACE_SEGMENTS) {
      canonicalPath = await ensureRealDirectory(path.join(canonicalPath, segment));
    }
    const directory = automationWorkspaceRoot(home);
    if (!(await lstat(directory)).isDirectory() || path.relative(canonicalPath, await realpath(directory)) !== "") {
      throw notDirectory(directory);
    }
    return { ok: true, path: directory, canonicalPath };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      reason: code === "ENOTDIR" || code === "EEXIST" ? "not-directory" : "io-error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveDirectory(targetPath: string): Promise<string> {
  let current = targetPath;
  const missing: string[] = [];
  while (true) {
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      const parent = path.dirname(current);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
      continue;
    }
    const canonical = await realpath(current);
    if (!(await lstat(canonical)).isDirectory() || (!info.isDirectory() && !info.isSymbolicLink())) {
      throw new Error(`${current} is not a directory`);
    }
    return path.join(canonical, ...missing);
  }
}

function directoriesOverlap(left: string, right: string): boolean {
  return path.relative(left, right) === "" || isStrictDescendant(left, right) || isStrictDescendant(right, left);
}

export async function isTaskDirectoryReferenced(taskCwd: string, remainingCwds: readonly string[]): Promise<boolean> {
  if (remainingCwds.length === 0) return false;
  if (!path.isAbsolute(taskCwd) || remainingCwds.some((cwd) => !path.isAbsolute(cwd))) return true;
  if (remainingCwds.some((cwd) => directoriesOverlap(taskCwd, cwd))) return true;
  try {
    const canonicalTarget = await resolveDirectory(taskCwd);
    for (const cwd of remainingCwds) {
      if (directoriesOverlap(canonicalTarget, await resolveDirectory(cwd))) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export async function isManagedTaskDirectory(
  rootCanonical: string,
  targetPath: string,
): Promise<{ inside: boolean; canonicalTarget?: string }> {
  if (!path.isAbsolute(rootCanonical) || !path.isAbsolute(targetPath)) return { inside: false };
  try {
    const root = await realDirectory(rootCanonical);
    const canonicalTarget = await resolveDirectory(targetPath);
    return isStrictDescendant(root, canonicalTarget) ? { inside: true, canonicalTarget } : { inside: false };
  } catch {
    return { inside: false };
  }
}

export async function ensureManagedTaskDirectory(home: string, targetCwd: string): Promise<void> {
  const root = automationWorkspaceRoot(home);
  if (!isStrictDescendant(root, targetCwd)) {
    throw new Error("Automation task cwd must be a strict managed workspace descendant");
  }
  const prepared = await prepareAutomationWorkspaceRoot(home);
  if (!prepared.ok) throw new Error(prepared.error);
  const managed = await isManagedTaskDirectory(prepared.canonicalPath, targetCwd);
  if (!managed.inside || !managed.canonicalTarget) {
    throw new Error("Automation task cwd must resolve to a strict managed workspace descendant");
  }
  let current = prepared.canonicalPath;
  for (const segment of path.relative(current, managed.canonicalTarget).split(path.sep)) {
    current = await ensureRealDirectory(path.join(current, segment));
  }
  const verified = await isManagedTaskDirectory(prepared.canonicalPath, targetCwd);
  if (!verified.inside || verified.canonicalTarget !== current) {
    throw new Error("Automation task cwd changed while preparing the managed workspace");
  }
}

export async function cleanupManagedTaskDirectory(home: string, taskCwd: string): Promise<boolean> {
  try {
    let root = await realDirectory(await realpath(home));
    for (const segment of AUTOMATION_WORKSPACE_SEGMENTS) {
      root = await realDirectory(path.join(root, segment));
    }
    const managed = await isManagedTaskDirectory(root, taskCwd);
    if (!managed.inside || !managed.canonicalTarget) return false;
    const verified = await isManagedTaskDirectory(root, managed.canonicalTarget);
    if (!verified.inside || verified.canonicalTarget !== managed.canonicalTarget) return false;
    await rm(managed.canonicalTarget, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
