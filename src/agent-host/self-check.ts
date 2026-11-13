import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  isCleanManagedStopState,
  type HostSelfCheckReport,
  type HostSelfCheckProbe,
} from "../shared/host-self-check.ts";
import type { ModelsListResult } from "../contract/types.ts";
import type { PluginsResponse } from "../shared/api-types.ts";
import type { PluginActionBody } from "./plugin-worker-protocol.ts";
import type { ManagedProcessService } from "./managed-process/service.ts";
import type { ManagedProcessState } from "../contract/processes.ts";
import { resolveSafeProcessCwd, redactDiagnostic, osErrorFacts, formatOsErrorFacts } from "./subprocess-cwd.ts";

export interface HostSelfCheckDeps {
  readonly listModels: (cwd: string, signal: AbortSignal) => Promise<ModelsListResult>;
  readonly applyPluginAction: (body: PluginActionBody, signal?: AbortSignal) => Promise<PluginsResponse>;
  readonly managedProcesses: Pick<ManagedProcessService, "startForAgent" | "stop" | "dismiss" | "list">;
}

function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function diagnostic(error: unknown): string {
  const base = error instanceof Error ? error.message : String(error);
  const facts = osErrorFacts(error);
  const formatted = facts ? formatOsErrorFacts(facts) : undefined;
  return redactDiagnostic(formatted && !base.includes(formatted) ? `${base} (${formatted})` : base);
}

async function withCleanup<T, U>(run: () => Promise<T>, cleanup: () => Promise<U>): Promise<[T, U]> {
  let outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
  try {
    outcome = { ok: true, value: await run() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  let cleaned: U;
  try {
    cleaned = await cleanup();
  } catch (error) {
    if (!outcome.ok) {
      throw new Error(`${diagnostic(outcome.error)}; cleanup failed: ${diagnostic(error)}`, { cause: outcome.error });
    }
    throw error;
  }
  if (!outcome.ok) throw outcome.error;
  return [outcome.value, cleaned];
}

const UNSUPPORTED_PLATFORM_CODES = new Set([
  "PROCESS_PLATFORM_UNSUPPORTED",
  "PLATFORM_UNSUPPORTED",
  "ARCH_UNSUPPORTED",
]);

function platformUnsupported(error: unknown): boolean {
  const value = error as { code?: unknown; details?: { subcode?: unknown } } | null;
  return (
    UNSUPPORTED_PLATFORM_CODES.has(String(value?.code)) ||
    UNSUPPORTED_PLATFORM_CODES.has(String(value?.details?.subcode))
  );
}

async function probe<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  deadline: number,
): Promise<HostSelfCheckProbe<T>> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { ok: false, error: "Host self-check overall deadline reached" };
  const signal = AbortSignal.timeout(Math.min(timeoutMs, remaining));
  try {
    return { ok: true, ...(await run(signal)) };
  } catch (error) {
    return {
      ok: false,
      error:
        signal.aborted && Date.now() >= deadline
          ? `Host self-check overall deadline reached: ${diagnostic(error)}`
          : diagnostic(error),
      ...(platformUnsupported(error) ? { platformUnsupported: true as const } : {}),
    };
  }
}

