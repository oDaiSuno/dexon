import { realpathSync, statSync } from "fs";
import path from "path";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

export function canonicalPath(filePath: string, useWindowsRules: boolean): string {
  const resolver = useWindowsRules ? path.win32 : path;
  let current = resolver.resolve(filePath);

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

export type DirectoryValidation =
  | { ok: true; path: string; canonicalPath: string }
  | { ok: false; error: string; reason: "missing" | "not-directory" | "denied" | "io-error" };

export function validateExistingDirectory(candidate: unknown): DirectoryValidation {
  if (typeof candidate !== "string" || !candidate)
    return { ok: false, reason: "missing", error: "Directory does not exist" };
  try {
    const realpath = realpathSync.native ?? realpathSync;
    const canonicalPath = realpath(candidate);
    if (!statSync(canonicalPath).isDirectory()) return { ok: false, reason: "not-directory", error: "Not a directory" };
    return { ok: true, path: candidate, canonicalPath };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, reason: "missing", error: "Directory does not exist" };
    if (code === "ENOTDIR") return { ok: false, reason: "not-directory", error: "Not a directory" };
    if (code === "EACCES" || code === "EPERM") return { ok: false, reason: "denied", error: "Directory access denied" };
    return { ok: false, reason: "io-error", error: "Unable to access directory" };
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
