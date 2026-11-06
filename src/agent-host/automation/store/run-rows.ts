import { randomUUID } from "node:crypto";
import type { AutomationDatabase } from "./db";
import type { Json } from "../../../shared/automation/spec";
import type { RunPhase, EndRunPhase } from "../../../shared/automation/phases";
import type { FireRequest, FireResult } from "../../../shared/automation/views";
import { RunId, LeaseToken, type StepPlan, type TaskPlan } from "../core/plan";
import { decideAdmission } from "../core/lane";
import { renderText } from "../spec/values";
import { validateJsonSchema } from "../spec/json-schema";
import { getTask, getTaskPlan, getRunRow, parseJson } from "./queries";
import { cleanupDrained } from "./task-rows";
import { withReceipt } from "./receipts";
import type { RunRow } from "./records";

export interface ClaimedRun {
  readonly runId: RunId;
  readonly leaseToken: LeaseToken;
}
export class LeaseLost extends Error {
  constructor() {
    super("Automation lease lost");
  }
}
export function requireLease(adb: AutomationDatabase, lease: ClaimedRun): RunRow {
  const row = getRunRow(adb, lease.runId);
  if (!row || row.phase !== "running" || row.lease_token !== lease.leaseToken) throw new LeaseLost();
  return row;
}
export function setPhase(
  adb: AutomationDatabase,
  id: string,
  phase: RunPhase,
  now: number,
  lease: string | null = null,
  wake: number | null = null,
): void {
  adb.db
    .prepare(
      "UPDATE runs SET phase = ?, lease_token = ?, wake_at_ms = ?, version = version + 1, updated_at_ms = ? WHERE id = ?",
    )
    .run(phase, lease, wake, now, id);
  adb.notifyChange({ kind: phase === "ready" ? "run_ready" : "run_changed", runId: id });
}
export function promoteLane(adb: AutomationDatabase, laneKey: string | null, now: number): void {
  if (laneKey === null) return;
  const pending = adb.db
    .prepare("SELECT * FROM runs WHERE lane_key = ? AND phase = 'pending' ORDER BY created_at_ms, rowid")
    .all(laneKey) as unknown as RunRow[];
  for (const run of pending) {
    const live = adb.db
      .prepare(
        "SELECT COUNT(*) AS count, MIN(lane_capacity) AS capacity FROM runs WHERE lane_key = ? AND phase IN ('ready','running','waiting','backoff','attention','cancelling')",
      )
      .get(laneKey) as { count: number; capacity: number | null };
    if (live.count >= Math.min(run.lane_capacity!, live.capacity ?? run.lane_capacity!)) break;
    adb.db
      .prepare(
        "UPDATE runs SET phase = 'ready', admitted_at_ms = ?, updated_at_ms = ?, version = version + 1 WHERE id = ? AND phase = 'pending'",
      )
      .run(now, now, run.id);
    adb.notifyChange({ kind: "run_ready", runId: run.id });
  }
}
export function endRun(adb: AutomationDatabase, id: string, phase: EndRunPhase, end: Json, now: number): void {
  const row = getRunRow(adb, id);
  if (!row || row.ended_at_ms !== null) return;
  adb.db
    .prepare("UPDATE steps SET status = 'skipped', settled_at_ms = ? WHERE run_id = ? AND status = 'waiting'")
    .run(now, id);
  adb.db
    .prepare(
      "UPDATE runs SET phase = ?, lease_token = NULL, wake_at_ms = NULL, end_json = ?, ended_at_ms = ?, updated_at_ms = ?, version = version + 1 WHERE id = ?",
    )
    .run(phase, JSON.stringify(end), now, now, id);
  adb.notifyChange({ kind: "run_ended", runId: id });
  promoteLane(adb, row.lane_key, now);
  cleanupDrained(adb);
}
export function touchRun(adb: AutomationDatabase, id: string): void {
  adb.db.prepare("UPDATE runs SET version = version + 1, updated_at_ms = ? WHERE id = ?").run(adb.clock.now(), id);
  adb.notifyChange({ kind: "run_changed", runId: id });
}
export function settleStep(
  adb: AutomationDatabase,
  id: string,
  step: StepPlan,
  status: "done" | "skipped" | "failed" | "unknown",
  value: Json,
  now: number,
): void {
  const output = status === "done" ? JSON.stringify(value) : null;
  const error = status === "failed" || status === "unknown" ? JSON.stringify(value) : null;
  adb.db
    .prepare(
      `INSERT INTO steps (run_id, step_index, status, output_json, error_json, opened_at_ms, settled_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id, step_index) DO UPDATE SET
    status = excluded.status, output_json = excluded.output_json, error_json = excluded.error_json, settled_at_ms = excluded.settled_at_ms`,
    )
    .run(id, step.stepIndex, status, output, error, now, now);
  touchRun(adb, id);
}
export function fire(adb: AutomationDatabase, request: FireRequest): FireResult {
  return withReceipt(adb, "fire", request.requestId, request, () => fireInTx(adb, request));
}
function fireInTx(adb: AutomationDatabase, request: FireRequest): FireResult {
  const task = getTask(adb, request.taskId);
  const skipped = (reason: FireResult["reason"]): FireResult => ({
    outcome: "skipped",
    runId: null,
    phase: null,
    reason,
  });
  if (!task || task.enabledRevision === null) return skipped("task_disabled");
  if (
    request.expectedRevision !== undefined &&
    request.expectedRevision !== null &&
    request.expectedRevision !== task.enabledRevision
  )
    return skipped("revision_mismatch");
  const plan = getTaskPlan(adb, task.id, task.enabledRevision)!;
  if (!plan.triggers.some((trigger) => trigger.id === request.triggerId)) return skipped("trigger_missing");
  if (plan.inputSchema && validateJsonSchema(plan.inputSchema, request.input).length) return skipped("invalid_input");
  if (request.dedupeKey !== undefined) {
    const existing = adb.db
      .prepare(
        "SELECT id, phase FROM runs WHERE task_id = ? AND dedupe_key = ? AND phase NOT IN ('cancelled','superseded')",
      )
      .get(request.taskId, request.dedupeKey) as { id: string; phase: RunPhase } | undefined;
    if (existing) return { outcome: "dedupe_hit", runId: existing.id, phase: existing.phase };
  }
  const now = adb.clock.now();
  const id = randomUUID();
  const trigger = request.trigger ?? { kind: "manual", triggerId: request.triggerId, firedAtMs: now };
  let laneKey: string | null = null;
  let phase: "ready" | "pending" = "ready";
  if (plan.lane) {
    try {
      const resolved =
        plan.lane.keyTmpl === null
          ? "default"
          : renderText(plan.lane.keyTmpl, {
              input: request.input,
              trigger,
              run: { id },
              task: { name: plan.name },
              steps: new Map(),
            });
      laneKey = `${task.id}/${resolved}`;
    } catch {
      return skipped("invalid_input");
    }
    const live = adb.db
      .prepare(
        "SELECT COUNT(*) AS count, MIN(lane_capacity) AS capacity FROM runs WHERE lane_key = ? AND phase IN ('ready','running','waiting','backoff','attention','cancelling')",
      )
      .get(laneKey) as { count: number; capacity: number | null };
    const pending = adb.db
      .prepare("SELECT id FROM runs WHERE lane_key = ? AND phase = 'pending' ORDER BY created_at_ms, rowid")
      .all(laneKey) as { id: string }[];
    const decision = decideAdmission({
      laneKey,
      capacity: Math.min(plan.lane.capacity, live.capacity ?? plan.lane.capacity),
      overflow: plan.lane.overflow,
      maxPending: plan.lane.maxPending,
      liveCount: live.count,
      pendingCount: pending.length,
      pendingRunIds: pending.map((row) => row.id),
    });
    if (decision.kind === "skip") return skipped("lane_full");
    if (decision.kind === "enqueue") {
      phase = "pending";
      for (const superseded of decision.supersede) endRun(adb, superseded, "superseded", { reason: "latest" }, now);
    }
  }
  adb.db
    .prepare(
      `INSERT INTO runs (id, task_id, revision, trigger_json, input_json, dedupe_key, lane_key, lane_capacity,
    lane_overflow, max_executing, phase, admitted_at_ms, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      task.id,
      task.enabledRevision,
      JSON.stringify(trigger),
      JSON.stringify(request.input),
      request.dedupeKey ?? null,
      laneKey,
      plan.lane?.capacity ?? null,
      plan.lane?.overflow ?? null,
      plan.maxExecuting,
      phase,
      phase === "ready" ? now : null,
      now,
      now,
    );
  adb.notifyChange({ kind: "run_created", runId: id });
  if (phase === "ready") adb.notifyChange({ kind: "run_ready", runId: id });
  return { outcome: phase === "ready" ? "admitted" : "enqueued", runId: id, phase };
}
export function claimNextReady(adb: AutomationDatabase): ClaimedRun | null {
  const candidate = adb.db
    .prepare(
      `SELECT r.id FROM runs r WHERE r.phase = 'ready' AND
    (SELECT COUNT(*) FROM runs active WHERE active.task_id = r.task_id AND active.phase IN ('running','cancelling')) < r.max_executing
    ORDER BY r.admitted_at_ms, r.created_at_ms, r.rowid LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (!candidate) return null;
  const lease = LeaseToken();
  const result = adb.db
    .prepare(
      "UPDATE runs SET phase = 'running', lease_token = ?, version = version + 1, updated_at_ms = ? WHERE id = ? AND phase = 'ready'",
    )
    .run(lease, adb.clock.now(), candidate.id);
  if (result.changes !== 1) return null;
  adb.notifyChange({ kind: "run_changed", runId: candidate.id });
  return { runId: RunId(candidate.id), leaseToken: lease };
}
export function runPlan(adb: AutomationDatabase, row: RunRow): TaskPlan {
  const revision = adb.db
    .prepare("SELECT plan_json FROM task_revisions WHERE task_id = ? AND revision = ?")
    .get(row.task_id, row.revision) as { plan_json: string };
  return parseJson(revision.plan_json);
}
