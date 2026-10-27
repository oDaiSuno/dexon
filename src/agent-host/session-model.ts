import type { Api, Model } from "@earendil-works/pi-ai";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { SessionModelRef } from "../shared/session-orchestration";
import type { SessionEntry } from "../shared/types";
import { disabledProviderIds } from "./provider-channels";

const THINKING_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export type AvailableModel = Model<Api>;

export interface ModelAvailability {
  getAvailableSnapshot(): readonly AvailableModel[];
  refresh(options?: { allowNetwork?: boolean }): Promise<unknown>;
}

const NO_MODEL_ID = "unknown";

export function isNoModel(model: { provider: string; id: string }): boolean {
  return model.provider === NO_MODEL_ID && model.id === NO_MODEL_ID;
}

export function stripThinkingSuffix(modelRef: string): string {
  const trimmed = modelRef.trim();
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex === -1) return trimmed;
  const suffix = trimmed.substring(colonIndex + 1);
  return THINKING_SUFFIXES.has(suffix) ? trimmed.substring(0, colonIndex) : trimmed;
}

export function filterByExactEnabledModels<T extends { id: string; provider: string }>(
  available: T[],
  enabledModels: string[] | undefined,
): T[] {
  if (!enabledModels || enabledModels.length === 0) return available;
  const refs = new Set(enabledModels.map(stripThinkingSuffix).filter(Boolean));
  const visible = available.filter((m) => refs.has(`${m.provider}/${m.id}`) || refs.has(m.id));
  return visible.length > 0 ? visible : available;
}

export interface ChosenSessionModel {
  model: SessionModelRef | null;
  thinkingLevel: string | null;
}

function signedModelOf(message: { role: string; provider?: unknown; model?: unknown }): SessionModelRef | null {
  if (message.role !== "assistant") return null;
  const provider = typeof message.provider === "string" ? message.provider.trim() : "";
  const modelId = typeof message.model === "string" ? message.model.trim() : "";
  return provider && modelId ? { provider, modelId } : null;
}

export function chosenSessionModel(entries: readonly SessionEntry[]): ChosenSessionModel {
  let changed: SessionModelRef | null = null;
  let signed: SessionModelRef | null = null;
  let thinkingLevel: string | null = null;
  for (const entry of entries) {
    if (entry.type === "model_change") changed = { provider: entry.provider, modelId: entry.modelId };
    else if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
    else if (entry.type === "message") signed = signedModelOf(entry.message) ?? signed;
  }
  return { model: changed ?? signed, thinkingLevel };
}

export async function usableModels(
  modelRuntime: ModelAvailability,
  settingsManager: SettingsManager,
): Promise<readonly AvailableModel[]> {
  await settingsManager.reload();
  await modelRuntime.refresh({ allowNetwork: false });
  const disabled = disabledProviderIds();
  const available = [...modelRuntime.getAvailableSnapshot()].filter((model) => !disabled.has(model.provider));
  return filterByExactEnabledModels(available, settingsManager.getEnabledModels());
}

export async function isModelUsable(
  ref: SessionModelRef,
  modelRuntime: ModelAvailability,
  settingsManager: SettingsManager,
): Promise<boolean> {
  const usable = await usableModels(modelRuntime, settingsManager);
  return usable.some((model) => model.provider === ref.provider && model.id === ref.modelId);
}
