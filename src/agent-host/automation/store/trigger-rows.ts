import type { AutomationDatabase } from "./db";
import type { TriggerLifecycle } from "../../../shared/automation/phases";
import type { ScheduleTriggerPlan, WatchTriggerPlan } from "../core/plan";
import {
  reduceWatchSample,
  planScheduleTick,
  createCalendar,
  type WatchSample,
  type TriggerState,
  type SlotCalendar,
} from "../core/triggers";
import { resolveValue } from "../spec/values";
import { getTaskPlan, parseJson, nullableJson } from "./queries";
import { fire } from "./run-rows";
import { emitSignal } from "./wait-rows";
import type { TriggerRow } from "./records";

export interface DueTrigger {
  readonly key: string;
  readonly taskId: string;
  readonly revision: number;
  readonly triggerId: string;
  readonly lifecycle: TriggerLifecycle;
  readonly armedAtMs: number;
  readonly nextDueAtMs: number;
  readonly plan: ScheduleTriggerPlan | WatchTriggerPlan;
  readonly state: TriggerState;
  readonly lastError: import("../../../shared/automation/spec").Json;
}
export function listDueTriggers(
  adb: AutomationDatabase,
  now: number,
  exclude: ReadonlySet<string> = new Set(),
): readonly DueTrigger[] {
  const rows = adb.db
    .prepare("SELECT * FROM triggers WHERE next_due_at_ms <= ? ORDER BY next_due_at_ms, task_id, revision, trigger_id")
    .all(now) as unknown as TriggerRow[];
  return rows.flatMap((row) => {
    const key = JSON.stringify([row.task_id, row.revision, row.trigger_id]);
    if (exclude.has(key)) return [];
    const plan = getTaskPlan(adb, row.task_id, row.revision)?.triggers.find((trigger) => trigger.id === row.trigger_id);
    if (!plan || plan.kind === "manual") throw new Error("Trigger plan not found");
    return [
      {
        key,
        taskId: row.task_id,
        revision: row.revision,
        triggerId: row.trigger_id,
        lifecycle: row.lifecycle,
        armedAtMs: row.armed_at_ms,
        nextDueAtMs: row.next_due_at_ms,
        plan,
        state: parseJson<TriggerState>(row.state_json),
        lastError: nullableJson(row.last_error_json),
      },
    ];
  });
}
function current(adb: AutomationDatabase, due: DueTrigger): TriggerRow | null {
  const row = adb.db
    .prepare("SELECT * FROM triggers WHERE task_id = ? AND revision = ? AND trigger_id = ?")
    .get(due.taskId, due.revision, due.triggerId) as unknown as TriggerRow | undefined;
  return row && row.armed_at_ms === due.armedAtMs && row.next_due_at_ms === due.nextDueAtMs ? row : null;
}
export function recordTriggerSample(
  adb: AutomationDatabase,
  due: DueTrigger,
  sample: WatchSample,
  now: number,
): { readonly discarded: boolean } {
  const row = current(adb, due);
  if (!row) return { discarded: true };
  if (due.plan.kind !== "watch") throw new Error("Expected watch trigger");
  const state = parseJson<TriggerState>(row.state_json);
  if (state.kind === "schedule") throw new Error("Expected watch state");
  const reduction = reduceWatchSample(due.plan, state, sample, now);
  if (row.lifecycle === "armed")
    for (const start of reduction.fires)
      fire(adb, {
        taskId: due.taskId,
        triggerId: due.triggerId,
        expectedRevision: due.revision,
        input: start.input,
        trigger: start.trigger,
        dedupeKey: start.dedupeKey ?? undefined,
      });
  for (const signal of reduction.signals) emitSignal(adb, due.taskId, signal);
  adb.db
    .prepare(
      "UPDATE triggers SET state_json = ?, next_due_at_ms = ?, last_error_json = ? WHERE task_id = ? AND revision = ? AND trigger_id = ? AND armed_at_ms = ?",
    )
    .run(
      JSON.stringify(reduction.state),
      reduction.nextDueAtMs,
      reduction.error === null ? null : JSON.stringify(reduction.error),
      due.taskId,
      due.revision,
      due.triggerId,
      due.armedAtMs,
    );
  adb.notifyChange({ kind: "trigger_due", taskId: due.taskId, triggerId: due.triggerId });
  return { discarded: false };
}
export function tickSchedule(
  adb: AutomationDatabase,
  due: DueTrigger,
  now: number,
  calendar?: SlotCalendar,
): { readonly discarded: boolean } {
  const row = current(adb, due);
  if (!row || row.lifecycle !== "armed") return { discarded: true };
  if (due.plan.kind !== "schedule") throw new Error("Expected schedule trigger");
  const tick = planScheduleTick(
    due.plan,
    row.next_due_at_ms,
    now,
    calendar ?? createCalendar(due.plan.calendar, due.armedAtMs),
  );
  const state = parseJson<TriggerState>(row.state_json);
  if (state.kind !== "schedule") throw new Error("Expected schedule state");
  if (tick.fire)
    fire(adb, {
      taskId: due.taskId,
      triggerId: due.triggerId,
      expectedRevision: due.revision,
      input: resolveValue(due.plan.input, { input: null, trigger: null, run: { id: "" }, steps: new Map() }),
      dedupeKey: tick.fire.dedupeKey,
      trigger: {
        kind: "schedule",
        triggerId: due.triggerId,
        firedAtMs: now,
        scheduledForMs: tick.fire.scheduledForMs,
        late: tick.fire.late,
      },
    });
  adb.db
    .prepare(
      "UPDATE triggers SET state_json = ?, next_due_at_ms = ? WHERE task_id = ? AND revision = ? AND trigger_id = ?",
    )
    .run(
      JSON.stringify({ kind: "schedule", lastFiredForMs: tick.fire?.scheduledForMs ?? state.lastFiredForMs }),
      tick.nextDueAtMs,
      due.taskId,
      due.revision,
      due.triggerId,
    );
  adb.notifyChange({ kind: "trigger_due", taskId: due.taskId, triggerId: due.triggerId });
  return { discarded: false };
}
export function nextWakeAtMs(adb: AutomationDatabase, exclude: ReadonlySet<string> = new Set()): number | null {
  const times = listDueTriggers(adb, Number.MAX_SAFE_INTEGER, exclude).map((due) => due.nextDueAtMs);
  const rows = adb.db
    .prepare(
      `SELECT MIN(wake_at_ms) AS at FROM runs WHERE phase = 'backoff'
    UNION ALL SELECT MIN(wake_at_ms) FROM steps WHERE status = 'waiting' AND wait_kind = 'duration'
    UNION ALL SELECT MIN(expires_at_ms) FROM steps WHERE status = 'waiting'`,
    )
    .all() as { at: number | null }[];
  for (const row of rows) if (row.at !== null) times.push(row.at);
  return times.length ? Math.min(...times) : null;
}
