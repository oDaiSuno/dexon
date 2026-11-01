import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { SessionModelRef } from "../../shared/session-orchestration";
import type { SessionEntry } from "../../shared/types";
import type { AgentSessionWrapper } from "../rpc-manager";
import { getRpcSession } from "../rpc-manager";
import { usableModels, type ChosenSessionModel } from "../session-model";
import { resolveSessionBranch } from "../session-leaf";
import { openSessionSource } from "../session-source";

export interface SessionModelView extends ChosenSessionModel {
  modelAvailable: boolean;
}

export interface SessionModelChoice extends SessionModelRef {
  name: string;
  thinkingLevels: string[];
}

export function modelAvailableIn(
  usable: readonly { id: string; provider: string }[] | null,
  ref: SessionModelRef | null,
): boolean {
  if (!ref || !usable) return true;
  return usable.some((model) => model.provider === ref.provider && model.id === ref.modelId);
}

export function liveModelChoice(sessionId: string, leafId?: string | null): ChosenSessionModel | null {
  const live = getRpcSession(sessionId);
  if (!live?.isAlive()) return null;
  if (leafId !== undefined && leafId !== live.inner.sessionManager.getLeafId()) return null;
  return live.chosenModel();
}

export function modelChoiceAt(
  sessionId: string,
  entries: readonly SessionEntry[],
  leafId: string | null,
): ChosenSessionModel {
  const { model, thinkingLevel } = resolveSessionBranch(sessionId, entries, { requestedLeafId: leafId });
  return { model, thinkingLevel };
}

export async function chosenModelView(sessionId: string): Promise<ChosenSessionModel> {
  const live = liveModelChoice(sessionId);
  if (live) return live;
  const source = await openSessionSource(sessionId);
  if (!source) return { model: null, thinkingLevel: null };
  const { model, thinkingLevel } = resolveSessionBranch(sessionId, source.entries, {
    fallbackLeafId: source.manager.getLeafId(),
  });
  return { model, thinkingLevel };
}

export async function sessionModelView(
  sessionId: string,
  usable: readonly { id: string; provider: string }[] | null,
): Promise<SessionModelView> {
  const chosen = await chosenModelView(sessionId);
  return { ...chosen, modelAvailable: modelAvailableIn(usable, chosen.model) };
}

export async function usableModelsOf(caller: AgentSessionWrapper | undefined) {
  if (!caller?.isAlive()) return null;
  return usableModels(caller.inner.modelRuntime, caller.inner.settingsManager);
}

export async function listModelChoices(
  caller: AgentSessionWrapper,
  provider: string | undefined,
): Promise<{ models: SessionModelChoice[] }> {
  const usable = (await usableModelsOf(caller)) ?? [];
  const chosen = provider ? usable.filter((model) => model.provider === provider) : usable;
  return {
    models: chosen.map((model) => ({
      provider: model.provider,
      modelId: model.id,
      name: model.name,
      thinkingLevels: getSupportedThinkingLevels(model),
    })),
  };
}
