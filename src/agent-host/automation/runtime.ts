import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { RpcError } from "../../contract/types";
import { AutomationStore, systemClock } from "./store";
import { assertTaskSpec } from "./spec/validate";
import { DriverPool } from "./driver-pool";
import { AutomationScheduler } from "./scheduler";
import { createStepExecutors } from "./exec/executors";
import { createScriptAction } from "./exec/script-action";
import { createWatchProbe } from "./exec/watch-probe";
import type { AutomationRuntimeDeps, AutomationRuntime, RuntimeStatus, RuntimeLimits, AutomationChange } from "./types";

const defaults: RuntimeLimits = {
  maxConcurrentDrivers: 4,
  maxSchedulerSleepMs: 60000,
  resumeGraceMs: 15000,
  shutdownGraceMs: 5000,
  maxOutputBytes: 256 * 1024,
};
export function createAutomationRuntime(deps: AutomationRuntimeDeps): AutomationRuntime {
  const limits = { ...defaults, ...deps.limits };
  const clock = deps.clock ?? systemClock;
  const dbFile = path.join(deps.dataDirectory, "automation.sqlite");
  const listeners = new Set<(change: AutomationChange) => void>();
  let status: RuntimeStatus = { kind: "stopped" };
  let store: AutomationStore | null = null;
  let pool: DriverPool | null = null;
  let scheduler: AutomationScheduler | null = null;
  let executors: ReturnType<typeof createStepExecutors> | null = null;
  let probeScripts: ReturnType<typeof createScriptAction> | null = null;
  let queued = false;
  let stopping: Promise<void> | null = null;
  function assertReady(): void {
    if (status.kind !== "ready")
      throw new RpcError({
        code: "UNAVAILABLE",
        message: status.kind === "unavailable" ? status.reason : "Automation runtime is not ready",
      });
  }
  function reportError(error: unknown): void {
    deps.onError?.(error);
  }
  function fail(error: unknown): void {
    status = { kind: "unavailable", reason: error instanceof Error ? error.message : "Automation runtime failed" };
    reportError(error);
  }
  function changed(change: AutomationChange): void {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {}
    }
    if (queued || status.kind !== "ready" || !pool || !scheduler) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (status.kind !== "ready" || !pool || !scheduler) return;
      try {
        pool.pump();
        scheduler.rearm();
      } catch (error) {
        reportError(error);
      }
    });
  }
  function openStore(): AutomationStore {
    if (store) return store;
    mkdirSync(deps.dataDirectory, { recursive: true });
    const opened = AutomationStore.open(dbFile, clock);
    if (!(opened instanceof AutomationStore)) {
      status = { kind: "unavailable", reason: opened.detail };
      throw new RpcError({ code: "UNAVAILABLE", message: opened.detail });
    }
    store = opened;
    const execDeps = { ...deps, fetch: deps.fetch ?? fetch };
    executors = createStepExecutors(execDeps);
    probeScripts = createScriptAction(deps.secrets);
    pool = new DriverPool(store, executors, clock, {
      maxConcurrentDrivers: limits.maxConcurrentDrivers,
      maxOutputBytes: limits.maxOutputBytes,
      onError: reportError,
    });
    scheduler = new AutomationScheduler(
      store,
      createWatchProbe({ ...execDeps, store, script: probeScripts, maxOutputBytes: limits.maxOutputBytes }),
      clock,
      { maxSleepMs: limits.maxSchedulerSleepMs, resumeGraceMs: limits.resumeGraceMs, onError: reportError },
    );
    store.recover(clock.now());
    store.onCommit((change) =>
      changed({
        taskIds: "taskId" in change ? [change.taskId] : [],
        runIds: "runId" in change ? [change.runId] : [],
        inboxChanged: "runId" in change,
      }),
    );
    scheduler.start();
    pool.pump();
    return store;
  }
  function available(): AutomationStore {
    assertReady();
    return openStore();
  }
  function peekStore(): AutomationStore | null {
    assertReady();
    if (store) return store;
    if (!existsSync(dbFile)) return null;
    return openStore();
  }
  const runtime: AutomationRuntime = {
    status: () => ({ ...status }),
    async start() {
      if (status.kind === "ready") return;
      if (stopping) await stopping;
      status = { kind: "starting" };
      try {
        for (const [key, value] of Object.entries(limits))
          if (!Number.isSafeInteger(value) || value < (key.endsWith("GraceMs") ? 0 : 1))
            throw new Error(`Invalid automation limit: ${key}`);
        status = { kind: "ready" };
        if (existsSync(dbFile)) openStore();
      } catch (error) {
        fail(error);
      }
    },
    stop() {
      stopping ??= (async () => {
        status = { kind: "stopped" };
        await scheduler?.stop();
        await pool?.shutdown(limits.shutdownGraceMs);
        await executors?.shutdown();
        await probeScripts?.shutdown();
        store?.close();
        store = null;
        pool = null;
        scheduler = null;
      })().finally(() => {
        stopping = null;
      });
      return stopping;
    },
    async saveTask(spec) {
      assertReady();
      assertTaskSpec(spec);
      const db = available();
      const task = db.saveTask(spec);
      const revision = db.getTaskRevision(task.id, task.currentRevision)!;
      return {
        task,
        revision: task.currentRevision,
        planHash: revision.planHash,
        requiredGrant: revision.requiredGrant,
      };
    },
    enableTask(request) {
      return available().enableTask(request.taskId, request.revision, request.planHash, request);
    },
    disableTask(taskId) {
      return available().disableTask(taskId);
    },
    deleteTask(taskId) {
      peekStore()?.deleteTask(taskId);
    },
    listTasks(query = {}) {
      return (
        peekStore()
          ?.listTasks()
          .filter((task) => query.cwd === undefined || task.cwd === query.cwd) ?? []
      );
    },
    getTask(taskId, revision) {
      const db = peekStore();
      const task = db?.getTask(taskId);
      const result = db && task ? db.getTaskRevision(taskId, revision ?? task.currentRevision) : null;
      if (!result) throw new RpcError({ code: "NOT_FOUND", message: "Automation task revision not found" });
      return result;
    },
    startRun(request) {
      return available().fire(request);
    },
    async cancelRun(runId) {
      const db = available();
      await pool!.cancelRun(runId);
      return db.getRun(runId)!;
    },
    listRuns(query = {}) {
      return peekStore()?.listRuns(query) ?? [];
    },
    getRun(runId) {
      const run = peekStore()?.getRun(runId);
      if (!run) throw new RpcError({ code: "NOT_FOUND", message: "Automation run not found" });
      return run;
    },
    listInbox() {
      return peekStore()?.listInbox() ?? [];
    },
    resolveInbox(request) {
      return available().resolveInbox(request);
    },
    emitSignal(taskId, emit) {
      return { woke: available().emitSignal(taskId, emit).woke.length };
    },
    async tickNow() {
      if (!peekStore()) return;
      await scheduler!.tickNow();
      pool!.pump();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return runtime;
}
