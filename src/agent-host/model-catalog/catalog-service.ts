import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { RpcError } from "../../contract/types.ts";
import { runIsolatedNodeJob } from "../isolated-node-job.ts";
import { MODEL_CATALOG_REFRESH_TIMEOUT_MS, ModelCatalogRefreshAbortedError } from "../model-runtime.ts";
import { catalogEpoch, type CatalogEpoch } from "./catalog-epoch.ts";
import {
  CATALOG_RESULT_MARKER,
  parseCatalogJobResult,
  type CatalogJob,
  type CatalogSnapshot,
} from "./catalog-protocol.ts";

export interface ModelCatalogOptions {
  readonly run?: (job: CatalogJob, signal: AbortSignal) => Promise<CatalogSnapshot>;
  readonly epochOf?: (cwd: string, agentDir: string, offline: boolean) => CatalogEpoch | Promise<CatalogEpoch>;
  readonly agentDir?: () => string;
  readonly offline?: () => boolean;
  readonly now?: () => number;
  readonly maxEntries?: number;
  readonly buildTimeoutMs?: number;
  readonly refreshTimeoutMs?: number;
  readonly failureBackoffMs?: number;
}

type ReadyCatalog = { readonly epoch: CatalogEpoch; readonly snapshot: CatalogSnapshot; readonly revision: number };
type CatalogEntry =
  | { readonly state: "ready"; readonly value: ReadyCatalog }
  | {
      readonly state: "building";
      readonly epoch: CatalogEpoch;
      readonly previous?: ReadyCatalog;
      readonly promise: Promise<CatalogSnapshot>;
    }
  | {
      readonly state: "failed";
      readonly epoch: CatalogEpoch;
      readonly previous?: ReadyCatalog;
      readonly error: unknown;
      readonly retryAt: number;
    };
type ActiveRefresh = {
  readonly requestId: string;
  readonly cwd: string;
  readonly controller: AbortController;
  abortKind?: "cancelled" | "replaced" | "timeout";
};

function workerEntryPath(): string {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  for (const file of [
    path.join(directory, "model-catalog-worker.mjs"),
    path.join(directory, "catalog-worker.ts"),
    path.resolve("src/agent-host/model-catalog/catalog-worker.ts"),
  ]) {
    if (existsSync(file)) return file;
  }
  throw new Error("Model catalog worker is unavailable");
}

function asPlainNodeEnv(job: CatalogJob): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_CODING_AGENT_DIR: job.agentDir };
  if (job.offline) env.PI_OFFLINE = "1";
  else delete env.PI_OFFLINE;
  return env;
}

async function runCatalogJob(job: CatalogJob, signal: AbortSignal, timeoutMs: number): Promise<CatalogSnapshot> {
  const entryPath = workerEntryPath();
  const result = parseCatalogJobResult(
    await runIsolatedNodeJob({
      entryPath,
      input: job,
      marker: CATALOG_RESULT_MARKER,
      timeoutMs,
      maxInputBytes: 64 * 1024,
      env: asPlainNodeEnv(job),
      cwd: path.dirname(entryPath),
      ipcLifeline: true,
      signal,
      label: "Model catalog worker",
      sanitizeStderr: () => "Model catalog worker failed",
    }),
  );
  if (!result.ok || result.snapshot.cwd !== job.cwd) throw new Error("Unable to build model catalog");
  return result.snapshot;
}

function previousOf(entry: CatalogEntry | undefined): ReadyCatalog | undefined {
  return entry?.state === "ready" ? entry.value : entry?.previous;
}

export class ModelCatalogService {
  private readonly options: ModelCatalogOptions;
  private readonly entries = new Map<string, CatalogEntry>();
  private readonly controllers = new Set<AbortController>();
  private readonly jobs = new Set<Promise<CatalogSnapshot>>();
  private readonly refreshes = new Map<string, ActiveRefresh>();
  private readonly refreshByCwd = new Map<string, ActiveRefresh>();
  private disposed = false;
  private revision = 0;

  constructor(options: ModelCatalogOptions = {}) {
    this.options = options;
  }

  async get(cwd: string, options: { fresh?: boolean } = {}): Promise<CatalogSnapshot> {
    this.assertActive();
    cwd = path.resolve(cwd);
    const job = this.job(cwd, "available");
    const epoch = await this.epoch(job);
    this.assertActive();
    const key = this.cacheKey(cwd, epoch);
    const entry = this.entries.get(key);
    if (entry) this.remember(key, entry);
    if (entry?.state === "ready") return entry.value.snapshot;
    const previous = previousOf(entry) ?? this.previous(cwd);
    const stale = !options.fresh && previous?.epoch.credentials === epoch.credentials ? previous.snapshot : undefined;
    if (entry?.state === "building" && entry.epoch.key === epoch.key) return stale ?? entry.promise;
    if (entry?.state === "failed" && entry.epoch.key === epoch.key && this.now() < entry.retryAt) {
      if (stale) return stale;
      throw entry.error;
    }
    const pending = this.build(job, epoch, previous);
    if (!stale) return pending;
    void pending.catch(() => undefined);
    return stale;
  }

