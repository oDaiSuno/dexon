import { realpath } from "node:fs/promises";
import path from "node:path";
import type { SessionInfo } from "../shared/types";
import { normalizeWorktreePathForComparison } from "../shared/worktree-path";

async function canonicalPath(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  return normalizeWorktreePathForComparison(await realpath(resolved).catch(() => resolved));
}

export async function filterSessionsByCwd(sessions: SessionInfo[], cwd: string): Promise<SessionInfo[]> {
  const canonicalCwd = await canonicalPath(cwd);
  const canonicalPaths = new Map<string, Promise<string>>([[cwd, Promise.resolve(canonicalCwd)]]);
  const matches = await Promise.all(
    sessions.map(async (session) => {
      if (normalizeWorktreePathForComparison(path.resolve(session.cwd)) === canonicalCwd) return true;
      let canonical = canonicalPaths.get(session.cwd);
      if (!canonical) {
        canonical = canonicalPath(session.cwd);
        canonicalPaths.set(session.cwd, canonical);
      }
      return (await canonical) === canonicalCwd;
    }),
  );
  return sessions.filter((_session, index) => matches[index]);
}
