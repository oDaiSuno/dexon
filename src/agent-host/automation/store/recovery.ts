import type { AutomationDatabase } from "./db";
import { RunId } from "../core/plan";
import { recoverOrphan, type CommitOutcome } from "../core/run-machine";
import type { Json } from "../../../shared/automation/spec";
import { readSnapshot, getRunRow } from "./queries";
import { settleAttempt } from "./execution-rows";
import { settleCancelledRun } from "./cancel-rows";
import { setPhase, promoteLane, type ClaimedRun } from "./run-rows";
import { wakeDueRuns } from "./wait-rows";
import type { AttemptRow, RunRow } from "./records";

export interface RecoveryReport {
  readonly orphanedAttempts: number;
  readonly requeuedRuns: number;
  readonly crashLoops: readonly string[];
}
export function recover(adb: AutomationDatabase, now: number): RecoveryReport {
  const open = adb.db
    .prepare("SELECT * FROM attempts WHERE outcome IS NULL ORDER BY started_at_ms")
    .all() as unknown as AttemptRow[];
  const crashLoops: string[] = [];
  for (const row of open) {
    const run = getRunRow(adb, row.run_id)!;
    let outcome: CommitOutcome<Json> = {
      kind: "outcome_unknown",
      error: { code: "host_interrupted", message: "Host interrupted while attempt was open" },
    };
    const ticket = {
      runId: RunId(row.run_id),
      leaseToken: row.lease_token as ClaimedRun["leaseToken"],
      stepIndex: row.step_index,
      attemptNo: row.attempt_no,
      effectKey: row.effect_key,
      startedAtMs: row.started_at_ms,
    };
    if (run.ended_at_ms !== null) {
      settleAttempt(adb, ticket, outcome);
      continue;
    }
    const snapshot = readSnapshot(adb, run.id);
    const history = snapshot.attempts.filter((attempt) => attempt.stepIndex === row.step_index);
    const attempt = history.find((entry) => entry.attemptNo === row.attempt_no)!;
    const recovery = recoverOrphan(
      snapshot.run,
      snapshot.plan.steps[row.step_index],
      attempt,
      history.filter((entry) => entry.attemptNo !== row.attempt_no),
      now,
    );
    outcome = recovery.outcome!;
    if (recovery.error?.code === "crash_loop") crashLoops.push(run.id);
    settleAttempt(adb, ticket, outcome, recovery.decision);
  }
  const executing = adb.db
    .prepare("SELECT * FROM runs WHERE phase IN ('running','cancelling')")
    .all() as unknown as RunRow[];
  let requeuedRuns = 0;
  for (const row of executing) {
    if (row.phase === "cancelling")
      settleCancelledRun(adb, { runId: RunId(row.id), leaseToken: row.lease_token as ClaimedRun["leaseToken"] });
    else {
      setPhase(adb, row.id, "ready", now);
      requeuedRuns++;
    }
  }
  const retrying = adb.db
    .prepare("SELECT COUNT(*) AS count FROM runs WHERE phase = 'backoff' AND wake_at_ms <= ?")
    .get(now) as { count: number };
  requeuedRuns += retrying.count;
  wakeDueRuns(adb, now);
  const lanes = adb.db.prepare("SELECT DISTINCT lane_key FROM runs WHERE lane_key IS NOT NULL").all() as {
    lane_key: string;
  }[];
  for (const lane of lanes) promoteLane(adb, lane.lane_key, now);
  return { orphanedAttempts: open.length, requeuedRuns, crashLoops };
}
