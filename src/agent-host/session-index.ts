import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry, SessionInfo } from "../shared/types";
import { buildSessionInfoFromManager } from "./session-reader";
import { withSessionOrigin } from "./session-origin-store";
import { inheritProject, locateSessionProject, type LocatedProject, type ProjectLookupEntry } from "./session-project";
import { flushSessionProjects } from "./session-project-store";
import { sessionsRoot } from "./session-dir";
import { getProjectCacheRevision } from "../shared/worktree";
import { getAllowedRootsGeneration } from "../shared/allowed-roots";
import {
  fingerprint,
  readFingerprintOrNull,
  sameFingerprint,
  loadSessionIndexCache,
  saveSessionIndexCache,
  type Fingerprint,
  type PersistedIndexRecord,
} from "./session-index-cache";

const PROJECT_VIEW_TTL_MS = 60_000;
const YIELD_BUDGET_MS = 15;
const YIELD_PARSED_BATCH = 1;
const YIELD_REUSED_BATCH = 16;
export const RECENT_INDEX_REFRESH_TTL_MS = 2_000;

interface IndexRecord extends PersistedIndexRecord {
  located?: LocatedProject | null;
  projectResolved?: boolean;
}

type ResolvedRecord = IndexRecord & { info: SessionInfo };

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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function discoverSessionFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop()!;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) directories.push(candidate);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(candidate);
    }
  }
  return files;
}

export class SessionIndex {
  private readonly byPath = new Map<string, IndexRecord>();
  private readonly pathById = new Map<string, string>();
  private tail: Promise<unknown> = Promise.resolve();
  private refreshPromise: Promise<void> | null = null;
  private initialized = false;
  private cacheHydrated = false;
  private cacheDirty = false;
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

  private sessionsRoot(): string {
    return sessionsRoot();
  }

  private hydrateFromCache(root: string): void {
    if (this.cacheHydrated) return;
    this.cacheHydrated = true;
    for (const record of loadSessionIndexCache()) {
      const resolved = path.resolve(record.filePath);
      if (!resolved.startsWith(`${root}${path.sep}`) || !resolved.endsWith(".jsonl")) continue;
      this.byPath.set(resolved, {
        ...record,
        filePath: resolved,
        info: record.info ? { ...record.info, path: resolved } : null,
        projectResolved: false,
      });
    }
    this.rebuildDerivedState();
  }

  private flushCacheIfDirty(): void {
    if (!this.cacheDirty) return;
    saveSessionIndexCache(this.byPath.values());
    this.cacheDirty = false;
  }

  private canSkipRecentFullRefresh(maxAgeMs: number, files: string[]): boolean {
    const ageMs = Date.now() - this.lastFullRefreshAt;
    return (
      this.initialized &&
      maxAgeMs > 0 &&
      this.lastFullRefreshAt > 0 &&
      ageMs >= 0 &&
      ageMs < maxAgeMs &&
      this.lastRefreshRootsGeneration === getAllowedRootsGeneration() &&
      files.length === this.byPath.size &&
      files.every((filePath) => this.byPath.has(filePath))
    );
  }

