import type { EffectObservation, EffectError } from "../../effect-observation";
import type { Json } from "../../../shared/automation/spec";
import type { RunPhase } from "../../../shared/automation/phases";
import type { EffectPolicy, StepPlan, StepRecord, AttemptRecord, SignalRecord, RunId, TaskId } from "./plan";
import { effectPolicyFor } from "./plan";
import { evalCond, renderText, resolveValue, type ResolveContext } from "../spec/values";

export const CRASH_LOOP_LIMIT = 3;
export type CommitOutcome<O> =
  | { readonly kind: "committed"; readonly output: O }
  | { readonly kind: "rejected_before_commit"; readonly error: EffectError; readonly transient: boolean }
  | { readonly kind: "retryable_within_window"; readonly error: EffectError; readonly windowEndsAtMs: number | null }
  | { readonly kind: "outcome_unknown"; readonly error: EffectError };

export function wasInterrupted(attempt: AttemptRecord): boolean {
  return (
    attempt.outcome === null ||
    (attempt.detail !== null &&
      typeof attempt.detail === "object" &&
      "code" in attempt.detail &&
      attempt.detail.code === "host_interrupted")
  );
}

export function classifyCommit<O>(
  observation: EffectObservation<O>,
  policy: EffectPolicy,
  firstAttemptAtMs: number,
  priorAttempts: readonly AttemptRecord[],
  nowMs: number,
): CommitOutcome<O> {
  if (observation.kind === "applied") return { kind: "committed", output: observation.output };
  if (policy.kind === "idempotent" && typeof policy.windowMs === "number" && nowMs < firstAttemptAtMs) {
    return { kind: "outcome_unknown", error: observation.error };
  }
  if (observation.kind === "not_applied") {
    const ambiguous = priorAttempts.some(
      (attempt) =>
        attempt.policy.kind !== "read" &&
        (attempt.outcome === "outcome_unknown" ||
          attempt.outcome === "retryable_within_window" ||
          wasInterrupted(attempt)),
    );
    if (policy.kind !== "read" && ambiguous) return { kind: "outcome_unknown", error: observation.error };
    return { kind: "rejected_before_commit", error: observation.error, transient: observation.transient };
  }
  if (policy.kind === "read")
    return { kind: "retryable_within_window", error: observation.error, windowEndsAtMs: null };
  if (policy.kind === "idempotent" && (policy.windowMs === null || nowMs < firstAttemptAtMs + policy.windowMs)) {
    return {
      kind: "retryable_within_window",
      error: observation.error,
      windowEndsAtMs: policy.windowMs === null ? null : firstAttemptAtMs + policy.windowMs,
    };
  }
  return { kind: "outcome_unknown", error: observation.error };
}

export type AttemptSettlementDecision =
  | { readonly kind: "complete_step"; readonly output: Json }
  | { readonly kind: "schedule_backoff"; readonly nextBackoffMs: number; readonly error: EffectError }
  | { readonly kind: "pause_for_attention" | "fail_step"; readonly error: EffectError }
  | { readonly kind: "continue_on_error"; readonly status: "failed" | "unknown"; readonly error: EffectError };

export function decideAfterAttempt(
  step: StepPlan,
  outcome: CommitOutcome<Json>,
  history: readonly AttemptRecord[] | number,
  nowMs: number,
): AttemptSettlementDecision {
  if (outcome.kind === "committed") return { kind: "complete_step", output: outcome.output };
  if (step.kind === "wait") return { kind: "fail_step", error: outcome.error };
  const consumed =
    typeof history === "number"
      ? history
      : history.filter((attempt) => attempt.origin === "driver" && !wasInterrupted(attempt)).length;
  const backoff = step.backoffMs * step.backoffFactor ** Math.max(0, consumed - 1);
  const withinWindow =
    outcome.kind !== "retryable_within_window" ||
    outcome.windowEndsAtMs === null ||
    nowMs + backoff < outcome.windowEndsAtMs;
  const retryable =
    outcome.kind === "retryable_within_window" || (outcome.kind === "rejected_before_commit" && outcome.transient);
  if (retryable && consumed < step.maxAttempts && withinWindow && Number.isSafeInteger(nowMs + backoff)) {
    return { kind: "schedule_backoff", nextBackoffMs: backoff, error: outcome.error };
  }
  const read = effectPolicyFor(step).kind === "read";
  const unknown = outcome.kind === "outcome_unknown" || (outcome.kind === "retryable_within_window" && !read);
  const keepGoing = unknown ? step.onUnknown === "continue" : step.onFailure === "continue";
  if (keepGoing) return { kind: "continue_on_error", status: unknown ? "unknown" : "failed", error: outcome.error };
  return { kind: unknown ? "pause_for_attention" : "fail_step", error: outcome.error };
}

