import type { SessionEntry } from "../shared/types";
import { getRpcSession } from "./rpc-manager";
import { getSessionLeafChoice } from "./session-leaf-store";
import { branchAt, lastEntryIdOf, withBranchModelChoice, type SessionBranch } from "./session-branch";

export { lastEntryIdOf } from "./session-branch";

export interface ResolveSessionBranchOptions {
  requestedLeafId?: string | null;
  fallbackLeafId?: string | null;
}

export function resolveSessionLeafId(
  sessionId: string,
  entries: readonly SessionEntry[],
  fileLeafId: string | null,
): string | null {
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) return live.inner.sessionManager.getLeafId() ?? null;
  const stored = getSessionLeafChoice(sessionId);
  if (stored && stored.lastEntryId === lastEntryIdOf(entries) && entries.some((entry) => entry.id === stored.leafId)) {
    return stored.leafId;
  }
  return fileLeafId;
}

export function resolveSessionBranch(
  sessionId: string,
  entries: readonly SessionEntry[],
  options?: ResolveSessionBranchOptions,
): SessionBranch {
  const fallback = options?.fallbackLeafId !== undefined ? options.fallbackLeafId : lastEntryIdOf(entries);
  const leafId =
    options?.requestedLeafId !== undefined
      ? options.requestedLeafId
      : resolveSessionLeafId(sessionId, entries, fallback);
  const branch = branchAt(entries, leafId);
  const live = getRpcSession(sessionId);
  if (live?.isAlive() && (live.inner.sessionManager.getLeafId() ?? null) === branch.leafId) {
    return withBranchModelChoice(branch, live.chosenModel());
  }
  return branch;
}
