import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasArchiveSegment } from "../shared/managed-process-policy.ts";

export { hasArchiveSegment };

export function resolveSafeProcessCwd(preferred?: string): string {
  let lastError: unknown;
  for (const getCandidate of [() => preferred, () => os.homedir(), () => os.tmpdir()]) {
    try {
      const candidate = getCandidate();
      if (!candidate || !path.isAbsolute(candidate) || hasArchiveSegment(candidate)) continue;
      const real = (fs.realpathSync.native ?? fs.realpathSync)(candidate);
      if (!hasArchiveSegment(real) && fs.statSync(real).isDirectory()) return real;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    "No physical working directory is available for a subprocess",
    lastError ? { cause: lastError } : undefined,
  );
}

export function withSystemToolPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const result = { ...env };
  const windows = platform === "win32";
  const keys = windows ? Object.keys(result).filter((key) => key.toLowerCase() === "path") : ["PATH"];
  const key = keys[0] ?? "Path";
  const separator = windows ? ";" : ":";
  const entries: string[] = [];
  const seen = new Set<string>();
  const append = (entry: string): void => {
    const comparison = windows ? entry.toLowerCase() : entry;
    if (entry && !seen.has(comparison)) {
      entries.push(entry);
      seen.add(comparison);
    }
  };
  for (const existing of keys) {
    for (const entry of (result[existing] ?? "").split(separator)) append(entry);
    delete result[existing];
  }
  if (windows) {
    const root = env.SystemRoot;
    if (root && path.win32.isAbsolute(root) && !hasArchiveSegment(root)) {
      append(path.win32.join(root, "System32", "OpenSSH"));
      append(path.win32.join(root, "System32"));
    }
  } else {
    for (const entry of [
      ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ])
      append(entry);
  }
  result[key] = entries.join(separator);
  return result;
}

export interface OsErrorFacts {
  readonly code: string;
  readonly syscall?: string;
}

export function osErrorFacts(error: unknown): OsErrorFacts | undefined {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth <= 4 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const value = current as { code?: unknown; syscall?: unknown; cause?: unknown };
    if (typeof value.code === "string" && /^E[A-Z0-9_]+$/.test(value.code)) {
      return { code: value.code, ...(typeof value.syscall === "string" ? { syscall: value.syscall } : {}) };
    }
    current = value.cause;
  }
  return undefined;
}

export function formatOsErrorFacts(facts: OsErrorFacts): string {
  return facts.syscall ? `${facts.code}, ${facts.syscall}` : facts.code;
}

export function redactDiagnostic(text: string, limit = 1024): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(
      /(["']?(?:token|api[_-]?key|password|secret|authorization|credential|NODE_AUTH_TOKEN)["']?\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;}]+)/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:npm_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted]")
    .slice(-Math.max(1, limit));
}
