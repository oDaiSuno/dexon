import { statSync } from "fs";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { RpcServer } from "../../contract/rpc";
import {
  RpcError,
  type DefaultThinkingLevel,
  type ModelCatalogStatus,
  type ModelDefaultsResult,
  type ModelInfo,
  type ModelPreferencesResult,
  type ModelsListResult,
} from "../../contract/types";
import {
  ModelCatalogService,
  resolveCatalogModels,
  type CatalogRuntime,
  type CatalogSnapshot,
} from "../model-catalog/index";
import { disabledProviderIds } from "../provider-channels";
import { filterByExactEnabledModels, stripThinkingSuffix } from "../session-model";

const THINKING_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const DEFAULT_THINKING_LEVEL = "medium";

function projectModelPreferences<T extends { id: string; name: string; provider: string }>(
  available: readonly T[],
  enabledModels: string[] | undefined,
): ModelPreferencesResult {
  const models: ModelInfo[] = available
    .map((model) => ({ id: model.id, name: model.name, provider: model.provider }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  const normalized = [...new Set((enabledModels ?? []).map(stripThinkingSuffix).filter(Boolean))];
  return { models, enabledModels: normalized.length > 0 ? normalized : null };
}

function normalizeEnabledModelsInput(value: unknown): string[] | undefined {
  if (value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 2000) {
    throw new RpcError({
      code: "BAD_REQUEST",
      message: "enabledModels must be null or a non-empty array with at most 2000 entries",
    });
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const valueEntry of value) {
    if (typeof valueEntry !== "string") {
      throw new RpcError({ code: "BAD_REQUEST", message: "Every enabled model reference must be a string" });
    }
    const modelReference = stripThinkingSuffix(valueEntry);
    if (!modelReference || modelReference.length > 512) {
      throw new RpcError({ code: "BAD_REQUEST", message: "Invalid enabled model reference" });
    }
    if (!seen.has(modelReference)) {
      seen.add(modelReference);
      normalized.push(modelReference);
    }
  }
  return normalized;
}

function hasMatchingEnabledModel<T extends { id: string; provider: string }>(
  available: readonly T[],
  enabledModels: string[],
): boolean {
  const refs = new Set(enabledModels);
  return available.some((model) => refs.has(`${model.provider}/${model.id}`) || refs.has(model.id));
}

function resolveModelsCwd(params: { cwd?: string } | void): string {
  const cwd = params?.cwd || process.cwd();
  try {
    const st = statSync(cwd);
    if (!st.isDirectory()) throw new Error("not-directory");
  } catch {
    throw new RpcError({ code: "BAD_REQUEST", message: `Directory does not exist: ${cwd}` });
  }
  return cwd;
}

function projectModelDefaults(
  available: readonly { id: string; provider: string }[],
  settings: SettingsManager,
): ModelDefaultsResult {
  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  const saved =
    provider && modelId && available.some((model) => model.provider === provider && model.id === modelId)
      ? { provider, modelId }
      : null;
  return { model: saved, thinkingLevel: settings.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL };
}

function normalizeModelDefaultsInput(
  body: { model?: unknown; thinkingLevel?: unknown },
  available: readonly { id: string; provider: string }[],
): { model?: { provider: string; modelId: string }; thinkingLevel?: DefaultThinkingLevel } {
  const wantsModel = body.model !== undefined && body.model !== null;
  const wantsThinking = body.thinkingLevel !== undefined && body.thinkingLevel !== null;
  if (!wantsModel && !wantsThinking) {
    throw new RpcError({ code: "BAD_REQUEST", message: "Provide a default model, a thinking level, or both" });
  }

  let model: { provider: string; modelId: string } | undefined;
  if (wantsModel) {
    const candidate = body.model as { provider?: unknown; modelId?: unknown } | null;
    if (typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new RpcError({ code: "BAD_REQUEST", message: "model must be an object with provider and modelId" });
    }
    const provider = candidate?.provider;
    const modelId = candidate?.modelId;
    if (typeof provider !== "string" || typeof modelId !== "string" || !provider || !modelId) {
      throw new RpcError({ code: "BAD_REQUEST", message: "model must be an object with provider and modelId" });
    }
    if (!available.some((entry) => entry.provider === provider && entry.id === modelId)) {
      throw new RpcError({ code: "BAD_REQUEST", message: `Model is not available: ${provider}/${modelId}` });
    }
    model = { provider, modelId };
  }

  let thinkingLevel: DefaultThinkingLevel | undefined;
  if (wantsThinking) {
    const level = body.thinkingLevel;
    if (typeof level !== "string" || !THINKING_SUFFIXES.has(level)) {
      throw new RpcError({ code: "BAD_REQUEST", message: "thinkingLevel is not a thinking level Pi accepts" });
    }
    thinkingLevel = level as DefaultThinkingLevel;
  }

  return { ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) };
}

export async function projectModelsList(
  source: CatalogSnapshot | CatalogRuntime,
  settings: SettingsManager,
  catalog?: ModelCatalogStatus,
): Promise<ModelsListResult> {
  const availability = "models" in source ? source : await resolveCatalogModels(source);
  const status = catalog ?? ("status" in source ? source.status : localCatalogStatus());
  const disabled = disabledProviderIds();
  const available = availability.models.filter((model) => !disabled.has(model.provider));
  const enabledModels = settings.getEnabledModels();
  const visible = filterByExactEnabledModels(available, enabledModels);
  const models = visible
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      ...(Array.isArray(model.input) ? { input: model.input } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider));

  const nameMap: Record<string, string> = {};
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};
  const effectiveThinkingLevels: Record<string, string> = {};
  const sharedThinkingLevel = settings.getDefaultThinkingLevel?.() ?? DEFAULT_THINKING_LEVEL;
  for (const model of visible) {
    const key = `${model.provider}:${model.id}`;
    nameMap[key] = model.name;
    thinkingLevels[key] = getSupportedThinkingLevels(model as Model<Api>);
    effectiveThinkingLevels[key] = clampThinkingLevel(
      model as Model<Api>,
      settings.getModelThinkingLevel?.(model.provider, model.id) ?? sharedThinkingLevel,
    );
    if (model.thinkingLevelMap) thinkingLevelMaps[key] = model.thinkingLevelMap;
  }

  let defaultModel: { provider: string; modelId: string } | null = null;
  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  if (provider && modelId && visible.some((model) => model.provider === provider && model.id === modelId)) {
    defaultModel = { provider, modelId };
  }

  return {
    models,
    defaultModel,
    thinkingLevels,
    thinkingLevelMaps,
    effectiveThinkingLevels,
    nameMap,
    catalog: availability.warnings.length
      ? { ...status, warnings: [...status.warnings, ...availability.warnings] }
      : status,
  };
}

