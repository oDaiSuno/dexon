import type { AutomationDatabase } from "./db";
import type { JsonSchema, Json } from "../../../shared/automation/spec";
import type { ResolveInboxRequest, ResolveInboxResult } from "../../../shared/automation/views";
import { validateJsonSchema } from "../spec/json-schema";
import { readSnapshot, getRunRow, runSummary } from "./queries";
import { setPhase, settleStep, endRun } from "./run-rows";
import { cleanupDrained } from "./task-rows";
import { withReceipt } from "./receipts";
import { wakeDueRuns } from "./wait-rows";

export function resolveInbox(adb: AutomationDatabase, request: ResolveInboxRequest): ResolveInboxResult {
  return withReceipt(adb, "resolveInbox", request.requestId, request, () => {
    const now = adb.clock.now();
    wakeDueRuns(adb, now);
    const row = getRunRow(adb, request.runId);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.version !== request.expectedVersion) return { ok: false, reason: "version_conflict" };
    if (row.ended_at_ms !== null || !["waiting", "attention"].includes(row.phase))
      return { ok: false, reason: "already_resolved" };
    const snapshot = readSnapshot(adb, row.id);
    const record = snapshot.steps.find((step) => step.stepIndex === request.stepIndex);
    const step = snapshot.plan.steps[request.stepIndex];
    if (!step || !record) return { ok: false, reason: "not_found" };
    const resolution = request.resolution;
    if (resolution.kind === "approval") {
      if (row.phase !== "waiting" || record.status !== "waiting" || record.waitKind !== "approval")
        return { ok: false, reason: "kind_mismatch" };
      const rendered = record.requestJson as { fields: JsonSchema | null; defaults: Json };
      const fields = resolution.data ?? rendered.defaults ?? {};
      if (resolution.approved && rendered.fields) {
        const issues = validateJsonSchema(rendered.fields, fields);
        if (issues.length)
          return { ok: false, reason: "invalid", issues: issues.map((issue) => `${issue.path}: ${issue.message}`) };
      }
      const output = { approved: resolution.approved, fields };
      settleStep(adb, row.id, step, "done", output, now);
      if (!resolution.approved) endRun(adb, row.id, "rejected", { output }, now);
      else setPhase(adb, row.id, "ready", now);
    } else {
      if (row.phase !== "attention" || record.status !== "unknown") return { ok: false, reason: "kind_mismatch" };
      const cancelReconciliation =
        record.error !== null &&
        typeof record.error === "object" &&
        "code" in record.error &&
        record.error.code === "cancel_requires_reconciliation";
      if (cancelReconciliation && resolution.action !== "confirm_cancelled")
        return { ok: false, reason: "invalid", issues: ["Confirm cancellation after reconciling external effects"] };
      if (resolution.action === "confirm_cancelled") {
        if (!cancelReconciliation) return { ok: false, reason: "invalid" };
        endRun(adb, row.id, "cancelled", { reason: "reconciled_by_user" }, now);
      } else if (resolution.action === "mark_failed") endRun(adb, row.id, "failed", { error: record.error }, now);
      else if (resolution.action === "mark_succeeded") {
        settleStep(adb, row.id, step, "done", resolution.output ?? null, now);
        setPhase(adb, row.id, "ready", now);
      } else if (resolution.action === "retry") {
        if (step.kind === "wait") return { ok: false, reason: "invalid" };
        adb.db
          .prepare("DELETE FROM steps WHERE run_id = ? AND step_index = ? AND status = 'unknown'")
          .run(row.id, step.stepIndex);
        const previous = snapshot.attempts.filter((attempt) => attempt.stepIndex === step.stepIndex).at(-1);
        if (previous) {
          const detail =
            previous.detail !== null && typeof previous.detail === "object" && !Array.isArray(previous.detail)
              ? previous.detail
              : {};
          adb.db
            .prepare("UPDATE attempts SET detail_json = ? WHERE run_id = ? AND step_index = ? AND attempt_no = ?")
            .run(JSON.stringify({ ...detail, userRetryRequested: true }), row.id, step.stepIndex, previous.attemptNo);
        }
        setPhase(adb, row.id, "ready", now);
      } else return { ok: false, reason: "invalid" };
    }
    cleanupDrained(adb);
    return { ok: true, run: runSummary(getRunRow(adb, row.id)!) };
  });
}
