import type { AutomationDatabase } from "./db";
import type { Json, ConfirmedGrant } from "../../../shared/automation/spec";
import type {
  TaskView,
  TaskRevisionView,
  RunSummaryView,
  RunDetailView,
  InboxItem,
} from "../../../shared/automation/views";
import type { RunPhase } from "../../../shared/automation/phases";
import { TaskId, RunId, type TaskPlan, type StepRecord, type AttemptRecord, type SignalRecord } from "../core/plan";
import type { RunView } from "../core/run-machine";
import type { TaskRow, RevisionRow, RunRow, StepRow, AttemptRow } from "./records";

export const parseJson = <T = Json>(value: string): T => JSON.parse(value) as T;
export const nullableJson = (value: string | null): Json | null => (value === null ? null : parseJson(value));
export function taskView(row: TaskRow): TaskView {
  return {
    id: row.id,
    name: row.name,
    cwd: row.cwd,
    currentRevision: row.current_revision,
    enabledRevision: row.enabled_revision,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}
export function getTask(adb: AutomationDatabase, id: string): TaskView | null {
  const row = adb.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? taskView(row) : null;
}
export function listTasks(adb: AutomationDatabase): readonly TaskView[] {
  return (adb.db.prepare("SELECT * FROM tasks ORDER BY created_at_ms DESC, id").all() as unknown as TaskRow[]).map(
    taskView,
  );
}
export function getRevisionRow(adb: AutomationDatabase, taskId: string, revision: number): RevisionRow | null {
  return (
    (adb.db
      .prepare("SELECT * FROM task_revisions WHERE task_id = ? AND revision = ?")
      .get(taskId, revision) as unknown as RevisionRow) ?? null
  );
}
export function getTaskPlan(adb: AutomationDatabase, taskId: string, revision: number): TaskPlan | null {
  const row = getRevisionRow(adb, taskId, revision);
  return row ? parseJson<TaskPlan>(row.plan_json) : null;
}
export function getTaskRevision(adb: AutomationDatabase, taskId: string, revision: number): TaskRevisionView | null {
  const row = getRevisionRow(adb, taskId, revision);
  if (!row) return null;
  const grant = adb.db
    .prepare("SELECT grant_json FROM grants WHERE task_id = ? AND revision = ?")
    .get(taskId, revision) as { grant_json: string } | undefined;
  return {
    taskId,
    revision,
    source: parseJson(row.source_json),
    planHash: row.plan_hash,
    requiredGrant: parseJson(row.required_grant_json),
    grant: grant ? parseJson(grant.grant_json) : null,
    createdAtMs: row.created_at_ms,
  };
}
export function getRunRow(adb: AutomationDatabase, id: string): RunRow | null {
  return (adb.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as unknown as RunRow) ?? null;
}
export function runSummary(row: RunRow): RunSummaryView {
  return {
    id: row.id,
    taskId: row.task_id,
    revision: row.revision,
    version: row.version,
    phase: row.phase,
    laneKey: row.lane_key,
    admittedAtMs: row.admitted_at_ms,
    wakeAtMs: row.wake_at_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    endedAtMs: row.ended_at_ms,
  };
}
export function readSteps(adb: AutomationDatabase, id: string, plan: TaskPlan): readonly StepRecord[] {
  return (
    adb.db.prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY step_index").all(id) as unknown as StepRow[]
  ).map((row) => ({
    stepIndex: row.step_index,
    stepId: plan.steps[row.step_index].id,
    status: row.status,
    output: nullableJson(row.output_json),
    error: nullableJson(row.error_json),
    waitKind: row.wait_kind,
    signalName: row.signal_name,
    signalKey: row.signal_key,
    wakeAtMs: row.wake_at_ms,
    expiresAtMs: row.expires_at_ms,
    requestJson: nullableJson(row.request_json),
    openedAtMs: row.opened_at_ms,
    settledAtMs: row.settled_at_ms,
  }));
}
export function readAttempts(adb: AutomationDatabase, id: string): readonly AttemptRecord[] {
  return (
    adb.db
      .prepare("SELECT * FROM attempts WHERE run_id = ? ORDER BY step_index, attempt_no")
      .all(id) as unknown as AttemptRow[]
  ).map((row) => ({
    stepIndex: row.step_index,
    attemptNo: row.attempt_no,
    effectKey: row.effect_key,
    policy: parseJson(row.policy_json),
    sessionId: row.session_id,
    origin: row.origin,
    startedAtMs: row.started_at_ms,
    settledAtMs: row.settled_at_ms,
    outcome: row.outcome,
    detail: nullableJson(row.detail_json),
  }));
}
export function readSignals(adb: AutomationDatabase, taskId: string): readonly SignalRecord[] {
  const rows = adb.db.prepare("SELECT * FROM signals WHERE task_id = ?").all(taskId) as {
    task_id: string;
    name: string;
    key: string;
    event_id: string;
    payload_json: string;
    first_emitted_at_ms: number;
    last_emitted_at_ms: number;
  }[];
  return rows.map((row) => ({
    taskId: TaskId(row.task_id),
    name: row.name,
    key: row.key,
    eventId: row.event_id,
    payload: parseJson(row.payload_json),
    firstEmittedAtMs: row.first_emitted_at_ms,
    lastEmittedAtMs: row.last_emitted_at_ms,
  }));
}
export interface RunSnapshot {
  readonly run: RunView;
  readonly plan: TaskPlan;
  readonly grant: ConfirmedGrant;
  readonly steps: readonly StepRecord[];
  readonly attempts: readonly AttemptRecord[];
  readonly signals: readonly SignalRecord[];
}
export function readSnapshot(adb: AutomationDatabase, id: string): RunSnapshot {
  const row = getRunRow(adb, id);
  if (!row) throw new Error("Run not found");
  const revision = getTaskRevision(adb, row.task_id, row.revision);
  const plan = getTaskPlan(adb, row.task_id, row.revision);
  if (!revision?.grant || !plan) throw new Error("Run revision is not granted");
  return {
    run: {
      id: RunId(id),
      taskId: TaskId(row.task_id),
      phase: row.phase,
      laneKey: row.lane_key,
      createdAtMs: row.created_at_ms,
      input: parseJson(row.input_json),
      trigger: parseJson(row.trigger_json),
      taskName: plan.name,
    },
    plan,
    grant: revision.grant,
    steps: readSteps(adb, id, plan),
    attempts: readAttempts(adb, id),
    signals: readSignals(adb, row.task_id),
  };
}
export function getRun(adb: AutomationDatabase, id: string): RunDetailView | null {
  const row = getRunRow(adb, id);
  if (!row) return null;
  const snapshot = readSnapshot(adb, id);
  return {
    ...runSummary(row),
    triggerFact: parseJson(row.trigger_json),
    input: parseJson(row.input_json),
    dedupeKey: row.dedupe_key,
    leaseToken: row.lease_token,
    end: nullableJson(row.end_json),
    steps: snapshot.steps,
    attempts: snapshot.attempts,
  };
}
export interface ListRunsOptions {
  readonly taskId?: string;
  readonly phases?: readonly RunPhase[];
  readonly limit?: number;
  readonly beforeMs?: number;
}
export function listRuns(adb: AutomationDatabase, opts: ListRunsOptions = {}): readonly RunSummaryView[] {
  const clauses: string[] = [];
  const args: (string | number)[] = [];
  if (opts.taskId !== undefined) {
    clauses.push("task_id = ?");
    args.push(opts.taskId);
  }
  if (opts.beforeMs !== undefined) {
    clauses.push("created_at_ms < ?");
    args.push(opts.beforeMs);
  }
  if (opts.phases?.length) {
    clauses.push(`phase IN (${opts.phases.map(() => "?").join(",")})`);
    args.push(...opts.phases);
  }
  const limit = opts.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error("Invalid run limit");
  args.push(limit);
  return (
    adb.db
      .prepare(
        `SELECT * FROM runs ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at_ms DESC, id LIMIT ?`,
      )
      .all(...args) as unknown as RunRow[]
  ).map(runSummary);
}
export function getInbox(adb: AutomationDatabase): readonly InboxItem[] {
  const runs = adb.db
    .prepare("SELECT * FROM runs WHERE phase IN ('waiting','attention') ORDER BY admitted_at_ms, id")
    .all() as unknown as RunRow[];
  const items: InboxItem[] = [];
  for (const row of runs) {
    const plan = getTaskPlan(adb, row.task_id, row.revision);
    if (!plan) throw new Error("Missing run plan");
    for (const step of readSteps(adb, row.id, plan)) {
      const common = {
        runId: row.id,
        taskId: row.task_id,
        expectedVersion: row.version,
        stepIndex: step.stepIndex,
        taskName: plan.name,
      };
      if (row.phase === "waiting" && step.status === "waiting" && step.waitKind === "approval") {
        const request = step.requestJson as {
          title: string;
          prompt: string | null;
          show: Json;
          fields: Json | null;
          defaults: Json;
        };
        items.push({
          ...common,
          kind: "approval",
          title: request.title,
          prompt: request.prompt,
          show: request.show,
          fields: request.fields as import("../../../shared/automation/spec").JsonSchema | null,
          defaults: request.defaults,
          openedAtMs: step.openedAtMs,
          expiresAtMs: step.expiresAtMs,
        });
      } else if (row.phase === "attention" && step.status === "unknown") {
        items.push({
          ...common,
          kind: "attention",
          stepId: step.stepId,
          error: step.error,
          settledAtMs: step.settledAtMs!,
        });
      }
    }
  }
  return items;
}
