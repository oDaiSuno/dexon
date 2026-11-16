import { useSyncExternalStore } from "react";
import type { HostStatus, PiBridge } from "@contract/desktop";

export interface PrimaryHostSnapshot {
  status: HostStatus;
  detail?: string;
}

let bridge: PiBridge | undefined;
let snapshot: PrimaryHostSnapshot = { status: "ready" };
let offStatus: (() => void) | undefined;
let revision = 0;
const listeners = new Set<() => void>();

function publish(next: PrimaryHostSnapshot): void {
  if (snapshot.status === next.status && snapshot.detail === next.detail) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function initialize(): void {
  const current = typeof window === "undefined" ? undefined : window.piBridge;
  if (bridge === current) return;
  offStatus?.();
  offStatus = undefined;
  bridge = current;
  const started = ++revision;
  snapshot = { status: "ready" };
  offStatus = current?.onHostStatus?.((next) => {
    if (bridge !== current) return;
    revision += 1;
    publish(next);
  });
  if (typeof current?.getHostStatus !== "function") return;
  void Promise.resolve(current.getHostStatus()).then(
    (status) => {
      if (bridge === current && revision === started && status) publish({ status });
    },
    () => {},
  );
}

export function getPrimaryHostSnapshot(): PrimaryHostSnapshot {
  initialize();
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  initialize();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrimaryHostSnapshot(): PrimaryHostSnapshot {
  return useSyncExternalStore(subscribe, getPrimaryHostSnapshot, getPrimaryHostSnapshot);
}
