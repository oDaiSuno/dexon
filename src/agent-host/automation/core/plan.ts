import { randomUUID } from "node:crypto";
import type {
  Json,
  JsonSchema,
  Cond,
  Text,
  AgentWorkspaceTool,
  ChannelTarget,
  SessionThinkingLevel,
} from "../../../shared/automation/spec";
import type { StepStatus, WaitKind, CommitOutcomeKind } from "../../../shared/automation/phases";

declare const brand: unique symbol;
export type TaskId = string & { readonly [brand]: "TaskId" };
export type RunId = string & { readonly [brand]: "RunId" };
export type StepId = string & { readonly [brand]: "StepId" };
export type TriggerId = string & { readonly [brand]: "TriggerId" };
export type LeaseToken = string & { readonly [brand]: "LeaseToken" };
export const TaskId = (raw: string) => raw as TaskId;
export const RunId = (raw: string) => raw as RunId;
export const StepId = (raw: string) => raw as StepId;
export const TriggerId = (raw: string) => raw as TriggerId;
export const LeaseToken = () => randomUUID() as LeaseToken;

export interface AttemptTicket {
  readonly runId: RunId;
  readonly leaseToken: LeaseToken;
  readonly stepIndex: number;
  readonly attemptNo: number;
  readonly effectKey: string;
  readonly startedAtMs: number;
}

export type EffectPolicy =
  | { readonly kind: "read" }
  | { readonly kind: "idempotent"; readonly windowMs: number | null; readonly providerAccountId?: string }
  | { readonly kind: "unsafe"; readonly providerAccountId?: string };

interface StepPlanCommon {
  readonly stepIndex: number;
  readonly id: StepId;
  readonly title: string | null;
  readonly whenCond: Cond | null;
  readonly stopRunIfCond: Cond | null;
  readonly timeoutMs: number | null;
  readonly onFailure: "fail_run" | "continue";
  readonly generatedFrom: { readonly kind: "approval_notify"; readonly waitStepId: string } | null;
}

interface ExecCommon extends StepPlanCommon {
  readonly onUnknown: "attention" | "continue";
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly backoffFactor: number;
}

export interface AgentStepPlan extends ExecCommon {
  readonly kind: "agent";
  readonly prompt: Text;
  readonly data: Json | null;
  readonly tools: readonly AgentWorkspaceTool[];
  readonly effect: EffectPolicy;
  readonly model: { readonly provider: string; readonly modelId: string } | null;
  readonly thinkingLevel: SessionThinkingLevel | null;
  readonly outputSchema: JsonSchema;
}

export interface HttpActionPlan {
  readonly action: "http.request";
  readonly method: string;
  readonly origin: string;
  readonly pathTmpl: Text | null;
  readonly queryTmpl: Readonly<Record<string, Text>> | null;
  readonly headersTmpl: Readonly<Record<string, Text>> | null;
  readonly secretHeaders: Readonly<Record<string, string>> | null;
  readonly bodyTmpl: Json | null;
  readonly expectStatus: readonly number[];
  readonly timeoutMs: number;
  readonly effect: EffectPolicy;
}

export interface ChannelActionPlan {
  readonly action: "channel.send";
  readonly to: ChannelTarget;
  readonly textTmpl: Text;
  readonly format: "text" | "markdown";
  readonly attachmentsTmpl: Json | null;
}

export interface ScriptActionPlan {
  readonly action: "script.run";
  readonly path: string;
  readonly sha256: string;
  readonly argsTmpl: Json | null;
  readonly effect: EffectPolicy;
  readonly secrets: readonly string[];
  readonly timeoutMs: number;
}

export type ActionCallPlan = HttpActionPlan | ChannelActionPlan | ScriptActionPlan;
export interface ActionStepPlan extends ExecCommon {
  readonly kind: "action";
  readonly call: ActionCallPlan;
}

