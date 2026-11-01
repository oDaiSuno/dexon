import type { AgentSessionLike } from "../../shared/pi-types";
import type { SessionModelRef } from "../../shared/session-orchestration";
import { isNoModel, type ChosenSessionModel } from "../session-model";
import { assertModelUsable } from "./model-gate";

type ModelHolder = Pick<AgentSessionLike, "model">;

export class SessionModelState {
  private unresolved: SessionModelRef | null = null;

  adopt(ref: SessionModelRef): void {
    this.unresolved = { ...ref };
  }

  clear(): void {
    this.unresolved = null;
  }

  current(inner: ModelHolder): SessionModelRef | null {
    if (this.unresolved) return { ...this.unresolved };
    const model = inner.model;
    if (!model || isNoModel(model)) return null;
    return { provider: model.provider, modelId: model.id };
  }

  choice(inner: Pick<AgentSessionLike, "model" | "agent">): ChosenSessionModel {
    const level = inner.agent.state?.thinkingLevel;
    return { model: this.current(inner), thinkingLevel: typeof level === "string" && level ? level : null };
  }

  async assertUsable(inner: AgentSessionLike): Promise<void> {
    await assertModelUsable(this.current(inner), inner.modelRuntime, inner.settingsManager);
  }
}
