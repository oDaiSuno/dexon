import type { Json } from "../../../shared/automation/spec";
import type { EffectObservation } from "../../effect-observation";
import type { ActionCallPlan, ExecStepPlan } from "../core/plan";
import { createHttpAction } from "./http-action";
import { createChannelAction, channelPolicy } from "./channel-action";
import { createScriptAction } from "./script-action";
import { createAgentStepRunner } from "./agent-step";
import { interrupted, rejected } from "./observations";
import type { AttemptContext, SecretReader, AgentSessionPort, AutomationChannelPort, StepExecutors } from "./types";

type ActionRegistry = {
  [K in ActionCallPlan["action"]]: (
    call: Extract<ActionCallPlan, { action: K }>,
    context: AttemptContext,
  ) => Promise<EffectObservation<Json>>;
};
export function createStepExecutors(deps: {
  fetch: typeof fetch;
  secrets: SecretReader;
  channels: AutomationChannelPort;
  agentSessions: AgentSessionPort;
}): StepExecutors & { shutdown(): Promise<void> } {
  const script = createScriptAction(deps.secrets);
  const agent = createAgentStepRunner(deps.agentSessions);
  const actions: ActionRegistry = {
    "http.request": createHttpAction(deps),
    "channel.send": createChannelAction(deps.channels),
    "script.run": script.execute,
  };
  const policyFor = (step: ExecStepPlan) =>
    step.kind === "agent"
      ? step.effect
      : step.call.action === "channel.send"
        ? channelPolicy(step.call, deps.channels)
        : step.call.effect;
  return {
    policyFor,
    async execute(step, context) {
      try {
        if (step.kind === "agent") return await agent(step, context);
        const call = step.call;
        switch (call.action) {
          case "http.request":
            return await actions[call.action](call, context);
          case "channel.send":
            return await actions[call.action](call, context);
          case "script.run":
            return await actions[call.action](call, context);
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "invalid_input")
          return rejected("invalid_input", "Step references a missing input value");
        return interrupted(policyFor(step), {
          code: "internal",
          message: "Executor did not produce a conclusive result",
        });
      }
    },
    shutdown: () => script.shutdown(),
  };
}
