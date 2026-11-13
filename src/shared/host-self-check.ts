import type { ManagedProcessState } from "../contract/processes.ts";

export type HostSelfCheckProbe<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly error: string };

export interface HostSelfCheckReport {
  readonly cleanup?: HostSelfCheckProbe<Record<never, never>>;
  readonly models: HostSelfCheckProbe<{ readonly modelCount: number; readonly catalogSource: string }>;
  readonly pluginWorker: HostSelfCheckProbe<{ readonly installed: boolean; readonly removed: boolean }>;
  readonly managedProcess: HostSelfCheckProbe<{
    readonly readyLineSeen: boolean;
    readonly finalState: ManagedProcessState;
  }>;
}

const CLEAN_MANAGED_STOP_STATES = ["exited", "killed", "reaped"] as const;

export function isCleanManagedStopState(state: unknown): state is (typeof CLEAN_MANAGED_STOP_STATES)[number] {
  return typeof state === "string" && (CLEAN_MANAGED_STOP_STATES as readonly string[]).includes(state);
}

export function hostSelfCheckFailures(report: unknown, expectation: { readonly offline: boolean }): string[] {
  const failures: string[] = [];
  const value = report && typeof report === "object" ? (report as Record<string, unknown>) : {};
  for (const name of ["models", "pluginWorker", "managedProcess"] as const) {
    const probe = value[name] as Record<string, unknown> | undefined;
    if (!probe || probe.ok !== true) {
      failures.push(`${name}: ${typeof probe?.error === "string" ? probe.error : "probe did not succeed"}`);
      continue;
    }
    if (
      name === "models" &&
      (!Number.isSafeInteger(probe.modelCount) ||
        (probe.modelCount as number) < 0 ||
        typeof probe.catalogSource !== "string" ||
        (expectation.offline && probe.catalogSource !== "offline"))
    )
      failures.push("models: invalid model catalog result");
    if (name === "pluginWorker" && (probe.installed !== true || probe.removed !== true)) {
      failures.push("pluginWorker: install and removal were not confirmed");
    }
    if (name === "managedProcess" && (probe.readyLineSeen !== true || !isCleanManagedStopState(probe.finalState))) {
      failures.push("managedProcess: readiness or clean stop was not confirmed");
    }
  }
  const cleanup = value.cleanup as Record<string, unknown> | undefined;
  if (cleanup && cleanup.ok !== true)
    failures.push(`cleanup: ${typeof cleanup.error === "string" ? cleanup.error : "workspace cleanup failed"}`);
  return failures;
}
