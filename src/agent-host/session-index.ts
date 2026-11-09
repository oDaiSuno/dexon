import path from "node:path";
import type { SessionInfo } from "../shared/types";
import { getProjectCacheRevision } from "../shared/worktree";
import { getAllowedRootsGeneration, invalidateAllowedRootsCache } from "../shared/allowed-roots";
import { desktopUserDataPath } from "./desktop-state-file";
import { sessionsRoot } from "./session-dir";
import {
  readFingerprintOrNull,
  sameFingerprint,
  type Fingerprint,
  type PersistedIndexRecord,
} from "./session-index-cache";
import { SessionIndexState } from "./session-index-state";
import { SessionIndexJournal } from "./session-index-journal";
import { type EntryChange, type IndexChange, type IndexDelta, rootsChanged } from "./session-index-delta";
import {
  discoverSessionFiles,
  entryFromLiveSession,
  isUnderRoot,
  parseSessionFile,
  planReconcile,
  type LiveSessionSource,
  type SavedSessionHint,
} from "./session-index-scan";
import { locateSessionProject } from "./session-project";
import { flushSessionProjects } from "./session-project-store";

const PROJECT_VIEW_TTL_MS = 60_000;
export const RECENT_INDEX_REFRESH_TTL_MS = 2_000;

export interface RefreshAllOptions {
  maxAgeMs?: number;
}

export interface SessionIndexMetrics {
  filesDiscovered: number;
  filesParsed: number;
  filesReused: number;
  invalidFiles: number;
  totalMs: number;
}

export class SessionIndex {
  private readonly state = new SessionIndexState();
  private readonly savedHints = new Map<string, SavedSessionHint>();
  private readonly published = new Map<string, { fingerprint: Fingerprint; info: SessionInfo }>();
  private readonly removedBeforeHydration = new Set<string>();
  private journal: SessionIndexJournal | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private refreshPromise: Promise<void> | null = null;
  private hydrated = false;
  private hydrating = false;
  private initialized = false;
  private snapshotReady = false;
  private lastFullRefreshAt = 0;
  private lastRefreshRootsGeneration = -1;
  private projectRevision = -1;
  private projectViewsRefreshedAt = 0;
  private metrics: SessionIndexMetrics = {
    filesDiscovered: 0,
    filesParsed: 0,
    filesReused: 0,
    invalidFiles: 0,
    totalMs: 0,
  };

  private ensureJournal(): SessionIndexJournal {
    return (this.journal ??= new SessionIndexJournal(desktopUserDataPath()));
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const journal = this.ensureJournal();
    this.hydrating = true;
    try {
      this.installRecords(await journal.load(), journal);
    } finally {
      this.hydrating = false;
    }
  }

