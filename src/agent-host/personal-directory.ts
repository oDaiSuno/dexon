import { mkdirSync, realpathSync, statSync } from "fs";
import path from "path";
import { isWindowsAbsolutePath } from "./file-access-core";

/**
 * Fixed per-user workspace directory created under the real user home
 * (macOS: /Users/<name>/.dexon, Windows: C:\Users\<name>\.dexon). It is only a
 * working space — Electron and Pi application data locations are unrelated.
 */
export const PERSONAL_DIRECTORY_NAME = ".dexon";

export type PersonalDirectoryResult =
  | { ok: true; path: string; canonicalPath: string; reused: boolean }
  | { ok: false; reason: "not-directory" | "prepare-failed"; error: string };

/** Filesystem boundary (the subset this module uses) so tests can script
 * deterministic failure and race sequences without touching a real disk. */
export interface PersonalDirectoryFs {
  statSync(path: string): { isDirectory(): boolean };
  mkdirSync(path: string, options: { recursive: true }): string | undefined;
  realpathSync(path: string): string;
}

const defaultFs: PersonalDirectoryFs = {
  statSync: (filePath) => statSync(filePath),
  mkdirSync: (filePath, options) => mkdirSync(filePath, options),
  realpathSync: (filePath) => {
    const realpath = realpathSync.native ?? realpathSync;
    return realpath(filePath);
  },
};

/** Pure path computation. Windows-shaped homes (drive letters, UNC paths) join
 * under win32 rules so both platforms produce the correct separator layout;
 * everything else uses the host platform's rules. */
export function personalDirectoryPath(home: string): string {
  const useWindowsRules = isWindowsAbsolutePath(home);
  const resolver = useWindowsRules ? path.win32 : path;
  return resolver.join(home, PERSONAL_DIRECTORY_NAME);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function conflictResult(directory: string): PersonalDirectoryResult {
  return {
    ok: false,
    reason: "not-directory",
    error: `${directory} exists and is not a directory; the existing file was not modified`,
  };
}

function failure(error: unknown): PersonalDirectoryResult {
  return { ok: false, reason: "prepare-failed", error: describeError(error) };
}

/**
 * Create or reuse the personal directory. Existing directories are reused
 * as-is (contents are never cleared), a same-name regular file is never
 * overwritten or deleted, and every failure — including a realpath that
 * cannot confirm the final directory — carries the real cause so the caller
 * can surface it and retry once the blocker is removed. Success is only
 * reported after the canonical (realpath) target is strictly resolved and
 * verified to be a directory.
 *
 * `home` must be the actual host home (os.homedir()); tests substitute an
 * isolated temporary directory instead of touching the real one.
 */
export function preparePersonalDirectory(options: { home: string; fs?: PersonalDirectoryFs }): PersonalDirectoryResult {
  const directory = personalDirectoryPath(options.home);
  const io = options.fs ?? defaultFs;

  /** Strictly resolve and verify the final directory; no lenient ancestor
   * fallback — an unresolvable path can never count as readiness. */
  const resolveCanonical = (): { canonicalPath: string } | { failure: PersonalDirectoryResult } => {
    try {
      const canonicalPath = io.realpathSync(directory);
      if (!io.statSync(canonicalPath).isDirectory()) return { failure: conflictResult(directory) };
      return { canonicalPath };
    } catch (error) {
      return { failure: failure(error) };
    }
  };

  const okResult = (canonicalPath: string, reused: boolean): PersonalDirectoryResult => ({
    ok: true,
    path: directory,
    canonicalPath,
    reused,
  });

  let exists: boolean;
  try {
    io.statSync(directory);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return failure(error);
    exists = false;
  }

  if (exists) {
    const resolved = resolveCanonical();
    return "failure" in resolved ? resolved.failure : okResult(resolved.canonicalPath, true);
  }

  // Recursive mkdir returns the first path it created, or undefined when the
  // directory already exists — e.g. another caller won the race — which is
  // exactly the reuse signal.
  let created: string | undefined;
  try {
    created = io.mkdirSync(directory, { recursive: true });
  } catch (error) {
    // Classify by what exists now instead of trusting errno: a same-name file
    // that appeared mid-flight is a conflict; anything else is a real failure.
    try {
      if (!io.statSync(directory).isDirectory()) return conflictResult(directory);
      const resolved = resolveCanonical();
      return "failure" in resolved ? resolved.failure : okResult(resolved.canonicalPath, true);
    } catch {
      return failure(error);
    }
  }

  const resolved = resolveCanonical();
  return "failure" in resolved ? resolved.failure : okResult(resolved.canonicalPath, created === undefined);
}
