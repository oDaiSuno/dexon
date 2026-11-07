import type { AutomationDatabase } from "./db";
import type { SignalEmit } from "../../../shared/automation/views";
import { RunId } from "../core/plan";
import { getRunRow } from "./queries";
import { runPlan } from "./run-rows";
import { setPhase, settleStep, endRun } from "./run-rows";
import { cleanupDrained } from "./task-rows";
import { withReceipt } from "./receipts";
import type { StepRow, RunRow } from "./records";

export function emitSignal(
  adb: AutomationDatabase,
  taskId: string,
  emit: SignalEmit,
): { readonly woke: readonly ReturnType<typeof RunId>[] } {
  if (!emit.name || !emit.eventId) throw new Error("Signal name and event ID are required");
  const woke: ReturnType<typeof RunId>[] = [];
  withReceipt(adb, `signal:${JSON.stringify([taskId, emit.name, emit.key])}`, emit.eventId, emit, () => {
    const now = adb.clock.now();
    wakeDueRuns(adb, now);
    adb.db
      .prepare(
        `INSERT INTO signals (task_id, name, key, event_id, payload_json, first_emitted_at_ms, last_emitted_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (task_id, name, key) DO UPDATE SET
      event_id = excluded.event_id, payload_json = excluded.payload_json, last_emitted_at_ms = excluded.last_emitted_at_ms`,
      )
      .run(taskId, emit.name, emit.key, emit.eventId, JSON.stringify(emit.payload), now, now);
    const waiting = adb.db
      .prepare(
        `SELECT s.* FROM steps s JOIN runs r ON r.id = s.run_id WHERE r.task_id = ?
      AND r.phase = 'waiting' AND s.status = 'waiting' AND s.wait_kind = 'signal' AND s.signal_name = ? AND s.signal_key = ?`,
      )
      .all(taskId, emit.name, emit.key) as unknown as StepRow[];
    for (const row of waiting) {
      const run = getRunRow(adb, row.run_id)!;
      const step = runPlan(adb, run).steps[row.step_index];
      if (step.kind !== "wait" || step.wait.kind !== "signal") throw new Error("Signal wait plan mismatch");
      if (step.wait.history !== "retained" && now < run.created_at_ms) continue;
      settleStep(adb, run.id, step, "done", emit.payload, now);
      setPhase(adb, run.id, "ready", now);
      woke.push(RunId(run.id));
    }
    cleanupDrained(adb);
    adb.notifyChange({ kind: "signal_emitted", taskId, name: emit.name });
    return { accepted: true };
  });
  return { woke };
}
export function wakeDueRuns(adb: AutomationDatabase, now: number): void {
  const backoffs = adb.db
    .prepare("SELECT * FROM runs WHERE phase = 'backoff' AND wake_at_ms <= ?")
    .all(now) as unknown as RunRow[];
  for (const run of backoffs) setPhase(adb, run.id, "ready", now);
  const waits = adb.db
    .prepare(
      `SELECT s.* FROM steps s JOIN runs r ON r.id = s.run_id WHERE r.phase = 'waiting' AND s.status = 'waiting'
    AND ((s.expires_at_ms IS NOT NULL AND s.expires_at_ms <= ?) OR (s.wait_kind = 'duration' AND s.wake_at_ms <= ?))`,
    )
    .all(now, now) as unknown as StepRow[];
  for (const row of waits) {
    const run = getRunRow(adb, row.run_id)!;
    const step = runPlan(adb, run).steps[row.step_index];
    if (step.kind !== "wait") throw new Error("Wait plan mismatch");
    const durationWon =
      row.wait_kind === "duration" &&
      row.wake_at_ms !== null &&
      row.wake_at_ms <= now &&
      (row.expires_at_ms === null || row.wake_at_ms <= row.expires_at_ms);
    if (durationWon || step.onTimeout === "continue") {
      settleStep(adb, run.id, step, "done", durationWon ? null : { timedOut: true }, now);
      setPhase(adb, run.id, "ready", now);
    } else {
      const error = { code: "timeout", message: "Wait expired" };
      settleStep(adb, run.id, step, "failed", error, now);
      endRun(adb, run.id, "expired", { error }, now);
    }
  }
  cleanupDrained(adb);
}