  async refresh(cwd: string, requestId: string): Promise<CatalogSnapshot> {
    this.assertActive();
    cwd = path.resolve(cwd);
    this.abortRefresh(this.refreshes.get(requestId), "replaced");
    this.abortRefresh(this.refreshByCwd.get(cwd), "replaced");
    const active: ActiveRefresh = { cwd, requestId, controller: new AbortController() };
    this.refreshes.set(requestId, active);
    this.refreshByCwd.set(cwd, active);
    const previous = this.previous(cwd);
    const timeoutMs = this.options.refreshTimeoutMs ?? MODEL_CATALOG_REFRESH_TIMEOUT_MS;
    const timer = setTimeout(() => this.abortRefresh(active, "timeout"), timeoutMs);
    try {
      const job = this.job(cwd, "refresh");
      const epoch = await this.epoch(job);
      active.controller.signal.throwIfAborted();
      return await this.build(job, epoch, previous, active.controller.signal);
    } catch (error) {
      if (this.disposed) throw this.disposedError();
      if (!active.controller.signal.aborted) throw error;
      if (!previous) throw new ModelCatalogRefreshAbortedError(active.abortKind ?? "cancelled");
      return {
        ...previous.snapshot,
        status: {
          source: "network",
          refreshed: false,
          aborted: true,
          warnings:
            active.abortKind === "timeout"
              ? [
                  {
                    provider: "*",
                    code: "MODEL_REFRESH_TIMEOUT",
                    message: `Model catalog refresh timed out after ${timeoutMs}ms; cached models remain available.`,
                  },
                ]
              : [],
        },
      };
    } finally {
      clearTimeout(timer);
      if (this.refreshes.get(requestId) === active) this.refreshes.delete(requestId);
      if (this.refreshByCwd.get(cwd) === active) this.refreshByCwd.delete(cwd);
    }
  }

  cancelRefresh(requestId: string): boolean {
    const active = this.refreshes.get(requestId);
    if (!active || active.controller.signal.aborted) return false;
    this.abortRefresh(active, "cancelled");
    return true;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const active of this.refreshes.values()) this.abortRefresh(active, "cancelled");
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled(this.jobs);
    this.entries.clear();
  }

  private build(
    job: CatalogJob,
    epoch: CatalogEpoch,
    previous?: ReadyCatalog,
    externalSignal?: AbortSignal,
  ): Promise<CatalogSnapshot> {
    this.assertActive();
    const key = this.cacheKey(job.cwd, epoch);
    const revision = ++this.revision;
    const controller = new AbortController();
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    this.controllers.add(controller);
    const run =
      this.options.run ?? ((input, abort) => runCatalogJob(input, abort, this.options.buildTimeoutMs ?? 30_000));
    const promise = Promise.resolve()
      .then(() => run(job, signal))
      .then((snapshot) => {
        signal.throwIfAborted();
        if (this.entries.get(key) === entry)
          this.remember(key, { state: "ready", value: { epoch, snapshot, revision } });
        return snapshot;
      })
      .catch((error: unknown) => {
        if (this.entries.get(key) === entry) {
          if (signal.aborted || (job.kind === "refresh" && previous)) {
            this.entries.delete(key);
            if (previous) this.remember(this.cacheKey(job.cwd, previous.epoch), { state: "ready", value: previous });
          } else {
            this.remember(key, {
              state: "failed",
              epoch,
              previous,
              error,
              retryAt: this.now() + (this.options.failureBackoffMs ?? 15_000),
            });
          }
        }
        if (this.disposed) throw this.disposedError();
        throw error;
      })
      .finally(() => {
        this.controllers.delete(controller);
        this.jobs.delete(promise);
      });
    const entry: CatalogEntry = { state: "building", epoch, previous, promise };
    this.remember(key, entry);
    this.jobs.add(promise);
    return promise;
  }

  private job(cwd: string, kind: CatalogJob["kind"]): CatalogJob {
    return {
      kind,
      cwd,
      agentDir: path.resolve(this.options.agentDir?.() ?? getAgentDir()),
      offline: this.options.offline?.() ?? process.env.PI_OFFLINE !== undefined,
    };
  }

  private epoch(job: CatalogJob): CatalogEpoch | Promise<CatalogEpoch> {
    return (this.options.epochOf ?? catalogEpoch)(job.cwd, job.agentDir, job.offline);
  }

  private cacheKey(cwd: string, epoch: CatalogEpoch): string {
    return JSON.stringify([cwd, epoch.key]);
  }

  private previous(cwd: string): ReadyCatalog | undefined {
    let previous: ReadyCatalog | undefined;
    for (const entry of this.entries.values()) {
      const value = previousOf(entry);
      if (value?.snapshot.cwd === cwd && (!previous || value.revision > previous.revision)) previous = value;
    }
    return previous;
  }

  private remember(cacheKey: string, entry: CatalogEntry): void {
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    const maxEntries = this.options.maxEntries ?? 16;
    for (const [key, value] of this.entries) {
      if (this.entries.size <= maxEntries) break;
      if (value.state !== "building") this.entries.delete(key);
    }
  }

  private abortRefresh(active: ActiveRefresh | undefined, kind: NonNullable<ActiveRefresh["abortKind"]>): void {
    if (!active || active.controller.signal.aborted) return;
    active.abortKind = kind;
    active.controller.abort();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private disposedError(): RpcError {
    return new RpcError({ code: "CLOSED", message: "Model catalog service is disposed" });
  }

  private assertActive(): void {
    if (this.disposed) throw this.disposedError();
  }
}
