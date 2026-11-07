import type { AutomationDatabase } from "./db";
import type { RunSummaryView } from "../../../shared/automation/views";
import { decideCancel } from "../core/run-machine";
import { readSnapshot, getRunRow, runSummary } from "./queries";
import { setPhase, settleStep, endRun, type ClaimedRun } from "./run-rows";
import { cleanupDrained } from "./task-rows";

function requireAttention(adb: AutomationDatabase, runId: string): void {
  const snapshot = readSnapshot(adb, runId);
  const record = snapshot.steps.find((step) => step.status === "waiting" || step.status === "unknown");
  const open = snapshot.attempts.find((attempt) => attempt.outcome === null);
  const index = record?.stepIndex ?? open?.stepIndex ?? Math.max(0, snapshot.steps.at(-1)?.stepIndex ?? 0);
  const step = snapshot.plan.steps[index];
  settleStep(
    adb,
    runId,
    step,
    "unknown",
    { code: "cancel_requires_reconciliation", message: "Reconcile external effects before releasing this lane" },
    adb.clock.now(),
  );
}
export function cancelRun(adb: AutomationDatabase, runId: string): RunSummaryView {
  const row = getRunRow(adb, runId);
  if (!row) throw new Error("Run not found");
  if (row.ended_at_ms !== null || row.phase === "cancelling") return runSummary(row);
  const snapshot = readSnapshot(adb, runId);
  const decision = decideCancel(snapshot.run, snapshot.steps, snapshot.attempts, snapshot.plan, adb.clock.now());
  if (decision.kind === "quiesce_then_attention" || decision.kind === "quiesce_then_cancel") {
    if (decision.kind === "quiesce_then_attention") requireAttention(adb, runId);
    setPhase(adb, runId, "cancelling", adb.clock.now(), row.lease_token);
  } else if (decision.kind === "require_attention") {
    requireAttention(adb, runId);
    setPhase(adb, runId, "attention", adb.clock.now());
    cleanupDrained(adb);
  } else endRun(adb, runId, "cancelled", { reason: "user_cancelled" }, adb.clock.now());
  return runSummary(getRunRow(adb, runId)!);
}
export function settleCancelledRun(adb: AutomationDatabase, lease: ClaimedRun): RunSummaryView {
  const row = getRunRow(adb, lease.runId);
  if (!row) throw new Error("Run not found");
  if (row.phase !== "cancelling" || row.lease_token !== lease.leaseToken) return runSummary(row);
  const snapshot = readSnapshot(adb, row.id);
  if (snapshot.attempts.some((attempt) => attempt.outcome === null))
    throw new Error("Cannot settle cancellation before attempts quiesce");
  const markedDirty = snapshot.steps.some(
    (step) =>
      step.status === "unknown" &&
      step.error !== null &&
      typeof step.error === "object" &&
      "code" in step.error &&
      step.error.code === "cancel_requires_reconciliation",
  );
  const decision = decideCancel(snapshot.run, snapshot.steps, snapshot.attempts, snapshot.plan, adb.clock.now());
  if (markedDirty || decision.kind === "quiesce_then_attention") {
    requireAttention(adb, row.id);
    setPhase(adb, row.id, "attention", adb.clock.now());
    cleanupDrained(adb);
  } else endRun(adb, row.id, "cancelled", { reason: "user_cancelled" }, adb.clock.now());
  return runSummary(getRunRow(adb, row.id)!);
}