export interface ApprovalWaitPlan {
  readonly kind: "approval";
  readonly titleTmpl: Text;
  readonly promptTmpl: Text | null;
  readonly showTmpl: Json | null;
  readonly fieldsSchema: JsonSchema | null;
  readonly defaultsTmpl: Json | null;
}
export interface SignalWaitPlan {
  readonly kind: "signal";
  readonly signal: string;
  readonly keyTmpl: Text;
  readonly history: "run-start" | "retained";
}
export interface DurationWaitPlan {
  readonly kind: "duration";
  readonly durationMs: number;
}
export interface WaitStepPlan extends StepPlanCommon {
  readonly kind: "wait";
  readonly wait: ApprovalWaitPlan | SignalWaitPlan | DurationWaitPlan;
  readonly expiresInMs: number | null;
  readonly onTimeout: "fail" | "continue";
}
export type ExecStepPlan = AgentStepPlan | ActionStepPlan;
export type StepPlan = ExecStepPlan | WaitStepPlan;

export interface ScheduleTriggerPlan {
  readonly id: TriggerId;
  readonly kind: "schedule";
  readonly calendar: { readonly cron: string; readonly tz: string } | { readonly everyMs: number };
  readonly catchup: "skip" | "once";
  readonly catchupWindowMs: number;
  readonly misfireGraceMs: number;
  readonly input: Json | null;
}
export type WatchModePlan =
  | {
      readonly type: "threshold";
      readonly healthy: Cond<string>;
      readonly consecutive: number;
      readonly cooldownMs: number;
    }
  | {
      readonly type: "items";
      readonly itemsPath: string;
      readonly keyPath: string;
      readonly cursorPath: string | null;
      readonly dedupeWindowMs: number | null;
      readonly match: Cond<string> | null;
      readonly emit:
        | { readonly kind: "start"; readonly input: Json | null }
        | { readonly kind: "signal"; readonly name: string; readonly payload: Json | null };
    };
export interface WatchTriggerPlan {
  readonly id: TriggerId;
  readonly kind: "watch";
  readonly everyMs: number;
  readonly probe: HttpActionPlan | ScriptActionPlan;
  readonly staleResetGapMs: number | null;
  readonly mode: WatchModePlan;
}
export type TriggerPlan = { readonly id: TriggerId; readonly kind: "manual" } | ScheduleTriggerPlan | WatchTriggerPlan;
export interface LanePlan {
  readonly keyTmpl: Text | null;
  readonly capacity: number;
  readonly overflow: "skip" | "queue" | "latest";
  readonly maxPending: number;
}
export interface TaskPlan {
  readonly version: 1;
  readonly id: TaskId;
  readonly name: string;
  readonly cwd: string;
  readonly inputSchema: JsonSchema | null;
  readonly triggers: readonly TriggerPlan[];
  readonly steps: readonly StepPlan[];
  readonly lane: LanePlan | null;
  readonly maxExecuting: number;
}

export interface StepRecord {
  readonly stepIndex: number;
  readonly stepId: StepId;
  readonly status: StepStatus;
  readonly output: Json | null;
  readonly error: Json | null;
  readonly waitKind: WaitKind | null;
  readonly signalName: string | null;
  readonly signalKey: string | null;
  readonly wakeAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly requestJson: Json | null;
  readonly openedAtMs: number;
  readonly settledAtMs: number | null;
}
export interface AttemptRecord {
  readonly stepIndex: number;
  readonly attemptNo: number;
  readonly effectKey: string;
  readonly policy: EffectPolicy;
  readonly sessionId: string | null;
  readonly origin: "driver" | "user_retry";
  readonly startedAtMs: number;
  readonly settledAtMs: number | null;
  readonly outcome: CommitOutcomeKind | null;
  readonly detail: Json | null;
}
export interface SignalRecord {
  readonly taskId: TaskId;
  readonly name: string;
  readonly key: string;
  readonly eventId: string;
  readonly payload: Json;
  readonly firstEmittedAtMs: number;
  readonly lastEmittedAtMs: number;
}

export function effectPolicyFor(step: ExecStepPlan): EffectPolicy {
  if (step.kind === "agent") return step.effect;
  return step.call.action === "channel.send"
    ? { kind: "unsafe", providerAccountId: step.call.to.accountId }
    : step.call.effect;
}