export interface RunView {
  readonly id: RunId;
  readonly taskId: TaskId;
  readonly phase: RunPhase;
  readonly laneKey: string | null;
  readonly createdAtMs: number;
  readonly input: Json;
  readonly trigger: Json;
  readonly taskName: string;
}
export interface RecoveryDecision {
  readonly kind: "resume_ready" | "mark_failed" | "pause_for_attention";
  readonly outcome?: CommitOutcome<Json>;
  readonly decision?: AttemptSettlementDecision;
  readonly error?: EffectError;
}

export function recoverOrphan(
  _run: RunView,
  step: StepPlan,
  open: AttemptRecord | null,
  prior: readonly AttemptRecord[],
  nowMs: number,
): RecoveryDecision {
  if (!open) return { kind: "resume_ready" };
  const history = prior.filter((attempt) => attempt.attemptNo !== open.attemptNo);
  const interruptedCount = history.filter(wasInterrupted).length + 1;
  const error: EffectError =
    interruptedCount >= CRASH_LOOP_LIMIT
      ? { code: "crash_loop", message: "Host interrupted three times on this step" }
      : { code: "host_interrupted", message: "Host interrupted while attempt was open" };
  let outcome: CommitOutcome<Json>;
  let decision: AttemptSettlementDecision;
  if (interruptedCount >= CRASH_LOOP_LIMIT) {
    const read = open.policy.kind === "read";
    outcome = read ? { kind: "rejected_before_commit", error, transient: false } : { kind: "outcome_unknown", error };
    decision = { kind: read ? "fail_step" : "pause_for_attention", error };
  } else {
    outcome = classifyCommit(
      { kind: "maybe_applied", error },
      open.policy,
      Math.min(open.startedAtMs, ...history.map((attempt) => attempt.startedAtMs)),
      history,
      nowMs,
    );
    decision = decideAfterAttempt(
      step,
      outcome,
      [...history, { ...open, detail: { code: "host_interrupted" } }],
      nowMs,
    );
    if (decision.kind === "schedule_backoff") decision = { ...decision, nextBackoffMs: 0 };
  }
  return {
    kind:
      decision.kind === "pause_for_attention"
        ? "pause_for_attention"
        : decision.kind === "fail_step" || decision.kind === "continue_on_error"
          ? "mark_failed"
          : "resume_ready",
    outcome,
    decision,
    error,
  };
}

export interface TaskPlanView {
  readonly steps: readonly StepPlan[];
  readonly name?: string;
}
export type OpenWait =
  | { readonly kind: "approval"; readonly request: Json; readonly expiresAtMs: number | null }
  | {
      readonly kind: "signal";
      readonly name: string;
      readonly key: string;
      readonly acceptSinceMs: number | null;
      readonly expiresAtMs: number | null;
    }
  | { readonly kind: "duration"; readonly wakeAtMs: number; readonly expiresAtMs: number | null };
export type NextRunMove =
  | { readonly kind: "run_step"; readonly stepIndex: number }
  | { readonly kind: "skip_step"; readonly stepIndex: number; readonly skipReason: string }
  | {
      readonly kind: "open_wait";
      readonly stepIndex: number;
      readonly waitKind: OpenWait["kind"];
      readonly wait: OpenWait;
    }
  | { readonly kind: "complete_wait_immediately"; readonly stepIndex: number; readonly output: Json }
  | { readonly kind: "fail_step"; readonly stepIndex: number; readonly error: EffectError }
  | {
      readonly kind: "end_run";
      readonly outcome: "succeeded" | "failed";
      readonly output?: Json;
      readonly error?: EffectError;
    };

export function contextFor(run: RunView, plan: TaskPlanView, steps: readonly StepRecord[]): ResolveContext {
  return {
    input: run.input,
    trigger: run.trigger,
    run: { id: run.id },
    task: { name: run.taskName ?? plan.name ?? "" },
    steps: new Map(
      steps
        .filter((step) => step.status === "done")
        .map((step) => [plan.steps[step.stepIndex].id, { output: step.output }]),
    ),
  };
}

