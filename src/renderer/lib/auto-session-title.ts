import { readPromptIntent, titleSourceOf } from "@shared/prompt-intent";
import { getEnvironmentApiClient } from "./api-client";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { isRpcError, type SessionNamingModelRef, type SessionNamingSettingsResult } from "@contract/types";
import { trackSessionNaming } from "./session-naming-store";

export const AUTO_TITLE_STORAGE_KEY = "dexon:autoSessionTitle";
export const SESSION_NAMING_MODEL_STORAGE_KEY = "dexon:sessionNamingModel";

export type SessionNamingModel = SessionNamingModelRef;

export type SessionNamingLoadState =
  { status: "ready"; settings: SessionNamingSettingsResult } | { status: "unsupported" };

const settingsCache = new Map<EnvironmentId, SessionNamingLoadState>();
const loadingSettings = new Map<EnvironmentId, Promise<SessionNamingLoadState>>();

export function resetSessionNamingSettingsCache(): void {
  settingsCache.clear();
  loadingSettings.clear();
}

export function loadSessionNamingSettings(environmentId: EnvironmentId): Promise<SessionNamingLoadState> {
  const pending = loadingSettings.get(environmentId);
  if (pending) return pending;
  const request = readSessionNamingSettings(environmentId)
    .then((state) => {
      if (loadingSettings.get(environmentId) === request) settingsCache.set(environmentId, state);
      return state;
    })
    .finally(() => {
      if (loadingSettings.get(environmentId) === request) loadingSettings.delete(environmentId);
    });
  loadingSettings.set(environmentId, request);
  return request;
}

export function primeSessionNamingSettings(environmentId: EnvironmentId): void {
  if (settingsCache.has(environmentId)) return;
  void loadSessionNamingSettings(environmentId).catch(() => {});
}

async function readSessionNamingSettings(environmentId: EnvironmentId): Promise<SessionNamingLoadState> {
  let settings: SessionNamingSettingsResult;
  try {
    settings = await getEnvironmentApiClient(environmentId).call("models.sessionNaming.get", undefined);
  } catch (error) {
    if (isRpcError(error) && error.code === "METHOD_NOT_FOUND") return { status: "unsupported" };
    throw error;
  }
  if (environmentId === PRIMARY_ENVIRONMENT_ID && !settings.configured) {
    const enabled = isAutoSessionTitleEnabled();
    const model = getSessionNamingModel();
    if (!enabled || model) {
      settings = await saveSessionNamingSettings(environmentId, { enabled, model });
      try {
        window.localStorage.removeItem(AUTO_TITLE_STORAGE_KEY);
        window.localStorage.removeItem(SESSION_NAMING_MODEL_STORAGE_KEY);
      } catch {}
    }
  }
  return { status: "ready", settings };
}

export async function saveSessionNamingSettings(
  environmentId: EnvironmentId,
  patch: { enabled?: boolean; model?: SessionNamingModelRef | null },
): Promise<SessionNamingSettingsResult> {
  const settings = await getEnvironmentApiClient(environmentId).call("models.sessionNaming.set", patch);
  settingsCache.set(environmentId, { status: "ready", settings });
  return settings;
}

function readEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(AUTO_TITLE_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function isAutoSessionTitleEnabled(): boolean {
  return readEnabled();
}

export function setAutoSessionTitleEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.removeItem(AUTO_TITLE_STORAGE_KEY);
    else window.localStorage.setItem(AUTO_TITLE_STORAGE_KEY, "off");
  } catch {}
}

export function getSessionNamingModel(): SessionNamingModel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_NAMING_MODEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { provider?: unknown; modelId?: unknown };
    const { provider, modelId } = parsed ?? {};
    if (typeof provider !== "string" || typeof modelId !== "string") return null;
    if (
      !provider.trim() ||
      !modelId.trim() ||
      provider.length > 200 ||
      modelId.length > 200 ||
      /\p{Cc}/u.test(provider) ||
      /\p{Cc}/u.test(modelId)
    )
      return null;
    return { provider: provider.trim(), modelId: modelId.trim() };
  } catch {
    return null;
  }
}

export function setSessionNamingModel(model: SessionNamingModel | null): void {
  if (typeof window === "undefined") return;
  try {
    if (model) {
      window.localStorage.setItem(
        SESSION_NAMING_MODEL_STORAGE_KEY,
        JSON.stringify({ provider: model.provider, modelId: model.modelId }),
      );
    } else {
      window.localStorage.removeItem(SESSION_NAMING_MODEL_STORAGE_KEY);
    }
  } catch {
    return;
  }
}

export function shouldAutoTitleMessage(
  message: string,
  environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID,
): boolean {
  if (titleSourceOf(readPromptIntent(message)) === null) return false;
  const state = settingsCache.get(environmentId);
  if (state?.status === "ready") return state.settings.enabled;
  return state?.status === "unsupported" || environmentId === PRIMARY_ENVIRONMENT_ID
    ? isAutoSessionTitleEnabled()
    : true;
}

function legacyNamingModel(
  environmentId: EnvironmentId,
  trigger: "first-prompt" | "regenerate",
): SessionNamingModel | null {
  const state = settingsCache.get(environmentId);
  if (state?.status === "ready" && state.settings.configured) return null;
  return trigger === "regenerate" || state?.status === "unsupported" || environmentId === PRIMARY_ENVIRONMENT_ID
    ? getSessionNamingModel()
    : null;
}

export interface AutoSessionTitleOptions {
  sessionId: string;
  prompt: string;
  environmentId: EnvironmentId;
}

export async function requestAutoSessionTitle(options: AutoSessionTitleOptions): Promise<string | null> {
  const state = settingsCache.get(options.environmentId);
  if (state?.status === "ready" && !state.settings.enabled) return null;
  try {
    const namingModel = legacyNamingModel(options.environmentId, "first-prompt");
    const send = getEnvironmentApiClient(options.environmentId).call;
    const result = await send("agent.generateTitle", {
      sessionId: options.sessionId,
      trigger: "first-prompt",
      prompt: options.prompt,
      ...(namingModel ? { namingModel } : {}),
    });
    return result.title;
  } catch {
    return null;
  }
}

export async function regenerateSessionTitle(environmentId: EnvironmentId, sessionId: string): Promise<string | null> {
  const namingModel = legacyNamingModel(environmentId, "regenerate");
  return trackSessionNaming(sessionId, async () => {
    try {
      const result = await getEnvironmentApiClient(environmentId).call("agent.generateTitle", {
        sessionId,
        trigger: "regenerate",
        ...(namingModel ? { namingModel } : {}),
      });
      return result.title;
    } catch {
      return null;
    }
  });
}
