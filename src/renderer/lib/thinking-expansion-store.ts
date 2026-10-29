import { useMemo, useRef, useSyncExternalStore } from "react";

export class ThinkingExpansionStore {
  private readonly values = new Map<string, boolean>();
  private readonly listeners = new Set<() => void>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (key: string): boolean | undefined => this.values.get(key);

  toggle(key: string, shown: boolean): void {
    this.values.delete(key);
    this.values.set(key, !shown);
    this.prune();
    this.emit();
  }

  adopt(fromEntryId: string, toEntryId: string): void {
    let moved = false;
    for (const [key, value] of [...this.values]) {
      if (!key.split(":").includes(fromEntryId)) continue;
      this.values.delete(key);
      this.values.set(replacePart(key, fromEntryId, toEntryId), value);
      moved = true;
    }
    if (moved) this.emit();
  }

  clear(): void {
    if (this.values.size === 0) return;
    this.values.clear();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private prune(): void {
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }
}

export function useExpansion(
  store: ThinkingExpansionStore | undefined,
  key: string,
): [boolean | undefined, (shown: boolean) => void] {
  const fallbackRef = useRef<ThinkingExpansionStore | null>(null);
  if (!fallbackRef.current) fallbackRef.current = new ThinkingExpansionStore();
  const target = store ?? fallbackRef.current;
  const read = useMemo(() => () => target.getSnapshot(key), [key, target]);
  const value = useSyncExternalStore(target.subscribe, read, read);
  return [value, (shown: boolean) => target.toggle(key, shown)];
}

function replacePart(key: string, from: string, to: string): string {
  return key
    .split(":")
    .map((part) => (part === from ? to : part))
    .join(":");
}

export class ThinkingExpansionRegistry {
  private readonly stores = new Map<string, ThinkingExpansionStore>();
  private readonly maxSessions: number;
  private readonly maxEntriesPerSession: number;

  constructor(maxSessions = 20, maxEntriesPerSession = 500) {
    this.maxSessions = maxSessions;
    this.maxEntriesPerSession = maxEntriesPerSession;
  }

  get(sessionId: string): ThinkingExpansionStore {
    const existing = this.stores.get(sessionId);
    if (existing) {
      this.stores.delete(sessionId);
      this.stores.set(sessionId, existing);
      return existing;
    }
    const store = new ThinkingExpansionStore(this.maxEntriesPerSession);
    this.stores.set(sessionId, store);
    while (this.stores.size > this.maxSessions) {
      const oldestSessionId = this.stores.keys().next().value;
      if (oldestSessionId === undefined) break;
      this.stores.get(oldestSessionId)?.clear();
      this.stores.delete(oldestSessionId);
    }
    return store;
  }

  delete(sessionId: string): void {
    this.stores.get(sessionId)?.clear();
    this.stores.delete(sessionId);
  }
}
