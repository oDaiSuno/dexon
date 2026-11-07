export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JsonSchema = { readonly [key: string]: Json };

export type Duration = `${number}${"s" | "m" | "h" | "d"}`;

export type StepRefPath =
  | "input"
  | `input.${string}`
  | `trigger.${string}`
  | `steps.${string}.output`
  | `steps.${string}.output.${string}`
  | "run.id"
  | "task.name";

export type ProbeRefPath = "probe.ok" | "probe.output" | `probe.output.${string}`;

export type ItemRefPath = "item" | `item.${string}`;

export type Ref<P extends string = StepRefPath> = { readonly $ref: P };

export type Tmpl = { readonly $tmpl: string };

export type Text = string | Tmpl;

export type Value<P extends string = StepRefPath> =
  Json | Ref<P> | Tmpl | readonly Value<P>[] | { readonly [key: string]: Value<P> };

export type CompareOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "exists";

export type Cond<P extends string = StepRefPath> =
  | { readonly all: readonly Cond<P>[] }
  | { readonly any: readonly Cond<P>[] }
  | { readonly not: Cond<P> }
  | { readonly ref: P; readonly op: CompareOp; readonly value?: Json };

export interface ChannelTarget {
  readonly accountId: string;
  readonly peerId: string;
}

export type SecretName = string;

export type EffectDecl = "read" | "unsafe" | { readonly idempotent: { readonly window: Duration | "forever" } };

export interface RetrySpec {
  readonly maxAttempts: number;
  readonly backoff: Duration;
  readonly factor?: number;
}

export type AgentWorkspaceTool = "read" | "write" | "edit" | "bash" | "grep" | "find";

export type SessionThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface StepCommon {
  readonly id: string;
  readonly title?: string;
  readonly when?: Cond;
  readonly stopRunIf?: Cond;
  readonly timeout?: Duration;
  readonly retry?: RetrySpec;
  readonly onFailure?: "fail_run" | "continue";
  readonly onUnknown?: "attention" | "continue";
}

export interface AgentStepSpec extends StepCommon {
  readonly kind: "agent";
  readonly prompt: Text;
  readonly data?: Value;
  readonly tools: readonly AgentWorkspaceTool[];
  readonly effect?: EffectDecl;
  readonly model?: { readonly provider: string; readonly modelId: string };
  readonly thinkingLevel?: SessionThinkingLevel;
  readonly output: { readonly schema: JsonSchema };
}

export interface HttpRequestSpec {
  readonly method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly url: {
    readonly origin: string;
    readonly path?: Text;
    readonly query?: Readonly<Record<string, Text>>;
  };
  readonly headers?: Readonly<Record<string, Text>>;
  readonly secretHeaders?: Readonly<Record<string, SecretName>>;
  readonly body?: Value;
  readonly expectStatus?: readonly number[];
  readonly timeout?: Duration;
  readonly effect?: EffectDecl;
}

export interface ChannelSendSpec {
  readonly to: ChannelTarget;
  readonly text: Text;
  readonly format?: "text" | "markdown";
  readonly attachments?: Value;
}

export interface ScriptRunSpec {
  readonly path: string;
  readonly args?: Value;
  readonly effect: EffectDecl;
  readonly secrets?: readonly SecretName[];
  readonly timeout?: Duration;
}

export type ActionCall =
  | { readonly action: "http.request"; readonly with: HttpRequestSpec }
  | { readonly action: "channel.send"; readonly with: ChannelSendSpec }
  | { readonly action: "script.run"; readonly with: ScriptRunSpec };

export type ActionKind = ActionCall["action"];

export interface ActionStepSpec extends StepCommon {
  readonly kind: "action";
  readonly call: ActionCall;
}

export interface ApprovalWaitSpec {
  readonly kind: "approval";
  readonly title: Text;
  readonly prompt?: Text;
  readonly show?: Value;
  readonly fields?: JsonSchema;
  readonly defaults?: Value;
  readonly notify?: { readonly to: ChannelTarget; readonly text?: Text };
}

export interface SignalWaitSpec {
  readonly kind: "signal";
  readonly signal: string;
  readonly key: Text;
  readonly history?: "run-start" | "retained";
}

