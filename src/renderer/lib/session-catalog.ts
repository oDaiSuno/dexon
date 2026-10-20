import { useSyncExternalStore } from "react";
import type { SessionInfo } from "./types";
import { getSessionDisplayTitle } from "./session-list";

// The session list the sidebar already loads, published for the rest of the
// window: the path above a conversation, the session a message came from and
// the session a tool acted on all need titles, and none of them may ask the
// Host again for something the sidebar is holding.

let snapshot: SessionInfo[] = [];
const listeners = new Set<() => void>();

export function publishSessionCatalog(sessions: SessionInfo[]): void {
  snapshot = sessions;
  for (const listener of listeners) listener();
}

export function getSessionCatalog(): SessionInfo[] {
  return snapshot;
}

export function subscribeSessionCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSessionCatalog(): SessionInfo[] {
  return useSyncExternalStore(subscribeSessionCatalog, getSessionCatalog, getSessionCatalog);
}

/** Title for a session that may no longer be listed; the id is the last resort. */
export function resolveSessionTitle(
  sessionId: string,
  title: string | undefined,
  catalog: readonly SessionInfo[],
): string {
  if (title) return title;
  const session = catalog.find((item) => item.id === sessionId);
  return session ? getSessionDisplayTitle(session) : sessionId;
}
