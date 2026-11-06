import type { Json, ConfirmedGrant } from "../../../shared/automation/spec";
import type { ChannelManager } from "../../channels/channel-manager";
import type { AutomationSessionLaunch, AutomationSessionHandle } from "../../session-launcher";
import type { EffectObservation } from "../../effect-observation";
import type { ExecStepPlan, EffectPolicy } from "../core/plan";
import type { ResolveContext } from "../spec/values";

export interface AttemptContext {
  readonly taskId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly attemptNo: number;
  readonly effectKey: string;
  readonly cwd: string;
  readonly grant: ConfirmedGrant;
  readonly values: ResolveContext;
  readonly signal: AbortSignal;
  readonly maxOutputBytes: number;
  onSession(sessionId: string): void;
}
export interface SecretReader {
  read(name: string): Promise<string | null>;
}
export type AutomationChannelPort = Pick<ChannelManager, "deliver" | "deliveryCapability">;
export type AgentSessionPort = {
  launch(launch: AutomationSessionLaunch<Json>): Promise<AutomationSessionHandle<Json>>;
};
export interface StepExecutors {
  policyFor(step: ExecStepPlan): EffectPolicy;
  execute(step: ExecStepPlan, context: AttemptContext): Promise<EffectObservation<Json>>;
}