export function planNext(
  run: RunView,
  plan: TaskPlanView,
  steps: readonly StepRecord[],
  attempts: readonly AttemptRecord[],
  signals: readonly SignalRecord[],
  nowMs: number,
): NextRunMove {
  const context = contextFor(run, plan, steps);
  let output: Json = null;
  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index];
    const record = steps.find((entry) => entry.stepIndex === index);
    if (record) {
      if (record.status === "waiting") throw new Error("Ready run contains a waiting step");
      if (record.status === "unknown" && step.kind !== "wait" && step.onUnknown !== "continue")
        throw new Error("Ready run contains unresolved uncertainty");
      if (record.status === "failed" && step.onFailure !== "continue") return { kind: "end_run", outcome: "failed" };
      if (record.status === "done") {
        output = record.output;
        if (step.stopRunIfCond && evalCond(step.stopRunIfCond, context))
          return { kind: "end_run", outcome: "succeeded", output };
      }
      continue;
    }
    if (attempts.some((attempt) => attempt.stepIndex === index && attempt.outcome === null))
      throw new Error("Attempt is already open");
    if (step.whenCond && !evalCond(step.whenCond, context))
      return { kind: "skip_step", stepIndex: index, skipReason: "when condition false" };
    if (step.kind !== "wait") return { kind: "run_step", stepIndex: index };
    const expiresAtMs = step.expiresInMs === null ? null : nowMs + step.expiresInMs;
    try {
      let wait: OpenWait;
      if (step.wait.kind === "signal") {
        const signalWait = step.wait;
        const key = renderText(signalWait.keyTmpl, context);
        const signal = signals.find(
          (entry) =>
            entry.taskId === run.taskId &&
            entry.name === signalWait.signal &&
            entry.key === key &&
            (signalWait.history === "retained" || entry.lastEmittedAtMs >= run.createdAtMs),
        );
        if (signal) return { kind: "complete_wait_immediately", stepIndex: index, output: signal.payload };
        wait = {
          kind: "signal",
          name: step.wait.signal,
          key,
          acceptSinceMs: step.wait.history === "retained" ? null : run.createdAtMs,
          expiresAtMs,
        };
      } else if (step.wait.kind === "duration") {
        if (step.wait.durationMs === 0) return { kind: "complete_wait_immediately", stepIndex: index, output: null };
        wait = { kind: "duration", wakeAtMs: nowMs + step.wait.durationMs, expiresAtMs };
      } else {
        wait = {
          kind: "approval",
          expiresAtMs,
          request: {
            title: renderText(step.wait.titleTmpl, context),
            prompt: step.wait.promptTmpl === null ? null : renderText(step.wait.promptTmpl, context),
            show: resolveValue(step.wait.showTmpl, context),
            fields: step.wait.fieldsSchema,
            defaults: resolveValue(step.wait.defaultsTmpl, context),
          },
        };
      }
      return { kind: "open_wait", stepIndex: index, waitKind: wait.kind, wait };
    } catch (error) {
      return {
        kind: "fail_step",
        stepIndex: index,
        error: { code: "invalid_input", message: error instanceof Error ? error.message : String(error) },
      };
    }
  }
  return { kind: "end_run", outcome: "succeeded", output };
}

export type CancelDecision =
  | { readonly kind: "cancel_immediately" | "quiesce_then_cancel" }
  | {
      readonly kind: "require_attention" | "quiesce_then_attention";
      readonly reason: "cancel_requires_reconciliation";
    };

export function decideCancel(
  run: RunView,
  steps: readonly StepRecord[],
  attempts: readonly AttemptRecord[],
  plan: TaskPlanView,
  _nowMs: number,
): CancelDecision {
  const dirty =
    run.laneKey !== null &&
    (attempts.some(
      (attempt) =>
        attempt.policy.kind !== "read" &&
        (attempt.outcome === "committed" ||
          attempt.outcome === "outcome_unknown" ||
          attempt.outcome === "retryable_within_window" ||
          attempt.outcome === null),
    ) ||
      steps.some((record) => {
        const step = plan.steps[record.stepIndex];
        return (
          step &&
          step.kind !== "wait" &&
          effectPolicyFor(step).kind !== "read" &&
          (record.status === "done" || record.status === "unknown")
        );
      }));
  if (dirty)
    return {
      kind: run.phase === "running" || run.phase === "cancelling" ? "quiesce_then_attention" : "require_attention",
      reason: "cancel_requires_reconciliation",
    };
  return { kind: run.phase === "running" || run.phase === "cancelling" ? "quiesce_then_cancel" : "cancel_immediately" };
}
