import type { AgentSessionLike } from "../../shared/pi-types";
import { planModelAnchor, type ChosenSessionModel } from "../session-model";

export interface ChosenModelHost {
  readonly inner: AgentSessionLike;
  chosenModel(): ChosenSessionModel;
}

type PromptOptions = Parameters<AgentSessionLike["prompt"]>[1];

function anchorChosenModel(host: ChosenModelHost): void {
  const manager = host.inner.sessionManager;
  const plan = planModelAnchor(manager.getBranch(), host.chosenModel());
  if (!plan) return;
  if (plan.model) manager.appendModelChange(plan.model.provider, plan.model.modelId);
  if (plan.thinkingLevel) manager.appendThinkingLevelChange(plan.thinkingLevel);
}

export function promptOnChosenModel(host: ChosenModelHost, message: string, options?: PromptOptions): Promise<void> {
  if (!options?.streamingBehavior && !host.inner.isStreaming) anchorChosenModel(host);
  return host.inner.prompt(message, options);
}
