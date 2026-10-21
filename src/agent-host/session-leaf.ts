import type { SessionEntry } from "../shared/types";
import { getRpcSession } from "./rpc-manager";
import { getSessionLeafChoice } from "./session-leaf-store";

export function lastEntryIdOf(entries: SessionEntry[]): string | null {
  return entries.at(-1)?.id ?? null;
}

export function resolveSessionLeafId(
  sessionId: string,
  entries: SessionEntry[],
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
