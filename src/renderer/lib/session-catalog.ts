import { useCallback, useSyncExternalStore } from "react";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { useActiveEnvironment } from "./environment-registry";
import type { SessionActivityStatus } from "@shared/session-orchestration";
import type { SessionInfo } from "./types";
import { getSessionDisplayTitle } from "./session-list";
import { ownActivity, type SessionActivitySignals } from "./session-tree-status";

const catalogs = new Map<EnvironmentId, SessionInfo[]>();
let snapshot: SessionInfo[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function publishSessionCatalog(
  sessions: SessionInfo[],
  environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID,
): void {
  catalogs.set(environmentId, sessions);
  snapshot = [...catalogs.values()].flat();
  notify();
}

export function clearSessionCatalog(environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID): void {
  if (!catalogs.delete(environmentId)) return;
  snapshot = [...catalogs.values()].flat();
  notify();
}

const emptyCatalog: SessionInfo[] = [];

export function getSessionCatalog(environmentId?: EnvironmentId): SessionInfo[] {
  return environmentId === undefined ? snapshot : (catalogs.get(environmentId) ?? emptyCatalog);
}

export function subscribeSessionCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSessionCatalog(): SessionInfo[] {
  const environment = useActiveEnvironment();
  const read = useCallback(() => getSessionCatalog(environment.id), [environment.id]);
  return useSyncExternalStore(subscribeSessionCatalog, read, read);
}

export type SessionProjectRoot = Pick<SessionInfo, "cwd" | "projectRoot">;

let roots: SessionProjectRoot[] = [];
let rootsSource: SessionInfo[] = snapshot;
let rootsKey = "[]";
let rootsEnvironmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID;

function getSessionProjectRoots(environmentId: EnvironmentId): SessionProjectRoot[] {
  if (rootsSource === snapshot && rootsEnvironmentId === environmentId) return roots;
  rootsEnvironmentId = environmentId;
  rootsSource = snapshot;
  const next = (catalogs.get(environmentId) ?? []).map(({ cwd, projectRoot }) => ({ cwd, projectRoot }));
  const key = JSON.stringify(next);
  if (key !== rootsKey) {
    rootsKey = key;
    roots = next;
  }
  return roots;
}

export function useSessionProjectRoots(): SessionProjectRoot[] {
  const environment = useActiveEnvironment();
  const read = useCallback(() => getSessionProjectRoots(environment.id), [environment.id]);
  return useSyncExternalStore(subscribeSessionCatalog, read, read);
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

const activities = new Map<EnvironmentId, SessionActivitySignals>();
const activityListeners = new Set<() => void>();

function notifyActivity(): void {
  for (const listener of activityListeners) listener();
}

export function publishSessionActivity(
  signals: SessionActivitySignals,
  environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID,
): void {
  activities.set(environmentId, signals);
  notifyActivity();
}

export function clearSessionActivity(environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID): void {
  if (!activities.delete(environmentId)) return;
  notifyActivity();
}

function subscribeSessionActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

export function useSessionActivity(sessionId: string | null): SessionActivityStatus | null {
  const environment = useActiveEnvironment();
  const read = useCallback(() => {
    const activity = activities.get(environment.id);
    return activity && sessionId ? ownActivity(sessionId, activity) : null;
  }, [environment.id, sessionId]);
  return useSyncExternalStore(subscribeSessionActivity, read, read);
}
