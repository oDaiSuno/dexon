import { mkdirSync } from "node:fs";
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
  const listeners = new Set<(change: AutomationChange) => void>();
  let status: RuntimeStatus = { kind: "stopped" };
  let store: AutomationStore | null = null;
  let pool: DriverPool | null = null;
  let scheduler: AutomationScheduler | null = null;
  let executors: ReturnType<typeof createStepExecutors> | null = null;
  let probeScripts: ReturnType<typeof createScriptAction> | null = null;
  let queued = false;
  let stopping: Promise<void> | null = null;
  function available(): AutomationStore {
    if (!store || status.kind !== "ready")
      throw new RpcError({
        code: "UNAVAILABLE",
        message: status.kind === "unavailable" ? status.reason : "Automation runtime is not ready",
      });
    return store;
  }
  function fail(error: unknown): void {
    status = { kind: "unavailable", reason: error instanceof Error ? error.message : "Automation runtime failed" };
    deps.onError?.(error);
  }
  function changed(change: AutomationChange): void {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {}
    }
    if (queued || status.kind !== "ready") return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (status.kind !== "ready") return;
      try {
        pool!.pump();
        scheduler!.rearm();
      } catch (error) {
        fail(error);
      }
    });
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
        mkdirSync(deps.dataDirectory, { recursive: true });
        const opened = AutomationStore.open(path.join(deps.dataDirectory, "automation.sqlite"), clock);
        if (!(opened instanceof AutomationStore)) {
          status = { kind: "unavailable", reason: opened.detail };
          return;
        }
        store = opened;
        const execDeps = { ...deps, fetch: deps.fetch ?? fetch };
        executors = createStepExecutors(execDeps);
        probeScripts = createScriptAction(deps.secrets);
        pool = new DriverPool(store, executors, clock, {
          maxConcurrentDrivers: limits.maxConcurrentDrivers,
          maxOutputBytes: limits.maxOutputBytes,
          onError: fail,
        });
        scheduler = new AutomationScheduler(
          store,
          createWatchProbe({ ...execDeps, store, script: probeScripts, maxOutputBytes: limits.maxOutputBytes }),
          clock,
          { maxSleepMs: limits.maxSchedulerSleepMs, resumeGraceMs: limits.resumeGraceMs, onError: fail },
        );
        store.recover(clock.now());
        store.onCommit((change) =>
          changed({
            taskIds: "taskId" in change ? [change.taskId] : [],
            runIds: "runId" in change ? [change.runId] : [],
            inboxChanged: "runId" in change,
          }),
        );
        status = { kind: "ready" };
        scheduler.start();
        pool.pump();
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
      const db = available();
      assertTaskSpec(spec);
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
      available().deleteTask(taskId);
    },
    listTasks(query = {}) {
      return available()
        .listTasks()
        .filter((task) => query.cwd === undefined || task.cwd === query.cwd);
    },
    getTask(taskId, revision) {
      const db = available();
      const task = db.getTask(taskId);
      const result = task ? db.getTaskRevision(taskId, revision ?? task.currentRevision) : null;
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
      return available().listRuns(query);
    },
    getRun(runId) {
      const run = available().getRun(runId);
      if (!run) throw new RpcError({ code: "NOT_FOUND", message: "Automation run not found" });
      return run;
    },
    listInbox() {
      return available().listInbox();
    },
    resolveInbox(request) {
      return available().resolveInbox(request);
    },
    emitSignal(taskId, emit) {
      return { woke: available().emitSignal(taskId, emit).woke.length };
    },
    async tickNow() {
      available();
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