export interface DurationWaitSpec {
  readonly kind: "duration";
  readonly duration: Duration;
}

export interface WaitStepSpec extends Omit<StepCommon, "retry" | "onUnknown"> {
  readonly kind: "wait";
  readonly wait: ApprovalWaitSpec | SignalWaitSpec | DurationWaitSpec;
  readonly expiresIn?: Duration;
  readonly onTimeout?: "fail" | "continue";
}

export type StepSpec = AgentStepSpec | ActionStepSpec | WaitStepSpec;

export type ProbeCall =
  | {
      readonly action: "http.request";
      readonly with: HttpRequestSpec & {
        readonly method?: "GET" | "HEAD";
        readonly effect?: "read";
      };
    }
  | {
      readonly action: "script.run";
      readonly with: ScriptRunSpec & { readonly effect: "read" };
    };

export type ThresholdMode = {
  readonly type: "threshold";
  readonly healthy: Cond<ProbeRefPath>;
  readonly consecutive: number;
  readonly cooldown?: Duration;
  readonly staleResetGap?: Duration;
};

export type ItemsMode = {
  readonly type: "items";
  readonly itemsPath: string;
  readonly keyPath: string;
  readonly cursorPath?: string;
  readonly dedupeWindow?: Duration;
  readonly match?: Cond<ItemRefPath>;
  readonly emit:
    | { readonly startRun: { readonly input?: Value<ItemRefPath> } }
    | { readonly emitSignal: string; readonly payload?: Value<ItemRefPath> };
};

export type ScheduleTriggerSpec =
  | {
      readonly id: string;
      readonly kind: "schedule";
      readonly cron: string;
      readonly tz?: string;
      readonly catchup?: "skip" | "once";
      readonly catchupWindow?: Duration;
      readonly input?: Value<never>;
    }
  | {
      readonly id: string;
      readonly kind: "schedule";
      readonly every: Duration;
      readonly catchup?: "skip" | "once";
      readonly catchupWindow?: Duration;
      readonly input?: Value<never>;
    };

export interface WatchTriggerSpec {
  readonly id: string;
  readonly kind: "watch";
  readonly every: Duration;
  readonly probe: ProbeCall;
  readonly staleResetGap?: Duration;
  readonly mode: ThresholdMode | ItemsMode;
}

export type ManualTriggerSpec = {
  readonly id: string;
  readonly kind: "manual";
};

export type TriggerSpec = ManualTriggerSpec | ScheduleTriggerSpec | WatchTriggerSpec;

export interface ConcurrencySpec {
  readonly lane?: {
    readonly key?: Text;
    readonly capacity: number;
    readonly overflow: "skip" | "queue" | "latest";
    readonly maxPending?: number;
  };
  readonly maxExecuting?: number;
}

export interface TaskSpec {
  readonly schema: "dexon.automation/v1";
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly cwd: string;
  readonly inputSchema?: JsonSchema;
  readonly triggers: readonly TriggerSpec[];
  readonly steps: readonly StepSpec[];
  readonly concurrency?: ConcurrencySpec;
}

export interface UnattendedWrite {
  readonly stepId: string;
  readonly kind: "channel_send" | "http_write" | "script_write" | "agent_write";
}

export interface RequiredGrant {
  readonly cwd: string;
  readonly agentTools: readonly AgentWorkspaceTool[];
  readonly channelTargets: readonly ChannelTarget[];
  readonly httpOrigins: readonly string[];
  readonly scripts: readonly { readonly path: string; readonly sha256: string }[];
  readonly secrets: readonly SecretName[];
  readonly unattendedWrites: readonly UnattendedWrite[];
  readonly allowedChannelTargets: readonly ChannelTarget[];
  readonly requiresTrustedLocalExecution: boolean;
  readonly stepEffects: readonly { readonly stepId: string; readonly effect: "read" | "idempotent" | "unsafe" }[];
  readonly planHash: string;
}

export interface DesktopConsent {
  readonly unattendedWriteApproved: boolean;
  readonly trustedLocalExecApproved: boolean;
}

export interface ConfirmedGrant extends RequiredGrant {
  readonly unattendedWriteApproved: boolean;
  readonly trustedLocalExecApproved: boolean;
  readonly confirmedAtMs: number;
}
