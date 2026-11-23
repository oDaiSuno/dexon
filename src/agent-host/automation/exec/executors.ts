import type { Json } from "../../../shared/automation/spec";
import type { EffectObservation } from "../../effect-observation";
import type { ActionCallPlan, ExecStepPlan } from "../core/plan";
import { createHttpAction } from "./http-action";
import { createChannelAction, channelPolicy } from "./channel-action";
import { createScriptAction } from "./script-action";
import { createAgentStepRunner } from "./agent-step";
import { interrupted, rejected } from "./observations";
import { createSecretUseScope, protectObservation } from "./secrets";
import type { AttemptContext, SecretReader, AgentSessionPort, AutomationChannelPort, StepExecutors } from "./types";

type ActionRegistry = {
  [K in ActionCallPlan["action"]]: (
    call: Extract<ActionCallPlan, { action: K }>,
    context: AttemptContext,
    secrets: SecretReader,
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
    "http.request": (call, context, secrets) => createHttpAction({ fetch: deps.fetch, secrets })(call, context),
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
      const secrets = createSecretUseScope(deps.secrets);
      try {
        let observed: EffectObservation<Json>;
        if (step.kind === "agent") observed = await agent(step, context);
        else {
          const call = step.call;
          switch (call.action) {
            case "http.request":
              observed = await actions[call.action](call, context, secrets);
              break;
            case "channel.send":
              observed = await actions[call.action](call, context, secrets);
              break;
            case "script.run":
              observed = await actions[call.action](call, context, secrets);
              break;
          }
        }
        return protectObservation(observed, policyFor(step), secrets);
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