  private rebuildDerivedState(): void {
    this.pathById.clear();
    const idByPath = new Map<string, string>();
    for (const record of this.byPath.values()) {
      if (record.info) {
        this.pathById.set(record.info.id, record.filePath);
        idByPath.set(record.filePath, record.info.id);
      }
    }
    for (const record of this.byPath.values()) {
      if (!record.info) continue;
      const parentSessionId = record.parentPath ? idByPath.get(record.parentPath) : undefined;
      record.info = withSessionOrigin({
        ...record.info,
        ...(parentSessionId ? { parentSessionId } : { parentSessionId: undefined }),
      });
    }
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(
      () => task(),
      () => task(),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private refreshProjectViews(): Promise<void> {
    return this.exclusive(async () => {
      const revision = getProjectCacheRevision();
      if (revision === this.projectRevision && Date.now() - this.projectViewsRefreshedAt < PROJECT_VIEW_TTL_MS) return;
      await this.resolveProjects([...this.byPath.values()]);
      this.projectRevision = revision;
      this.projectViewsRefreshedAt = Date.now();
    });
  }

  private async resolveProjects(records: IndexRecord[]): Promise<void> {
    const targets = records.filter((record): record is ResolvedRecord => Boolean(record.info));
    await Promise.all(
      targets.map(async (record) => {
        record.located = await locateSessionProject(record.info);
      }),
    );
    const lookup = (id: string): ProjectLookupEntry | undefined => {
      const record = this.byPath.get(this.pathById.get(id) ?? "");
      if (!record?.info) return undefined;
      return { located: record.located ?? null, parentSessionId: record.info.parentSessionId };
    };
    for (const record of targets) {
      const { worktreeBranch: _worktreeBranch, ...base } = record.info;
      const project = record.located ?? inheritProject(record.info.id, lookup) ?? { projectRoot: record.info.cwd };
      record.info = {
        ...base,
        projectRoot: project.projectRoot,
        ...(project.worktreeBranch ? { worktreeBranch: project.worktreeBranch } : {}),
      };
      record.projectResolved = true;
    }
    flushSessionProjects();
  }

  private async parsePath(filePath: string, currentFingerprint: Fingerprint): Promise<IndexRecord> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = attempt === 0 ? currentFingerprint : fingerprint(filePath);
      try {
        const manager = SessionManager.open(filePath);
        const entries = manager.getEntries() as unknown as SessionEntry[];
        const header = manager.getHeader();
        const info = await buildSessionInfoFromManager(filePath, manager, entries, { resolveProjectInfo: false });
        const after = fingerprint(filePath);
        if (!sameFingerprint(before, after)) {
          if (attempt === 0) continue;
          throw new Error("session changed during index parse");
        }
        return {
          filePath,
          fingerprint: after,
          info,
          parentPath: header?.parentSession,
          valid: Boolean(info),
        };
      } catch {
        if (attempt === 0) {
          const after = readFingerprintOrNull(filePath);
          if (after && !sameFingerprint(before, after)) continue;
        }
        return { filePath, fingerprint: before, info: null, valid: false };
      }
    }
    return { filePath, fingerprint: currentFingerprint, info: null, valid: false };
  }

  initialize(): Promise<void> {
    return this.refreshAll();
  }

  private async runFullScan(root: string, files: string[], startedAt: number): Promise<void> {
    const rootsGenAtStart = getAllowedRootsGeneration();
    this.hydrateFromCache(root);
    const discovered = new Set(files);
    let filesParsed = 0;
    let filesReused = 0;
    let filesRemoved = 0;
    let invalidFiles = 0;
    let parsedSinceYield = 0;
    let reusedSinceYield = 0;
    let lastYieldAt = performance.now();

    for (const existingPath of this.byPath.keys()) {
      if (!discovered.has(existingPath)) {
        this.byPath.delete(existingPath);
        filesRemoved += 1;
      }
    }
    for (const [fileIndex, filePath] of files.entries()) {
      let currentFingerprint: Fingerprint;
      try {
        currentFingerprint = fingerprint(filePath);
      } catch {
        continue;
      }
      const existing = this.byPath.get(filePath);
      if (existing && sameFingerprint(existing.fingerprint, currentFingerprint)) {
        filesReused += 1;
        reusedSinceYield += 1;
        if (!existing.valid) invalidFiles += 1;
      } else {
        const record = await this.parsePath(filePath, currentFingerprint);
        this.byPath.set(filePath, record);
        filesParsed += 1;
        parsedSinceYield += 1;
        if (!record.valid) invalidFiles += 1;
      }
      if (
        fileIndex < files.length - 1 &&
        (parsedSinceYield >= YIELD_PARSED_BATCH ||
          reusedSinceYield >= YIELD_REUSED_BATCH ||
          performance.now() - lastYieldAt >= YIELD_BUDGET_MS)
      ) {
        await yieldToEventLoop();
        parsedSinceYield = 0;
        reusedSinceYield = 0;
        lastYieldAt = performance.now();
      }
    }
    this.rebuildDerivedState();
    await this.resolveProjects([...this.byPath.values()].filter((record) => !record.projectResolved));
    if (filesParsed > 0 || filesRemoved > 0) {
      this.projectViewsRefreshedAt = 0;
      this.cacheDirty = true;
    }
    this.flushCacheIfDirty();
    this.initialized = true;
    this.lastFullRefreshAt = Date.now();
    this.lastRefreshRootsGeneration = rootsGenAtStart;
    this.metrics = {
      filesDiscovered: files.length,
      filesParsed,
      filesReused,
      invalidFiles,
      totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
    };
  }

