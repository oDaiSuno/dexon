import { useSyncExternalStore } from "react";
import type { SessionInfo } from "./types";
import { getSessionDisplayTitle } from "./session-list";

let snapshot: SessionInfo[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function publishSessionCatalog(sessions: SessionInfo[]): void {
  snapshot = sessions;
  notify();
}

export function clearSessionCatalog(): void {
  if (snapshot.length === 0) return;
  snapshot = [];
  notify();
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

export function resolveSessionTitle(
  sessionId: string,
  title: string | undefined,
  catalog: readonly SessionInfo[],
): string {
  if (title) return title;
  const session = catalog.find((item) => item.id === sessionId);
  return session ? getSessionDisplayTitle(session) : sessionId;
}
