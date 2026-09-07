import { realpathSync, statSync } from "fs";
import path from "path";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

/**
 * Resolve the nearest existing ancestor so a symlink cannot be hidden behind
 * one or more not-yet-created path segments.
 */
export function canonicalPath(filePath: string, useWindowsRules: boolean): string {
  const resolver = useWindowsRules ? path.win32 : path;
  let current = resolver.resolve(filePath);

  // Cross-platform Windows path tests must stay lexical. On Windows itself,
  // realpath provides the same symlink/junction protection as the POSIX path.
  if (useWindowsRules && process.platform !== "win32") return resolver.normalize(current);

  const missingSegments: string[] = [];
  const realpath = realpathSync.native ?? realpathSync;

  while (true) {
    try {
      const existing = resolver.normalize(realpath(current));
      return resolver.normalize(resolver.join(existing, ...missingSegments));
    } catch {
      const parent = resolver.dirname(current);
      if (parent === current) return resolver.normalize(resolver.join(current, ...missingSegments));
      missingSegments.unshift(resolver.basename(current));
      current = parent;
    }
  }
}

export type DirectoryValidation = { ok: true; path: string; canonicalPath: string } | { ok: false; error: string };

/**
 * Validate that a candidate refers to an existing directory and resolve its
 * canonical (realpath) path for authorization.
 */
export function validateExistingDirectory(candidate: unknown): DirectoryValidation {
  if (typeof candidate !== "string" || !candidate) return { ok: false, error: "Directory does not exist" };
  try {
    const realpath = realpathSync.native ?? realpathSync;
    const canonicalPath = realpath(candidate);
    if (!statSync(canonicalPath).isDirectory()) return { ok: false, error: "Not a directory" };
    return { ok: true, path: candidate, canonicalPath };
  } catch {
    return { ok: false, error: "Directory does not exist" };
  }
}

export function isFilePathAllowed(target: string, allowedRoots: ReadonlySet<string>): boolean {
  for (const root of allowedRoots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const separator = useWindowsRules ? "\\" : path.sep;
    const normalized = canonicalPath(target, useWindowsRules);
    const normalizedRoot = canonicalPath(root, useWindowsRules);
    const comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
    const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
    const rootWithSeparator = comparableRoot.endsWith(separator) ? comparableRoot : comparableRoot + separator;

    if (comparable === comparableRoot || comparable.startsWith(rootWithSeparator)) return true;
  }

  return false;
}
