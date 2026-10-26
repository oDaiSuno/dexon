export const RECENT_MODELS_STORAGE_KEY = "dexon:recentModels";

const RECENT_MODELS_LIMIT = 3;

export interface RecentModel {
  provider: string;
  modelId: string;
}

function isRecentModel(value: unknown): value is RecentModel {
  if (!value || typeof value !== "object") return false;
  const { provider, modelId } = value as { provider?: unknown; modelId?: unknown };
  return typeof provider === "string" && typeof modelId === "string" && provider !== "" && modelId !== "";
}

export function readRecentModels(): RecentModel[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_MODELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecentModel)
      .slice(0, RECENT_MODELS_LIMIT)
      .map((model) => ({ provider: model.provider, modelId: model.modelId }));
  } catch {
    return [];
  }
}

export function rememberRecentModel(model: RecentModel): void {
  if (typeof window === "undefined") return;
  try {
    const next = [
      { provider: model.provider, modelId: model.modelId },
      ...readRecentModels().filter((entry) => entry.provider !== model.provider || entry.modelId !== model.modelId),
    ].slice(0, RECENT_MODELS_LIMIT);
    window.localStorage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}
