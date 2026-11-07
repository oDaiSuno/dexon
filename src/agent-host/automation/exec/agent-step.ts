import type { Json } from "../../../shared/automation/spec";
import type { EffectObservation } from "../../effect-observation";
import { createAutomationResultSink } from "../../agent-session/automation-result-tool";
import type { AgentStepPlan } from "../core/plan";
import { renderText, resolveValue } from "../spec/values";
import { rejected } from "./observations";
import type { AgentSessionPort, AttemptContext } from "./types";

export function createAgentStepRunner(sessions: AgentSessionPort) {
  return async (step: AgentStepPlan, ctx: AttemptContext): Promise<EffectObservation<Json>> => {
    if (step.tools.some((tool) => !ctx.grant.agentTools.includes(tool)))
      return rejected("grant_violation", "Agent tool is not approved");
    const prompt = renderText(step.prompt, ctx.values);
    const data = resolveValue(step.data, ctx.values);
    const sink = createAutomationResultSink<Json>(step.outputSchema);
    if (ctx.signal.aborted) return rejected("aborted", "Agent step cancelled before launch", true);
    let handle;
    try {
      handle = await sessions.launch({
        cwd: ctx.cwd,
        step: { taskId: ctx.taskId, runId: ctx.runId, stepId: ctx.stepId, attemptNo: ctx.attemptNo },
        tools: step.tools,
        result: { schema: step.outputSchema, sink },
        model: step.model,
        thinkingLevel: step.thinkingLevel,
      });
    } catch {
      return rejected("model_unavailable", "Automation session could not be launched", true);
    }
    try {
      ctx.onSession(handle.sessionId);
      const observed = await handle.runTurn(data === null ? prompt : `${prompt}\n\n${JSON.stringify(data)}`, {
        timeoutMs: step.timeoutMs ?? 300000,
        signal: ctx.signal,
      });
      return observed.kind === "applied" ? { kind: "applied", output: observed.output.result } : observed;
    } finally {
      await handle.dispose();
    }
  };
}