function localCatalogStatus(): ModelCatalogStatus {
  return {
    source: process.env.PI_OFFLINE === undefined ? "cache" : "offline",
    refreshed: false,
    aborted: false,
    warnings: [],
  };
}

async function flushSettings(settings: SettingsManager): Promise<void> {
  await settings.flush();
  const errors = settings.drainErrors();
  if (errors.length > 0) throw new RpcError({ code: "INTERNAL", message: errors[0].error.message });
}

export function registerModelHandlers(server: RpcServer): () => Promise<void> {
  const catalog = new ModelCatalogService();
  const settingsFor = (cwd: string) => SettingsManager.create(cwd, getAgentDir());
  server.handle({
    "models.list": async (params) => {
      const cwd = resolveModelsCwd(params as { cwd?: string } | void);
      const snapshot = await catalog.get(cwd);
      return projectModelsList(snapshot, settingsFor(cwd), localCatalogStatus());
    },

    "models.refresh": async (params) => {
      const { requestId } = params as { cwd?: string; requestId: string };
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Invalid model refresh request id" });
      }
      const cwd = resolveModelsCwd(params);
      return projectModelsList(await catalog.refresh(cwd, requestId), settingsFor(cwd));
    },

    "models.refreshCancel": (params) => {
      const { requestId } = params as { requestId: string };
      return { ok: true as const, cancelled: catalog.cancelRefresh(requestId) };
    },

    "models.preferences.get": async (params) => {
      const cwd = resolveModelsCwd(params as { cwd?: string } | void);
      const { models } = await catalog.get(cwd);
      return projectModelPreferences(models, settingsFor(cwd).getEnabledModels());
    },

    "models.preferences.set": async (params) => {
      const body = params as { cwd?: string; enabledModels?: unknown };
      const cwd = resolveModelsCwd(body);
      const enabledModels = normalizeEnabledModelsInput(body.enabledModels);
      const { models } = await catalog.get(cwd, { fresh: true });
      if (enabledModels && !hasMatchingEnabledModel(models, enabledModels)) {
        throw new RpcError({ code: "BAD_REQUEST", message: "At least one available model must remain enabled" });
      }
      const settings = settingsFor(cwd);
      settings.setEnabledModels(enabledModels);
      await flushSettings(settings);
      return projectModelPreferences(models, enabledModels);
    },

    "models.defaults.get": async (params) => {
      const cwd = resolveModelsCwd(params as { cwd?: string } | void);
      const { models } = await catalog.get(cwd);
      return projectModelDefaults(models, settingsFor(cwd));
    },

    "models.defaults.set": async (params) => {
      const body = params as { cwd?: string; model?: unknown; thinkingLevel?: unknown };
      const cwd = resolveModelsCwd(body);
      const { models } = await catalog.get(cwd, { fresh: true });
      const defaults = normalizeModelDefaultsInput(body, models);
      const settings = settingsFor(cwd);
      if (defaults.model) settings.setDefaultModelAndProvider(defaults.model.provider, defaults.model.modelId);
      if (defaults.thinkingLevel) settings.setDefaultThinkingLevel(defaults.thinkingLevel);
      await flushSettings(settings);
      return projectModelDefaults(models, settings);
    },
  });
  return () => catalog.dispose();
}
