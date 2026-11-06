import type { Json, JsonSchema, TaskSpec, RequiredGrant, ConfirmedGrant } from "./spec";
import type {
  RunPhase,
  StepStatus,
  CommitOutcomeKind,
  TriggerKind,
  TriggerLifecycle,
  WaitKind,
  AttemptOrigin,
} from "./phases";

export interface TaskView {
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  readonly currentRevision: number;
  readonly enabledRevision: number | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface TaskRevisionView {
  readonly taskId: string;
  readonly revision: number;
  readonly source: TaskSpec;
  readonly planHash: string;
  readonly requiredGrant: RequiredGrant;
  readonly grant: ConfirmedGrant | null;
  readonly createdAtMs: number;
}

export interface RunSummaryView {
  readonly id: string;
  readonly taskId: string;
  readonly revision: number;
  readonly version: number;
  readonly phase: RunPhase;
  readonly laneKey: string | null;
  readonly admittedAtMs: number | null;
  readonly wakeAtMs: number | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly endedAtMs: number | null;
}

export interface TriggerView {
  readonly taskId: string;
  readonly revision: number;
  readonly triggerId: string;
  readonly kind: TriggerKind;
  readonly lifecycle: TriggerLifecycle;
  readonly armedAtMs: number;
  readonly nextDueAtMs: number;
  readonly lastError: Json | null;
}

export interface StepView {
  readonly stepIndex: number;
  readonly stepId: string;
  readonly status: StepStatus;
  readonly output: Json | null;
  readonly error: Json | null;
  readonly waitKind: WaitKind | null;
  readonly wakeAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly openedAtMs: number;
  readonly settledAtMs: number | null;
}

export interface AttemptView {
  readonly stepIndex: number;
  readonly attemptNo: number;
  readonly origin: AttemptOrigin;
  readonly sessionId: string | null;
  readonly startedAtMs: number;
  readonly settledAtMs: number | null;
  readonly outcome: CommitOutcomeKind | null;
  readonly detail: Json | null;
}

export interface RunDetailView extends RunSummaryView {
  readonly triggerFact: Json;
  readonly input: Json;
  readonly dedupeKey: string | null;
  readonly leaseToken: string | null;
  readonly end: Json | null;
  readonly steps: readonly StepView[];
  readonly attempts: readonly AttemptView[];
}

export interface InboxApprovalItem {
  readonly kind: "approval";
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly runId: string;
  readonly stepIndex: number;
  readonly taskName: string;
  readonly title: string;
  readonly prompt: string | null;
  readonly show: Json | null;
  readonly fields: JsonSchema | null;
  readonly defaults: Json | null;
  readonly openedAtMs: number;
  readonly expiresAtMs: number | null;
}

export interface InboxAttentionItem {
  readonly kind: "attention";
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly runId: string;
  readonly stepIndex: number;
  readonly taskName: string;
  readonly stepId: string;
  readonly error: Json;
  readonly settledAtMs: number;
}

export type InboxItem = InboxApprovalItem | InboxAttentionItem;

export interface ApprovalResolution {
  readonly kind: "approval";
  readonly approved: boolean;
  readonly data?: Json;
}

export interface AttentionResolution {
  readonly kind: "attention";
  readonly action: "mark_succeeded" | "retry" | "mark_failed" | "confirm_cancelled";
  readonly output?: Json;
}

export type InboxResolution = ApprovalResolution | AttentionResolution;

export interface FireRequest {
  readonly taskId: string;
  readonly triggerId: string;
  readonly expectedRevision?: number | null;
  readonly trigger?: Json;
  readonly input: Json;
  readonly dedupeKey?: string;
  readonly requestId?: string;
  readonly requestDigest?: string;
}

export interface FireResult {
  readonly outcome: "admitted" | "enqueued" | "skipped" | "dedupe_hit";
  readonly runId: string | null;
  readonly phase: RunPhase | null;
  readonly reason?: "lane_full" | "task_disabled" | "revision_mismatch" | "invalid_input" | "trigger_missing";
}

export interface ResolveInboxRequest {
  readonly runId: string;
  readonly stepIndex: number;
  readonly expectedVersion: number;
  readonly requestId: string;
  readonly requestDigest?: string;
  readonly resolution: InboxResolution;
}
export type ResolveInboxResult =
  | { readonly ok: true; readonly run: RunSummaryView }
  | {
      readonly ok: false;
      readonly reason: "already_resolved" | "not_found" | "invalid" | "kind_mismatch" | "version_conflict";
      readonly issues?: readonly string[];
    };

export interface SignalEmit {
  readonly name: string;
  readonly key: string;
  readonly eventId: string;
  readonly payload: Json;
}

export type AutomationEventKind =
  | "task.saved"
  | "task.enabled"
  | "task.disabled"
  | "task.deleted"
  | "trigger.armed"
  | "trigger.disarmed"
  | "run.created"
  | "run.phase_changed"
  | "run.ended"
  | "step.opened"
  | "step.settled"
  | "attempt.started"
  | "attempt.settled"
  | "signal.emitted";

export interface AutomationEvent {
  readonly kind: AutomationEventKind;
  readonly taskId?: string;
  readonly runId?: string;
  readonly stepIndex?: number;
  readonly attemptNo?: number;
  readonly timestamp: number;
}
