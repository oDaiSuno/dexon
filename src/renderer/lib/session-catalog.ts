import { useCallback, useSyncExternalStore } from "react";
import type { SessionActivityStatus } from "@shared/session-orchestration";
import type { SessionInfo } from "./types";
import { getSessionDisplayTitle } from "./session-list";
import { ownActivity, type SessionActivitySignals } from "./session-tree-status";

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

export type SessionProjectRoot = Pick<SessionInfo, "cwd" | "projectRoot">;

let roots: SessionProjectRoot[] = [];
let rootsSource: SessionInfo[] = snapshot;
let rootsKey = "[]";

function getSessionProjectRoots(): SessionProjectRoot[] {
  if (rootsSource === snapshot) return roots;
  rootsSource = snapshot;
  const next = snapshot.map(({ cwd, projectRoot }) => ({ cwd, projectRoot }));
  const key = JSON.stringify(next);
  if (key !== rootsKey) {
    rootsKey = key;
    roots = next;
  }
  return roots;
}

export function useSessionProjectRoots(): SessionProjectRoot[] {
  return useSyncExternalStore(subscribeSessionCatalog, getSessionProjectRoots, getSessionProjectRoots);
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

let activity: SessionActivitySignals | null = null;
const activityListeners = new Set<() => void>();

function notifyActivity(): void {
  for (const listener of activityListeners) listener();
}

export function publishSessionActivity(signals: SessionActivitySignals): void {
  activity = signals;
  notifyActivity();
}

export function clearSessionActivity(): void {
  if (!activity) return;
  activity = null;
  notifyActivity();
}

function subscribeSessionActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

export function useSessionActivity(sessionId: string | null): SessionActivityStatus | null {
  const read = useCallback(() => (activity && sessionId ? ownActivity(sessionId, activity) : null), [sessionId]);
  return useSyncExternalStore(subscribeSessionActivity, read, read);
}
