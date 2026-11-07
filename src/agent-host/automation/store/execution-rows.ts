import type { AutomationDatabase } from "./db";
import type { Json } from "../../../shared/automation/spec";
import type { AttemptTicket, EffectPolicy } from "../core/plan";
import type { CommitOutcome, AttemptSettlementDecision, NextRunMove } from "../core/run-machine";
import { decideAfterAttempt } from "../core/run-machine";
import { getRunRow, readSnapshot, parseJson } from "./queries";
import { requireLease, settleStep, setPhase, endRun, runPlan, touchRun, type ClaimedRun } from "./run-rows";
import { cleanupDrained } from "./task-rows";
import type { AttemptRow } from "./records";

export type MoveCommit = { readonly kind: "continue" | "parked" | "ended" | "lease_lost" };
export function beginAttempt(
  adb: AutomationDatabase,
  lease: ClaimedRun,
  stepIndex: number,
  policy: EffectPolicy,
): AttemptTicket {
  const row = requireLease(adb, lease);
  const snapshot = readSnapshot(adb, row.id);
  const first = snapshot.plan.steps.find(
    (step) => !snapshot.steps.some((record) => record.stepIndex === step.stepIndex),
  );
  if (first?.stepIndex !== stepIndex || first.kind === "wait")
    throw new Error("Attempt must target the next executable step");
  const history = snapshot.attempts.filter((attempt) => attempt.stepIndex === stepIndex);
  if (history.some((attempt) => attempt.outcome === null)) throw new Error("Attempt is already open");
  const previous = history.at(-1);
  const attemptNo = (previous?.attemptNo ?? 0) + 1;
  const effectKey = `${row.id}:${first.id}`;
  const now = adb.clock.now();
  const userRetry =
    previous?.detail !== null &&
    typeof previous?.detail === "object" &&
    "userRetryRequested" in previous.detail &&
    previous.detail.userRetryRequested === true;
  adb.db
    .prepare(
      `INSERT INTO attempts (run_id, step_index, attempt_no, effect_key, policy_json, lease_token, origin, started_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      stepIndex,
      attemptNo,
      effectKey,
      JSON.stringify(policy),
      lease.leaseToken,
      userRetry ? "user_retry" : "driver",
      now,
    );
  touchRun(adb, row.id);
  return { runId: lease.runId, leaseToken: lease.leaseToken, stepIndex, attemptNo, effectKey, startedAtMs: now };
}
export function attachSession(adb: AutomationDatabase, ticket: AttemptTicket, sessionId: string): void {
  requireLease(adb, ticket);
  const result = adb.db
    .prepare(
      "UPDATE attempts SET session_id = ? WHERE run_id = ? AND step_index = ? AND attempt_no = ? AND lease_token = ? AND outcome IS NULL AND session_id IS NULL",
    )
    .run(sessionId, ticket.runId, ticket.stepIndex, ticket.attemptNo, ticket.leaseToken);
  if (result.changes !== 1) throw new Error("Attempt session is already attached or settled");
  touchRun(adb, ticket.runId);
}
export function applyDecision(
  adb: AutomationDatabase,
  runId: string,
  stepIndex: number,
  decision: AttemptSettlementDecision,
  now: number,
): MoveCommit {
  const row = getRunRow(adb, runId)!;
  const step = runPlan(adb, row).steps[stepIndex];
  if (decision.kind === "schedule_backoff") {
    setPhase(adb, runId, "backoff", now, null, now + decision.nextBackoffMs);
    return { kind: "parked" };
  }
  if (decision.kind === "complete_step") {
    settleStep(adb, runId, step, "done", decision.output, now);
    return { kind: "continue" };
  }
  const error = JSON.parse(JSON.stringify(decision.error)) as Json;
  const status =
    decision.kind === "pause_for_attention"
      ? "unknown"
      : decision.kind === "continue_on_error"
        ? decision.status
        : "failed";
  settleStep(adb, runId, step, status, error, now);
  if (decision.kind === "pause_for_attention") {
    setPhase(adb, runId, "attention", now);
    return { kind: "parked" };
  }
  if (decision.kind === "fail_step") {
    endRun(adb, runId, "failed", { error }, now);
    return { kind: "ended" };
  }
  return { kind: "continue" };
}
export function settleAttempt(
  adb: AutomationDatabase,
  ticket: AttemptTicket,
  outcome: CommitOutcome<Json>,
  supplied?: AttemptSettlementDecision,
): MoveCommit {
  const attempt = adb.db
    .prepare("SELECT * FROM attempts WHERE run_id = ? AND step_index = ? AND attempt_no = ? AND lease_token = ?")
    .get(ticket.runId, ticket.stepIndex, ticket.attemptNo, ticket.leaseToken) as unknown as AttemptRow | undefined;
  if (!attempt || attempt.outcome !== null) return { kind: "lease_lost" };
  const now = adb.clock.now();
  const detail =
    outcome.kind === "committed"
      ? { output: outcome.output }
      : {
          ...outcome.error,
          maybeApplied: outcome.kind === "retryable_within_window" || outcome.kind === "outcome_unknown",
        };
  adb.db
    .prepare(
      "UPDATE attempts SET outcome = ?, detail_json = ?, settled_at_ms = ? WHERE run_id = ? AND step_index = ? AND attempt_no = ? AND outcome IS NULL",
    )
    .run(outcome.kind, JSON.stringify(detail), now, ticket.runId, ticket.stepIndex, ticket.attemptNo);
  touchRun(adb, ticket.runId);
  const row = getRunRow(adb, ticket.runId)!;
  if (row.phase !== "running" || row.lease_token !== ticket.leaseToken) return { kind: "lease_lost" };
  const snapshot = readSnapshot(adb, row.id);
  const history = snapshot.attempts.filter((entry) => entry.stepIndex === ticket.stepIndex);
  const decision = supplied ?? decideAfterAttempt(snapshot.plan.steps[ticket.stepIndex], outcome, history, now);
  return applyDecision(adb, row.id, ticket.stepIndex, decision, now);
}
export function commitMove(adb: AutomationDatabase, lease: ClaimedRun, move: NextRunMove): MoveCommit {
  const row = getRunRow(adb, lease.runId);
  if (!row || row.phase !== "running" || row.lease_token !== lease.leaseToken) return { kind: "lease_lost" };
  const snapshot = readSnapshot(adb, row.id);
  if (snapshot.attempts.some((attempt) => attempt.outcome === null))
    throw new Error("Cannot advance while an attempt is open");
  const now = adb.clock.now();
  if (move.kind === "end_run") {
    endRun(
      adb,
      row.id,
      move.outcome,
      move.error ? { error: JSON.parse(JSON.stringify(move.error)) as Json } : { output: move.output ?? null },
      now,
    );
    return { kind: "ended" };
  }
  if (move.kind === "run_step") throw new Error("Execution must begin with an attempt");
  const step = snapshot.plan.steps[move.stepIndex];
  if (!step) throw new Error("Step not found");
  if (snapshot.steps.some((entry) => entry.stepIndex === move.stepIndex)) return { kind: "continue" };
  if (move.kind === "skip_step") {
    settleStep(adb, row.id, step, "skipped", null, now);
    adb.notifyChange({ kind: "run_changed", runId: row.id });
    return { kind: "continue" };
  }
  if (move.kind === "fail_step")
    return applyDecision(
      adb,
      row.id,
      move.stepIndex,
      step.onFailure === "continue"
        ? { kind: "continue_on_error", status: "failed", error: move.error }
        : { kind: "fail_step", error: move.error },
      now,
    );
  if (move.kind === "complete_wait_immediately") {
    settleStep(adb, row.id, step, "done", move.output, now);
    adb.notifyChange({ kind: "run_changed", runId: row.id });
    return { kind: "continue" };
  }
  if (step.kind !== "wait") throw new Error("Expected wait step");
  const wait = move.wait;
  if (wait.kind === "signal") {
    const signal = adb.db
      .prepare("SELECT payload_json, last_emitted_at_ms FROM signals WHERE task_id = ? AND name = ? AND key = ?")
      .get(row.task_id, wait.name, wait.key) as { payload_json: string; last_emitted_at_ms: number } | undefined;
    if (signal && (wait.acceptSinceMs === null || signal.last_emitted_at_ms >= wait.acceptSinceMs)) {
      settleStep(adb, row.id, step, "done", parseJson(signal.payload_json), now);
      adb.notifyChange({ kind: "run_changed", runId: row.id });
      cleanupDrained(adb);
      return { kind: "continue" };
    }
  }
  if (wait.kind === "duration" && wait.wakeAtMs <= now) {
    settleStep(adb, row.id, step, "done", null, now);
    return { kind: "continue" };
  }
  adb.db
    .prepare(
      `INSERT INTO steps (run_id, step_index, status, wait_kind, signal_name, signal_key, wake_at_ms, expires_at_ms, request_json, opened_at_ms)
    VALUES (?, ?, 'waiting', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      move.stepIndex,
      wait.kind,
      wait.kind === "signal" ? wait.name : null,
      wait.kind === "signal" ? wait.key : null,
      wait.kind === "duration" ? wait.wakeAtMs : null,
      wait.expiresAtMs,
      wait.kind === "approval" ? JSON.stringify(wait.request) : null,
      now,
    );
  setPhase(adb, row.id, "waiting", now);
  adb.notifyChange({ kind: "step_waiting", runId: row.id, stepIndex: move.stepIndex });
  return { kind: "parked" };
}
