import { existsSync } from "node:fs";
import path from "node:path";
import type { SessionInfo } from "../shared/types";

export type SessionWatchChange = { kind: "ignore" } | { kind: "refresh-all" } | { kind: "refresh-path"; path: string };

export function classifySessionWatchChange(
  agentDir: string,
  sessionsRoot: string,
  filename: string | Buffer | null,
): SessionWatchChange {
  if (!filename) return { kind: "refresh-all" };
  const name = filename.toString();
  const resolvedAgentDir = path.resolve(agentDir);
  const candidate = path.resolve(resolvedAgentDir, name);
  if (candidate !== resolvedAgentDir && !candidate.startsWith(`${resolvedAgentDir}${path.sep}`))
    return { kind: "ignore" };
  const baseName = path.basename(candidate);
  if (
    baseName.startsWith(".") ||
    baseName.startsWith("session-index-cache.json") ||
    baseName.startsWith("session-projects.json")
  ) {
    return { kind: "ignore" };
  }
  const resolvedSessionsRoot = path.resolve(sessionsRoot);
  if (candidate === resolvedSessionsRoot || candidate.startsWith(`${resolvedSessionsRoot}${path.sep}`)) {
    if (candidate !== resolvedSessionsRoot && candidate.endsWith(".jsonl")) {
      return { kind: "refresh-path", path: candidate };
    }
    if (baseName.endsWith(".tmp")) return { kind: "ignore" };
    if (existsSync(resolvedAgentDir) && !existsSync(candidate)) return { kind: "refresh-all" };
    return { kind: "ignore" };
  }
  if (name.endsWith(".json") || name.includes("session")) return { kind: "refresh-all" };
  return { kind: "ignore" };
}

type SessionRoots = Pick<SessionInfo, "cwd" | "projectRoot">;

export function didSessionRootsChange(previous: SessionRoots | null, next: SessionRoots | null): boolean {
  return !previous || !next || previous.cwd !== next.cwd || (previous.projectRoot ?? "") !== (next.projectRoot ?? "");
}
