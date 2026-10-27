import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { SessionModelRef } from "../../shared/session-orchestration";
import type { SessionEntry } from "../../shared/types";
import type { AgentSessionWrapper } from "../rpc-manager";
import { getRpcSession } from "../rpc-manager";
import { chosenSessionModel, type ChosenSessionModel } from "../session-model";
import { usableModels } from "../session-model";
import { resolveSessionLeafId } from "../session-leaf";
import { openSessionSource } from "../session-source";

export interface SessionModelView extends ChosenSessionModel {
  modelAvailable: boolean;
}

export interface SessionModelChoice extends SessionModelRef {
  name: string;
  thinkingLevels: string[];
}

function branchEntries(entries: SessionEntry[], leafId: string | null): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: SessionEntry[] = [];
  let current = leafId ? byId.get(leafId) : entries.at(-1);
  while (current) {
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

export function modelAvailableIn(
  usable: readonly { id: string; provider: string }[] | null,
  ref: SessionModelRef | null,
): boolean {
  if (!ref || !usable) return true;
  return usable.some((model) => model.provider === ref.provider && model.id === ref.modelId);
}

export async function chosenModelView(sessionId: string): Promise<ChosenSessionModel> {
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) {
    return { model: live.sessionModel.current(live.inner), thinkingLevel: live.sessionModel.thinkingLevel(live.inner) };
  }
  const source = await openSessionSource(sessionId);
  if (!source) return { model: null, thinkingLevel: null };
  const leafId = resolveSessionLeafId(sessionId, source.entries, source.manager.getLeafId());
  return chosenSessionModel(branchEntries(source.entries, leafId));
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
