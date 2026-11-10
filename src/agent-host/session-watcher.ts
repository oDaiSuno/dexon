import fs from "node:fs";
import type { RpcServer } from "../contract/rpc";
import { invalidateAllowedRootsCache, setAllowedRootsWatcherHealthy } from "./file-access";
import { sessionIndex } from "./session-index";
import { emitIndexDelta, type IndexChange } from "./session-index-delta";
import { sessionsRoot as resolveSessionsRoot } from "./session-dir";
import { classifySessionWatchChange } from "./session-watch-policy";

const DEBOUNCE_MS = 300;
const MAX_WAIT_MS = 1000;
const UNKNOWN_REFRESH_INTERVAL_MS = 5000;
const REARM_BACKOFF_MS = [1000, 5000, 30_000];

export function startSessionWatcher(server: RpcServer): () => void {
  const root = resolveSessionsRoot();
  const files = new Set<string>();
  const subtrees = new Set<string>();
  let unknownPending = false;
  let lastUnknownAt = -Infinity;
  let stopped = false;
  let firstPendingAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: fs.FSWatcher | null = null;
  let rearmTimer: ReturnType<typeof setTimeout> | null = null;
  let rearmAttempts = 0;

  const flush = async () => {
    timer = null;
    firstPendingAt = null;
    const takeUnknown = unknownPending && Date.now() - lastUnknownAt >= UNKNOWN_REFRESH_INTERVAL_MS;
    if (takeUnknown) lastUnknownAt = Date.now();
    const changes: IndexChange[] = [
      ...[...files].map((filePath) => ({ kind: "file" as const, path: filePath })),
      ...[...subtrees].map((dir) => ({ kind: "subtree" as const, dir })),
      ...(takeUnknown ? [{ kind: "unknown" as const }] : []),
    ];
    files.clear();
    subtrees.clear();
    if (takeUnknown) unknownPending = false;
    if (unknownPending) schedule();
    if (changes.length === 0) return;
    try {
      const delta = await sessionIndex.apply(changes);
      if (!stopped) emitIndexDelta(server, delta);
    } catch (error) {
      invalidateAllowedRootsCache();
      console.error("[agent-host] session watcher refresh failed:", error);
      if (!stopped) emitIndexDelta(server, { changes: [], fullRefresh: true });
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    firstPendingAt ??= Date.now();
    let delay = Math.min(DEBOUNCE_MS, Math.max(0, firstPendingAt + MAX_WAIT_MS - Date.now()));
    if (unknownPending && files.size === 0 && subtrees.size === 0) {
      delay = Math.max(delay, lastUnknownAt + UNKNOWN_REFRESH_INTERVAL_MS - Date.now());
    }
    timer = setTimeout(() => {
      void flush();
    }, delay);
  };

  const rearm = () => {
    if (stopped || rearmTimer) return;
    const delay = REARM_BACKOFF_MS[Math.min(rearmAttempts++, REARM_BACKOFF_MS.length - 1)];
    rearmTimer = setTimeout(() => {
      rearmTimer = null;
      arm();
    }, delay);
  };

  const failed = (error: unknown) => {
    console.error("[agent-host] session watcher failed:", error);
    setAllowedRootsWatcherHealthy(false);
    invalidateAllowedRootsCache();
    emitIndexDelta(server, { changes: [], fullRefresh: true });
    rearm();
  };

  const arm = () => {
    try {
      fs.mkdirSync(root, { recursive: true });
      const candidate = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (stopped) return;
        const change = classifySessionWatchChange(root, filename);
        if (change.kind === "ignore") return;
        if (change.kind === "file") files.add(change.path);
        else if (change.kind === "subtree") subtrees.add(change.dir);
        else unknownPending = true;
        schedule();
      });
      watcher = candidate;
      candidate.on("error", (error) => {
        if (stopped || watcher !== candidate) return;
        watcher = null;
        candidate.close();
        failed(error);
      });
      setAllowedRootsWatcherHealthy(true);
      if (rearmAttempts > 0) {
        unknownPending = true;
        schedule();
      }
      rearmAttempts = 0;
    } catch (error) {
      failed(error);
    }
  };
  arm();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (rearmTimer) clearTimeout(rearmTimer);
    watcher?.close();
    setAllowedRootsWatcherHealthy(false);
  };
}

export function agentSessionsPath(): string {
  return resolveSessionsRoot();
}
