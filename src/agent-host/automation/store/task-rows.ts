import type { AutomationDatabase } from "./db";
import type { TaskSpec, RequiredGrant, ConfirmedGrant, DesktopConsent } from "../../../shared/automation/spec";
import type { TaskView } from "../../../shared/automation/views";
import type { TaskPlan } from "../core/plan";
import type { TriggerRow } from "./records";
import { getTask, getRevisionRow, getTaskPlan, parseJson } from "./queries";
import { computePlanHash } from "../spec/grant";
import { initialTriggerState, initialDueAtMs } from "../core/triggers";

function waitingForSignal(adb: AutomationDatabase, row: TriggerRow): boolean {
  const trigger = getTaskPlan(adb, row.task_id, row.revision)?.triggers.find((plan) => plan.id === row.trigger_id);
  if (trigger?.kind !== "watch" || trigger.mode.type !== "items" || trigger.mode.emit.kind !== "signal") return false;
  const count = adb.db
    .prepare(
      `SELECT COUNT(*) AS count FROM steps s JOIN runs r ON r.id = s.run_id
    WHERE r.task_id = ? AND r.revision = ? AND r.phase = 'waiting' AND s.status = 'waiting'
      AND s.wait_kind = 'signal' AND s.signal_name = ?`,
    )
    .get(row.task_id, row.revision, trigger.mode.emit.name) as { count: number };
  return count.count > 0;
}
export function cleanupDrained(adb: AutomationDatabase): void {
  const rows = adb.db.prepare("SELECT * FROM triggers WHERE lifecycle = 'draining'").all() as unknown as TriggerRow[];
  for (const row of rows)
    if (!waitingForSignal(adb, row))
      adb.db
        .prepare("DELETE FROM triggers WHERE task_id = ? AND revision = ? AND trigger_id = ?")
        .run(row.task_id, row.revision, row.trigger_id);
}
function disarmTask(adb: AutomationDatabase, taskId: string): void {
  const rows = adb.db.prepare("SELECT * FROM triggers WHERE task_id = ?").all(taskId) as unknown as TriggerRow[];
  for (const row of rows) {
    if (waitingForSignal(adb, row))
      adb.db
        .prepare("UPDATE triggers SET lifecycle = 'draining' WHERE task_id = ? AND revision = ? AND trigger_id = ?")
        .run(taskId, row.revision, row.trigger_id);
    else
      adb.db
        .prepare("DELETE FROM triggers WHERE task_id = ? AND revision = ? AND trigger_id = ?")
        .run(taskId, row.revision, row.trigger_id);
  }
}
export function saveTask(adb: AutomationDatabase, spec: TaskSpec, plan: TaskPlan, required: RequiredGrant): TaskView {
  if (required.planHash !== computePlanHash(plan) || spec.id !== plan.id) throw new Error("Plan hash mismatch");
  const now = adb.clock.now();
  const previous = getTask(adb, spec.id);
  const revision = (previous?.currentRevision ?? 0) + 1;
  disarmTask(adb, spec.id);
  if (previous)
    adb.db
      .prepare(
        "UPDATE tasks SET name = ?, cwd = ?, current_revision = ?, enabled_revision = NULL, updated_at_ms = ? WHERE id = ?",
      )
      .run(spec.name, spec.cwd, revision, now, spec.id);
  else
    adb.db
      .prepare(
        "INSERT INTO tasks (id, name, cwd, current_revision, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(spec.id, spec.name, spec.cwd, revision, now, now);
  adb.db
    .prepare(
      "INSERT INTO task_revisions (task_id, revision, source_json, plan_json, plan_hash, required_grant_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      spec.id,
      revision,
      JSON.stringify(spec),
      JSON.stringify(plan),
      required.planHash,
      JSON.stringify(required),
      now,
    );
  adb.notifyChange({ kind: "task_saved", taskId: spec.id });
  return getTask(adb, spec.id)!;
}
export function enableTask(
  adb: AutomationDatabase,
  taskId: string,
  revision: number,
  hash: string,
  consent: DesktopConsent,
): TaskView {
  const task = getTask(adb, taskId);
  const row = getRevisionRow(adb, taskId, revision);
  if (!task || !row) throw new Error("Task revision not found");
  if (task.currentRevision !== revision) throw new Error("Revision is not current");
  const plan = parseJson<TaskPlan>(row.plan_json);
  const required = parseJson<RequiredGrant>(row.required_grant_json);
  if (row.plan_hash !== hash || required.planHash !== hash || computePlanHash(plan) !== hash)
    throw new Error("Plan hash mismatch");
  if (required.unattendedWrites.length && consent.unattendedWriteApproved !== true)
    throw new Error("Unattended write consent required");
  if (required.requiresTrustedLocalExecution && consent.trustedLocalExecApproved !== true)
    throw new Error("Trusted local execution consent required");
  if (task.enabledRevision === revision) return task;
  const now = adb.clock.now();
  const grant: ConfirmedGrant = { ...required, ...consent, confirmedAtMs: now };
  adb.db
    .prepare(
      `INSERT INTO grants (task_id, revision, plan_hash, grant_json, unattended_write_approved, trusted_local_exec_approved, confirmed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (task_id, revision) DO NOTHING`,
    )
    .run(
      taskId,
      revision,
      hash,
      JSON.stringify(grant),
      consent.unattendedWriteApproved ? 1 : 0,
      consent.trustedLocalExecApproved ? 1 : 0,
      now,
    );
  adb.db.prepare("UPDATE tasks SET enabled_revision = ?, updated_at_ms = ? WHERE id = ?").run(revision, now, taskId);
  for (const trigger of plan.triggers) {
    if (trigger.kind === "manual") continue;
    adb.db
      .prepare(
        `INSERT INTO triggers (task_id, revision, trigger_id, kind, lifecycle, armed_at_ms, next_due_at_ms, state_json)
      VALUES (?, ?, ?, ?, 'armed', ?, ?, ?) ON CONFLICT (task_id, revision, trigger_id) DO UPDATE SET
      lifecycle = 'armed', armed_at_ms = excluded.armed_at_ms, next_due_at_ms = excluded.next_due_at_ms, state_json = excluded.state_json, last_error_json = NULL`,
      )
      .run(
        taskId,
        revision,
        trigger.id,
        trigger.kind,
        now,
        initialDueAtMs(trigger, now),
        JSON.stringify(initialTriggerState(trigger)),
      );
    adb.notifyChange({ kind: "trigger_armed", taskId, triggerId: trigger.id });
  }
  adb.notifyChange({ kind: "task_enabled", taskId });
  return getTask(adb, taskId)!;
}
export function disableTask(adb: AutomationDatabase, taskId: string): TaskView {
  if (!getTask(adb, taskId)) throw new Error("Task not found");
  adb.db
    .prepare("UPDATE tasks SET enabled_revision = NULL, updated_at_ms = ? WHERE id = ?")
    .run(adb.clock.now(), taskId);
  disarmTask(adb, taskId);
  adb.notifyChange({ kind: "task_disabled", taskId });
  return getTask(adb, taskId)!;
}
export function deleteTask(adb: AutomationDatabase, taskId: string): void {
  const count = adb.db
    .prepare("SELECT COUNT(*) AS count FROM runs WHERE task_id = ? AND ended_at_ms IS NULL")
    .get(taskId) as { count: number };
  if (count.count) throw new Error("Cannot delete task with live runs");
  adb.db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  adb.notifyChange({ kind: "task_deleted", taskId });
}