  refreshAll(options: RefreshAllOptions = {}): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.exclusive(async () => {
      const startedAt = performance.now();
      const root = this.sessionsRoot();
      const files = discoverSessionFiles(root);
      if (this.canSkipRecentFullRefresh(options.maxAgeMs ?? 0, files)) {
        this.metrics = {
          filesDiscovered: files.length,
          filesParsed: 0,
          filesReused: 0,
          invalidFiles: [...this.byPath.values()].filter((record) => !record.valid).length,
          totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
        };
        return;
      }
      await this.runFullScan(root, files, startedAt);
    }).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  refreshPath(filePath: string): Promise<SessionInfo | null> {
    return this.exclusive(async () => {
      const resolved = path.resolve(filePath);
      const root = this.sessionsRoot();
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
      this.hydrateFromCache(root);
      if (!resolved.endsWith(".jsonl") || !existsSync(resolved)) {
        this.removePath(resolved);
        return null;
      }
      let currentFingerprint: Fingerprint;
      try {
        currentFingerprint = fingerprint(resolved);
      } catch {
        this.removePath(resolved);
        return null;
      }
      const existing = this.byPath.get(resolved);
      if (existing && sameFingerprint(existing.fingerprint, currentFingerprint)) {
        if (!existing.projectResolved) await this.resolveProjects([existing]);
        return existing.info;
      }
      const startedAt = performance.now();
      const record = await this.parsePath(resolved, currentFingerprint);
      this.byPath.set(resolved, record);
      this.rebuildDerivedState();
      await this.resolveProjects([record]);
      this.cacheDirty = true;
      this.flushCacheIfDirty();
      this.initialized = true;
      this.metrics = {
        filesDiscovered: 1,
        filesParsed: 1,
        filesReused: 0,
        invalidFiles: record.valid ? 0 : 1,
        totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
      };
      return record.info;
    });
  }

  removePath(filePath: string): SessionInfo | null {
    this.hydrateFromCache(this.sessionsRoot());
    const resolved = path.resolve(filePath);
    const existing = this.byPath.get(resolved);
    if (!existing) return null;
    this.byPath.delete(resolved);
    this.rebuildDerivedState();
    this.cacheDirty = true;
    this.flushCacheIfDirty();
    return existing.info;
  }

  getByPath(filePath: string): SessionInfo | null {
    return this.byPath.get(path.resolve(filePath))?.info ?? null;
  }

  async getAll(): Promise<SessionInfo[]> {
    if (!this.initialized) await this.initialize();
    await this.refreshProjectViews();
    return [...this.byPath.values()]
      .flatMap((record) => (record.info ? [record.info] : []))
      .sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
  }

  async resolvePath(sessionId: string): Promise<string | null> {
    if (!this.initialized) await this.initialize();
    const known = this.pathById.get(sessionId);
    if (known) return known;
    await this.refreshAll();
    return this.pathById.get(sessionId) ?? null;
  }

  getMetrics(): SessionIndexMetrics {
    return { ...this.metrics };
  }
}

export const sessionIndex = new SessionIndex();