  private installRecords(records: PersistedIndexRecord[], journal: SessionIndexJournal): void {
    const root = sessionsRoot();
    for (const record of records) {
      const resolved = path.resolve(record.filePath);
      if (!isUnderRoot(resolved, root) || !resolved.endsWith(".jsonl") || this.removedBeforeHydration.has(resolved))
        continue;
      this.state.upsert({
        ...record,
        filePath: resolved,
        info: record.info ? { ...record.info, path: resolved } : null,
      });
    }
    this.snapshotReady = journal.hasSnapshot;
    this.hydrated = true;
    for (const removed of this.removedBeforeHydration) journal.remove(removed);
    this.removedBeforeHydration.clear();
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async preserveSnapshot<T>(task: () => Promise<T>, fallback: () => T): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (!this.snapshotReady) throw error;
      console.error("[agent-host] session index refresh failed; retaining last snapshot:", error);
      return fallback();
    }
  }

  recordSavedSession(filePath: string, source: LiveSessionSource): () => void {
    const resolved = path.resolve(filePath);
    const current = readFingerprintOrNull(resolved);
    const sessionId = source.getHeader()?.id;
    if (!current || !sessionId || !isUnderRoot(resolved, sessionsRoot())) return () => undefined;
    const hint: SavedSessionHint = { path: resolved, fingerprint: current, sessionId, source };
    this.savedHints.set(resolved, hint);
    return () => {
      if (this.savedHints.get(resolved) === hint) this.savedHints.delete(resolved);
    };
  }

  private savedHint(filePath: string, current: Fingerprint): SavedSessionHint | undefined {
    const hint = this.savedHints.get(filePath);
    return hint && sameFingerprint(hint.fingerprint, current) && hint.source.getHeader()?.id === hint.sessionId
      ? hint
      : undefined;
  }

  private async readEntry(filePath: string, current: Fingerprint): Promise<PersistedIndexRecord> {
    const hint = this.savedHint(filePath, current);
    if (hint) {
      const record = await entryFromLiveSession(hint);
      const after = readFingerprintOrNull(filePath);
      if (after && sameFingerprint(current, after) && this.savedHint(filePath, after) === hint) return record;
    }
    return parseSessionFile(filePath, readFingerprintOrNull(filePath) ?? current);
  }

  private cause(filePath: string, current: Fingerprint): EntryChange["cause"] {
    return this.savedHint(filePath, current) ? "live-append" : "external";
  }

  private async locate(records: readonly PersistedIndexRecord[]): Promise<void> {
    const locations = await Promise.all(
      records.map(async (record) => ({
        filePath: record.filePath,
        located: record.info ? await locateSessionProject(record.info) : null,
      })),
    );
    for (const location of locations) this.state.locate(location.filePath, location.located);
    flushSessionProjects();
  }

  private canSkip(maxAgeMs: number, files: readonly string[]): boolean {
    const age = Date.now() - this.lastFullRefreshAt;
    return (
      this.initialized &&
      maxAgeMs > 0 &&
      age >= 0 &&
      age < maxAgeMs &&
      this.lastRefreshRootsGeneration === getAllowedRootsGeneration() &&
      files.length === this.state.size &&
      files.every((filePath) => this.state.entry(filePath))
    );
  }

  private async reconcile(root: string, files: readonly string[], attempt = 0): Promise<EntryChange[]> {
    if (attempt > 1) throw new Error("Session index changed repeatedly during reconciliation");
    const started = performance.now();
    const revision = this.state.revision;
    const plan = await planReconcile(root, files, this.state, (filePath, current) => this.readEntry(filePath, current));
    if (revision !== this.state.revision) return this.reconcile(root, await discoverSessionFiles(root), attempt + 1);
    const unresolved = [...this.state.entries()].filter(
      (record) => isUnderRoot(record.filePath, root) && record.located === undefined,
    );
    const locations = await Promise.all(
      [...unresolved, ...plan.upserts].map(async (record) => ({
        filePath: record.filePath,
        located: record.info ? await locateSessionProject(record.info) : null,
      })),
    );
    if (revision !== this.state.revision) return this.reconcile(root, await discoverSessionFiles(root), attempt + 1);
    const changes: EntryChange[] = [];
    for (const filePath of plan.removals) {
      changes.push({ filePath, before: this.state.info(filePath), after: null, cause: "external" });
      this.state.remove(filePath);
    }
    for (const record of plan.upserts) {
      changes.push({
        filePath: record.filePath,
        before: this.state.info(record.filePath),
        after: null,
        cause: this.cause(record.filePath, record.fingerprint),
      });
      this.state.upsert(record);
    }
    for (const location of locations) this.state.locate(location.filePath, location.located);
    for (const change of changes) change.after = this.state.info(change.filePath);
    flushSessionProjects();
    if (rootsChanged(changes)) invalidateAllowedRootsCache();
    if (root === sessionsRoot()) {
      this.snapshotReady = true;
      this.initialized = true;
    }
    this.metrics = {
      filesDiscovered: plan.filesDiscovered,
      filesParsed: plan.filesParsed,
      filesReused: plan.filesReused,
      invalidFiles: this.state.invalidCount,
      totalMs: Math.round((performance.now() - started) * 10) / 10,
    };
    const journal = this.ensureJournal();
    await journal.writeChanges(plan.upserts, plan.removals);
    journal.maybeCompact(this.state.entries(), this.state.size);
    return changes;
  }

  initialize(): Promise<void> {
    return this.refreshAll();
  }

  refreshAll(options: RefreshAllOptions = {}): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.exclusive(() =>
      this.preserveSnapshot(
        async () => {
          await this.hydrate();
          const root = sessionsRoot();
          const rootsGeneration = getAllowedRootsGeneration();
          const files = await discoverSessionFiles(root);
          if (this.canSkip(options.maxAgeMs ?? 0, files)) {
            this.metrics = {
              filesDiscovered: files.length,
              filesParsed: 0,
              filesReused: 0,
              invalidFiles: this.state.invalidCount,
              totalMs: 0,
            };
            return;
          }
          const changes = await this.reconcile(root, files);
          this.lastFullRefreshAt = Date.now();
          this.lastRefreshRootsGeneration = rootsGeneration + (rootsChanged(changes) ? 1 : 0);
        },
        () => undefined,
      ),
    ).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async refreshFile(filePath: string): Promise<EntryChange | null> {
    const resolved = path.resolve(filePath);
    if (!isUnderRoot(resolved, sessionsRoot()) || !resolved.endsWith(".jsonl")) return null;
    const before = this.state.info(resolved);
    const current = readFingerprintOrNull(resolved);
    if (!current) {
      if (!this.state.entry(resolved)) return null;
      this.removePath(resolved);
      return { filePath: resolved, before, after: null, cause: "external" };
    }
    const existing = this.state.entry(resolved);
    if (existing && sameFingerprint(existing.fingerprint, current)) {
      if (existing.located === undefined) await this.locate([existing]);
      return null;
    }
    const started = performance.now();
    const record = await this.readEntry(resolved, current);
    const located =
      existing?.info?.cwd === record.info?.cwd && existing?.located !== undefined
        ? existing.located
        : record.info
          ? await locateSessionProject(record.info)
          : null;
    if (!readFingerprintOrNull(resolved)) {
      this.removePath(resolved);
      return { filePath: resolved, before, after: null, cause: "external" };
    }
    this.state.upsert(record);
    this.state.locate(resolved, located);
    const change: EntryChange = {
      filePath: resolved,
      before,
      after: this.state.info(resolved),
      cause: this.cause(resolved, record.fingerprint),
    };
    if (rootsChanged([change])) invalidateAllowedRootsCache();
    flushSessionProjects();
    this.metrics = {
      filesDiscovered: 1,
      filesParsed: 1,
      filesReused: 0,
      invalidFiles: record.valid ? 0 : 1,
      totalMs: Math.round((performance.now() - started) * 10) / 10,
    };
    const journal = this.ensureJournal();
    await journal.put(record);
    journal.maybeCompact(this.state.entries(), this.state.size);
    return change;
  }

  refreshPath(filePath: string): Promise<SessionInfo | null> {
    return this.exclusive(() =>
      this.preserveSnapshot(
        async () => {
          await this.hydrate();
          await this.refreshFile(filePath);
          return this.getByPath(filePath);
        },
        () => this.getByPath(filePath),
      ),
    );
  }

  private publishChange(filePath: string, change: EntryChange | null): EntryChange | null {
    const record = this.state.entry(filePath);
    const previous = this.published.get(filePath);
    const after = this.state.info(filePath);
    if (!change) {
      if (record && previous && sameFingerprint(record.fingerprint, previous.fingerprint)) return null;
      if (!record && !previous) return null;
      change = {
        filePath,
        before: previous?.info ?? after,
        after,
        cause: record ? this.cause(filePath, record.fingerprint) : "external",
      };
    }
    change.after = after;
    if (record && after) this.published.set(filePath, { fingerprint: record.fingerprint, info: after });
    else this.published.delete(filePath);
    return change;
  }

  apply(changes: readonly IndexChange[]): Promise<IndexDelta> {
    return this.exclusive(() =>
      this.preserveSnapshot(
        async () => {
          await this.hydrate();
          const candidates = new Map<string, EntryChange | null>();
          const delta: IndexDelta = { changes: [], fullRefresh: false };
          for (const change of changes) {
            if (change.kind === "file") {
              const filePath = path.resolve(change.path);
              candidates.set(filePath, await this.refreshFile(filePath));
            } else {
              const root = change.kind === "unknown" ? sessionsRoot() : path.resolve(change.dir);
              if (root !== sessionsRoot() && !isUnderRoot(root, sessionsRoot())) continue;
              const files = await discoverSessionFiles(root);
              for (const entry of await this.reconcile(root, files)) candidates.set(entry.filePath, entry);
              if (change.kind === "unknown") delta.fullRefresh = true;
              else for (const filePath of files) if (!candidates.has(filePath)) candidates.set(filePath, null);
            }
          }
          for (const [filePath, entry] of candidates) {
            const change = this.publishChange(filePath, entry);
            if (change) delta.changes.push(change);
          }
          return delta;
        },
        () => ({ changes: [], fullRefresh: true }),
      ),
    );
  }

  removePath(filePath: string): SessionInfo | null {
    if (!this.hydrated && !this.hydrating) {
      const journal = this.ensureJournal();
      this.installRecords(journal.loadSync(), journal);
    }
    const resolved = path.resolve(filePath);
    const previous = this.state.info(resolved);
    if (!this.hydrated) this.removedBeforeHydration.add(resolved);
    if (!this.state.entry(resolved)) return previous;
    this.state.remove(resolved);
    this.savedHints.delete(resolved);
    this.journal?.remove(resolved);
    this.journal?.maybeCompact(this.state.entries(), this.state.size);
    invalidateAllowedRootsCache();
    return previous;
  }

  getByPath(filePath: string): SessionInfo | null {
    return this.state.info(path.resolve(filePath));
  }

  getPathById(sessionId: string): string | null {
    return this.state.pathOf(sessionId) ?? null;
  }

  getById(sessionId: string): SessionInfo | null {
    return this.state.info(this.state.pathOf(sessionId) ?? "");
  }

  async getAll(): Promise<SessionInfo[]> {
    if (!this.initialized) await this.initialize();
    await this.exclusive(() =>
      this.preserveSnapshot(
        async () => {
          const revision = getProjectCacheRevision();
          if (revision === this.projectRevision && Date.now() - this.projectViewsRefreshedAt < PROJECT_VIEW_TTL_MS)
            return;
          await this.locate([...this.state.entries()]);
          this.projectRevision = revision;
          this.projectViewsRefreshedAt = Date.now();
        },
        () => undefined,
      ),
    );
    return this.state.list();
  }

  async resolvePath(sessionId: string): Promise<string | null> {
    if (!this.initialized) await this.initialize();
    const known = this.state.pathOf(sessionId);
    if (known) return known;
    await this.refreshAll();
    return this.state.pathOf(sessionId) ?? null;
  }

  invalidateAllowedRootsCache(): void {
    invalidateAllowedRootsCache();
  }

  getMetrics(): SessionIndexMetrics {
    return { ...this.metrics };
  }

  async flush(): Promise<void> {
    await this.tail;
    await this.journal?.flush();
  }
}

export const sessionIndex = new SessionIndex();
