import type { TaskSpec, DesktopConsent } from "../../../shared/automation/spec";
import type { FireRequest, SignalEmit, ResolveInboxRequest } from "../../../shared/automation/views";
import type { EffectPolicy, AttemptTicket } from "../core/plan";
import type { NextRunMove, CommitOutcome, AttemptSettlementDecision } from "../core/run-machine";
import type { Json } from "../../../shared/automation/spec";
import type { SlotCalendar, WatchSample } from "../core/triggers";
import {
  openAutomationDb,
  type AutomationDatabase,
  type Clock,
  type StoreChange,
  type StoreUnavailable,
  systemClock,
} from "./db";
import * as tasks from "./task-rows";
import * as runs from "./run-rows";
import * as execution from "./execution-rows";
import * as waits from "./wait-rows";
import * as queries from "./queries";
import * as triggers from "./trigger-rows";
import { resolveInbox } from "./inbox-rows";
import { cancelRun, settleCancelledRun } from "./cancel-rows";
import { recover } from "./recovery";
import { normalizeTaskSpec, type NormalizeOptions } from "../spec/normalize";
import { deriveRequiredGrant, hashScriptManifest } from "../spec/grant";

export class AutomationStore {
  private constructor(private readonly adb: AutomationDatabase) {}
  static open(file: string, clock: Clock = systemClock): AutomationStore | StoreUnavailable {
    const result = openAutomationDb(file, clock);
    return "unavailable" in result ? result : new AutomationStore(result);
  }
  close(): void {
    this.adb.close();
  }
  onCommit(listener: (change: StoreChange) => void): () => void {
    return this.adb.onCommit(listener);
  }
  saveTask(spec: TaskSpec, opts: NormalizeOptions = {}) {
    normalizeTaskSpec(spec, opts);
    const hashes = opts.scriptHashes ?? hashScriptManifest(spec);
    const plan = normalizeTaskSpec(spec, { scriptHashes: hashes });
    const required = deriveRequiredGrant(plan, spec, { scriptHashes: hashes });
    return this.adb.withTx(() => tasks.saveTask(this.adb, spec, plan, required));
  }
  saveRevision(spec: TaskSpec, opts: NormalizeOptions = {}) {
    return this.saveTask(spec, opts);
  }
  enableTask(taskId: string, revision: number, planHash: string, consent: DesktopConsent) {
    return this.adb.withTx(() => tasks.enableTask(this.adb, taskId, revision, planHash, consent));
  }
  enable(taskId: string, revision: number, planHash: string, consent: DesktopConsent) {
    return this.enableTask(taskId, revision, planHash, consent);
  }
  disableTask(taskId: string, cancelInFlight = false) {
    return this.adb.withTx(() => {
      const result = tasks.disableTask(this.adb, taskId);
      if (cancelInFlight) {
        for (const run of queries.listRuns(this.adb, { taskId, limit: 10000 }))
          if (run.endedAtMs === null) cancelRun(this.adb, run.id);
      }
      return result;
    });
  }
  disable(taskId: string, cancelInFlight = false) {
    return this.disableTask(taskId, cancelInFlight);
  }
  deleteTask(taskId: string): void {
    this.adb.withTx(() => tasks.deleteTask(this.adb, taskId));
  }
  fire(request: FireRequest) {
    return this.adb.withTx(() => runs.fire(this.adb, request));
  }
  claimNextReady() {
    return this.adb.withTx(() => runs.claimNextReady(this.adb));
  }
  readRun(lease: runs.ClaimedRun) {
    runs.requireLease(this.adb, lease);
    return queries.readSnapshot(this.adb, lease.runId);
  }
  beginAttempt(
    lease: runs.ClaimedRun,
    move: number | Extract<NextRunMove, { kind: "run_step" }>,
    policy: EffectPolicy,
  ): AttemptTicket {
    return this.adb.withTx(() =>
      execution.beginAttempt(this.adb, lease, typeof move === "number" ? move : move.stepIndex, policy),
    );
  }
  attachSession(ticket: AttemptTicket, sessionId: string): void {
    this.adb.withTx(() => execution.attachSession(this.adb, ticket, sessionId));
  }
  settleAttempt(ticket: AttemptTicket, outcome: CommitOutcome<Json>, decision?: AttemptSettlementDecision) {
    return this.adb.withTx(() => execution.settleAttempt(this.adb, ticket, outcome, decision));
  }
  commitMove(lease: runs.ClaimedRun, move: NextRunMove) {
    return this.adb.withTx(() => execution.commitMove(this.adb, lease, move));
  }
  emitSignal(taskId: string, emit: SignalEmit) {
    return this.adb.withTx(() => waits.emitSignal(this.adb, taskId, emit));
  }
  wakeDueRuns(now = this.adb.clock.now()): void {
    this.adb.withTx(() => waits.wakeDueRuns(this.adb, now));
  }
  resolveInbox(request: ResolveInboxRequest) {
    return this.adb.withTx(() => resolveInbox(this.adb, request));
  }
  cancelRun(runId: string) {
    return this.adb.withTx(() => cancelRun(this.adb, runId));
  }
  settleCancelledRun(lease: runs.ClaimedRun) {
    return this.adb.withTx(() => settleCancelledRun(this.adb, lease));
  }
  recover(now = this.adb.clock.now()) {
    return this.adb.withTx(() => recover(this.adb, now));
  }
  getTask(taskId: string) {
    return queries.getTask(this.adb, taskId);
  }
  listTasks() {
    return queries.listTasks(this.adb);
  }
  getTaskPlan(taskId: string, revision: number) {
    return queries.getTaskPlan(this.adb, taskId, revision);
  }
  getTaskRevision(taskId: string, revision: number) {
    return queries.getTaskRevision(this.adb, taskId, revision);
  }
  getRun(runId: string) {
    return queries.getRun(this.adb, runId);
  }
  getRunDetail(runId: string) {
    return this.getRun(runId);
  }
  listRuns(opts: queries.ListRunsOptions = {}) {
    return queries.listRuns(this.adb, opts);
  }
  listRunsByTask(taskId: string, limit = 50) {
    return this.listRuns({ taskId, limit });
  }
  listInbox() {
    return queries.getInbox(this.adb);
  }
  getInbox() {
    return this.listInbox();
  }
  listDueTriggers(now = this.adb.clock.now(), exclude: ReadonlySet<string> = new Set()) {
    return triggers.listDueTriggers(this.adb, now, exclude);
  }
  recordTriggerSample(due: triggers.DueTrigger, sample: WatchSample, now = this.adb.clock.now()) {
    return this.adb.withTx(() => triggers.recordTriggerSample(this.adb, due, sample, now));
  }
  tickSchedule(due: triggers.DueTrigger, now = this.adb.clock.now(), calendar?: SlotCalendar) {
    return this.adb.withTx(() => triggers.tickSchedule(this.adb, due, now, calendar));
  }
  nextWakeAtMs(exclude: ReadonlySet<string> = new Set()) {
    return triggers.nextWakeAtMs(this.adb, exclude);
  }
}
export { systemClock, type Clock, type StoreChange, type StoreUnavailable } from "./db";
export type { ClaimedRun } from "./run-rows";
export type { MoveCommit } from "./execution-rows";
export type { RunSnapshot } from "./queries";
export type { DueTrigger } from "./trigger-rows";
export type { RecoveryReport } from "./recovery";
