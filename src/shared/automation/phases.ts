export const RUN_PHASES = [
  "pending",
  "ready",
  "running",
  "waiting",
  "backoff",
  "attention",
  "cancelling",
  "succeeded",
  "failed",
  "rejected",
  "expired",
  "cancelled",
  "superseded",
] as const;

export type RunPhase = (typeof RUN_PHASES)[number];

export const LIVE_RUN_PHASES = [
  "ready",
  "running",
  "waiting",
  "backoff",
  "attention",
  "cancelling",
] as const satisfies readonly RunPhase[];

export const END_RUN_PHASES = [
  "succeeded",
  "failed",
  "rejected",
  "expired",
  "cancelled",
  "superseded",
] as const satisfies readonly RunPhase[];

export type LiveRunPhase = (typeof LIVE_RUN_PHASES)[number];
export type EndRunPhase = (typeof END_RUN_PHASES)[number];

export const STEP_STATUSES = ["waiting", "done", "skipped", "failed", "unknown"] as const;

export type StepStatus = (typeof STEP_STATUSES)[number];

export const COMMIT_OUTCOMES = [
  "committed",
  "rejected_before_commit",
  "retryable_within_window",
  "outcome_unknown",
] as const;

export type CommitOutcomeKind = (typeof COMMIT_OUTCOMES)[number];

export const TRIGGER_KINDS = ["schedule", "watch"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const TRIGGER_LIFECYCLES = ["armed", "draining"] as const;
export type TriggerLifecycle = (typeof TRIGGER_LIFECYCLES)[number];

export const LANE_OVERFLOW_POLICIES = ["skip", "queue", "latest"] as const;
export type LaneOverflowPolicy = (typeof LANE_OVERFLOW_POLICIES)[number];

export const WAIT_KINDS = ["approval", "signal", "duration"] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];

export const ATTEMPT_ORIGINS = ["driver", "user_retry"] as const;
export type AttemptOrigin = (typeof ATTEMPT_ORIGINS)[number];

export function sqlEnumList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(", ");
}
