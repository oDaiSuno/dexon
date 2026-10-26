import { useSyncExternalStore } from "react";

let naming: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  naming = next;
  for (const listener of listeners) listener();
}

export function markSessionNaming(sessionId: string): void {
  if (naming.has(sessionId)) return;
  publish(new Set([...naming, sessionId]));
}

export function clearSessionNaming(sessionId: string): void {
  if (!naming.has(sessionId)) return;
  const next = new Set(naming);
  next.delete(sessionId);
  publish(next);
}

export async function trackSessionNaming<T>(sessionId: string, request: () => Promise<T>): Promise<T> {
  markSessionNaming(sessionId);
  try {
    return await request();
  } finally {
    clearSessionNaming(sessionId);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getNamingSessions(): ReadonlySet<string> {
  return naming;
}

export function useSessionNaming(sessionId: string): boolean {
  return useSyncExternalStore(subscribe, getNamingSessions, getNamingSessions).has(sessionId);
}
