import { useSyncExternalStore } from "react";
import { formatTurnDuration } from "@/lib/process-flow";

const TICK_MS = 100;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  now = Date.now();
  for (const listener of listeners) listener();
}

function subscribeClock(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(tick, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function subscribeIdle(): () => void {
  return () => undefined;
}

function readClock(): number {
  return now;
}

export function useElapsedSince(startedAt: number | undefined): number | undefined {
  const live = startedAt !== undefined;
  const current = useSyncExternalStore(live ? subscribeClock : subscribeIdle, readClock, readClock);
  return live ? Math.max(0, current - startedAt) : undefined;
}

export function formatToolDuration(elapsedMs: number): string {
  const seconds = Math.max(0, elapsedMs) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : formatTurnDuration(seconds);
}
