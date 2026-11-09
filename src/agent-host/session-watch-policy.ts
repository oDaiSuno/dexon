import { statSync } from "node:fs";
import path from "node:path";
import type { SessionInfo } from "../shared/types";

export type SessionWatchChange =
  { kind: "ignore" } | { kind: "file"; path: string } | { kind: "subtree"; dir: string } | { kind: "unknown" };

export function classifySessionWatchChange(sessionsRoot: string, filename: string | Buffer | null): SessionWatchChange {
  if (!filename) return { kind: "unknown" };
  const root = path.resolve(sessionsRoot);
  const candidate = path.resolve(root, filename.toString());
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return { kind: "ignore" };
  if (path.basename(candidate).startsWith(".")) return { kind: "ignore" };
  if (candidate !== root && candidate.endsWith(".jsonl")) return { kind: "file", path: candidate };
  try {
    return statSync(candidate).isDirectory() ? { kind: "subtree", dir: candidate } : { kind: "ignore" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") return { kind: "unknown" };
    return path.extname(candidate) ? { kind: "ignore" } : { kind: "subtree", dir: candidate };
  }
}

type SessionRoots = Pick<SessionInfo, "cwd" | "projectRoot">;

export function didSessionRootsChange(previous: SessionRoots | null, next: SessionRoots | null): boolean {
  return !previous || !next || previous.cwd !== next.cwd || (previous.projectRoot ?? "") !== (next.projectRoot ?? "");
}
