import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { ModelUnavailableError, type UnavailableModelRef } from "../../contract/types";
import type { SessionModelRef } from "../../shared/session-orchestration";
import type { ModelAvailability } from "../session-model";
import { isModelUsable } from "../session-model";

export async function assertModelUsable(
  ref: SessionModelRef | null,
  modelRuntime: ModelAvailability,
  settingsManager: SettingsManager,
): Promise<void> {
  if (!ref) return;
  if (await isModelUsable(ref, modelRuntime, settingsManager)) return;
  throw new ModelUnavailableError(ref);
}

export function unavailableModelOf(error: unknown): UnavailableModelRef | null {
  const candidate = error as { code?: unknown; detail?: { provider?: unknown; modelId?: unknown } } | null | undefined;
  if (candidate?.code !== "MODEL_UNAVAILABLE") return null;
  const provider = candidate.detail?.provider;
  const modelId = candidate.detail?.modelId;
  if (typeof provider !== "string" || typeof modelId !== "string") return null;
  return { provider, modelId };
}