export async function runHostSelfCheck(
  deps: HostSelfCheckDeps,
  options: { timeoutMs?: number } = {},
): Promise<HostSelfCheckReport> {
  const workspace = await realpath(await mkdtemp(path.join(resolveSafeProcessCwd(os.tmpdir()), "dexon-self-check-")));
  const deadline = Date.now() + 90_000;
  const timeoutMs = options.timeoutMs ?? 40_000;
  let report: HostSelfCheckReport = {
    models: { ok: false, error: "Models probe did not complete" },
    pluginWorker: { ok: false, error: "Plugin probe did not complete" },
    managedProcess: { ok: false, error: "Managed process probe did not complete" },
  };
  try {
    const models = await probe(
      async (signal) => {
        const result = await bounded(deps.listModels(workspace, signal), signal);
        if (!Array.isArray(result.models)) throw new Error("Models response has no model array");
        return { modelCount: result.models.length, catalogSource: result.catalog.source };
      },
      timeoutMs,
      deadline,
    );
    const pluginWorker = await probe(
      async (signal) => {
        const source = path.join(workspace, "plugin");
        await mkdir(source);
        await writeFile(
          path.join(source, "package.json"),
          JSON.stringify({
            name: "dexon-self-check-plugin",
            version: "1.0.0",
            type: "module",
            pi: { extensions: ["./index.js"] },
          }),
        );
        await writeFile(path.join(source, "index.js"), "export default function () {}\n");
        const body = { source, scope: "project" as const, cwd: workspace };
        const [installation, removal] = await withCleanup(
          () => bounded(deps.applyPluginAction({ ...body, action: "install" }, signal), signal),
          () => {
            const cleanupSignal = AbortSignal.timeout(Math.min(5_000, timeoutMs));
            return bounded(deps.applyPluginAction({ ...body, action: "remove" }, cleanupSignal), cleanupSignal);
          },
        );
        const local = installation.packages.find(
          (pkg) =>
            pkg.installedPath === source && pkg.scope === "project" && ["installed", "loaded"].includes(pkg.status),
        );
        const installed = local !== undefined;
        const removed = !removal.packages.some(
          (pkg) =>
            pkg.scope === "project" &&
            (pkg.installedPath === source || pkg.source === source || pkg.source === local?.source),
        );
        if (!installed || !removed) throw new Error("Local plugin install or removal was not confirmed");
        return { installed, removed };
      },
      timeoutMs,
      deadline,
    );
    const managedProcess = await probe(
      async (signal) => {
        const owner = `host-self-check-${randomUUID()}`;
        const [started, finalState] = await withCleanup(
          async () => {
            const started = await bounded(
              deps.managedProcesses.startForAgent(
                owner,
                workspace,
                true,
                {
                  command: "printf 'dexon-self-check-ready\\n'; read -r _",
                  cwd: workspace,
                  kind: "task",
                  waitFor: { type: "output", contains: "dexon-self-check-ready", timeoutMs: 10_000 },
                  activateUi: false,
                },
                signal,
              ),
              signal,
            );
            if (
              started.readiness.state !== "ready" ||
              !started.output.records.some((record) => record.text.includes("dexon-self-check-ready"))
            )
              throw new Error(
                `Managed process readiness was ${started.readiness.state}: ${redactDiagnostic(started.output.records.map((record) => record.text).join(""))}`,
              );
            return started;
          },
          async () => {
            let finalState: ManagedProcessState = "failed";
            const failures: string[] = [];
            const cleanupSignal = AbortSignal.timeout(Math.min(9_000, timeoutMs));
            for (const process of deps.managedProcesses.list(true, owner).processes) {
              try {
                const stopped = await bounded(
                  deps.managedProcesses.stop(process.processId, process.runId, "graceful", "agent", owner),
                  cleanupSignal,
                );
                finalState = stopped.state;
              } catch (error) {
                failures.push(diagnostic(error));
              }
              try {
                deps.managedProcesses.dismiss(process.processId);
              } catch (error) {
                failures.push(diagnostic(error));
              }
            }
            if (failures.length) throw new Error(failures.join("; "));
            return finalState;
          },
        );
        if (!isCleanManagedStopState(finalState))
          throw new Error(`Managed process probe did not stop cleanly (${finalState})`);
        return { readyLineSeen: started.readiness.state === "ready", finalState };
      },
      timeoutMs,
      deadline,
    );
    report = { models, pluginWorker, managedProcess };
  } finally {
    try {
      await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      report = { ...report, cleanup: { ok: false, error: diagnostic(error) } };
    }
  }
  return report;
}
