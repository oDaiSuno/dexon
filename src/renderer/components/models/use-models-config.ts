import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import type { ModelsJson } from "@/lib/models-config-state";
import { getModelPreferences, setModelPreferences } from "@/lib/api-client";
import type { ModelPreferencesResult } from "@contract/types";
import type { ApiKeyProvider, OAuthProvider } from "./types";

export type PersistResult = { ok: true } | { ok: false; error: string; conflict: boolean };

export function useModelsConfig({ cwd, onChanged }: { cwd: string | null; onChanged?: () => void }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [configVersion, setConfigVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [modelPreferences, setModelPreferencesState] = useState<ModelPreferencesResult | null>(null);
  const [modelPreferencesLoading, setModelPreferencesLoading] = useState(true);
  const [modelPreferencesSaving, setModelPreferencesSaving] = useState(false);
  const [modelPreferencesError, setModelPreferencesError] = useState<string | null>(null);

  const loadOAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers: OAuthProvider[] }) => setOauthProviders(d.providers))
      .catch(() => {});
  }, []);

  const loadApiKeyProviders = useCallback(() => {
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers: ApiKeyProvider[] }) => setApiKeyProviders(d.providers))
      .catch(() => {});
  }, []);

  const loadModelPreferences = useCallback(async () => {
    setModelPreferencesLoading(true);
    setModelPreferencesError(null);
    try {
      setModelPreferencesState(await getModelPreferences(cwd ?? undefined));
    } catch (error) {
      setModelPreferencesError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelPreferencesLoading(false);
    }
  }, [cwd]);

  const updateModelPreferences = useCallback(
    async (enabledModels: string[] | null) => {
      setModelPreferencesSaving(true);
      setModelPreferencesError(null);
      try {
        const result = await setModelPreferences(cwd ?? undefined, enabledModels);
        setModelPreferencesState(result);
        onChanged?.();
      } catch (error) {
        setModelPreferencesError(error instanceof Error ? error.message : String(error));
      } finally {
        setModelPreferencesSaving(false);
      }
    },
    [cwd, onChanged],
  );

  const refreshOAuthProviders = useCallback(() => {
    loadOAuthProviders();
    void loadModelPreferences();
  }, [loadModelPreferences, loadOAuthProviders]);

  const refreshApiKeyProviders = useCallback(() => {
    loadApiKeyProviders();
    void loadModelPreferences();
  }, [loadApiKeyProviders, loadModelPreferences]);

  const loadModelsConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/models-config");
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const snapshot = (await response.json()) as { config?: ModelsJson; version?: string; error?: string };
      if (snapshot.error) throw new Error(snapshot.error);
      if (!snapshot.config || typeof snapshot.version !== "string") throw new Error("Invalid models config snapshot");
      setConfig(snapshot.config.providers ? snapshot.config : { ...snapshot.config, providers: {} });
      setConfigVersion(snapshot.version);
    } catch (error) {
      setConfigVersion(null);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModelsConfig();
    loadOAuthProviders();
    loadApiKeyProviders();
  }, [loadApiKeyProviders, loadModelsConfig, loadOAuthProviders]);

  useEffect(() => {
    void loadModelPreferences();
  }, [loadModelPreferences]);

  const persist = useCallback(
    async (next: ModelsJson): Promise<PersistResult> => {
      if (!configVersion) {
        return {
          ok: false,
          conflict: false,
          error: t("modelCannotSaveBeforeLoad", "Cannot save until config loads successfully"),
        };
      }
      setSaving(true);
      try {
        const res = await fetch("/api/models-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: next, expectedVersion: configVersion }),
        });
        const d = (await res.json()) as { success?: boolean; error?: string; code?: string; version?: string };
        if (!res.ok || d.error) {
          const conflict = res.status === 409 || d.code === "CONFLICT";
          return {
            ok: false,
            conflict,
            error: conflict
              ? t(
                  "modelConfigConflict",
                  "models.json changed outside this editor. Your edits are preserved here; copy or compare them before reloading the disk version to merge manually.",
                )
              : (d.error ?? `HTTP ${res.status}`),
          };
        }
        if (typeof d.version !== "string") {
          return { ok: false, conflict: false, error: "Invalid models config save response" };
        }
        setConfig(next);
        setConfigVersion(d.version);
        setSavedAt(Date.now());
        onChanged?.();
        void loadModelPreferences();
        return { ok: true };
      } catch (e) {
        return { ok: false, conflict: false, error: String(e) };
      } finally {
        setSaving(false);
      }
    },
    [configVersion, loadModelPreferences, onChanged, t],
  );

  return {
    config,
    configVersion,
    loading,
    loadError,
    saving,
    savedAt,
    oauthProviders,
    apiKeyProviders,
    modelPreferences,
    modelPreferencesLoading,
    modelPreferencesSaving,
    modelPreferencesError,
    updateModelPreferences,
    refreshOAuthProviders,
    refreshApiKeyProviders,
    loadModelsConfig,
    persist,
    providers: Object.entries(config.providers ?? {}),
    activeApiKey: apiKeyProviders.filter((p) => p.configured),
  };
}

export type ModelsConfigEditor = ReturnType<typeof useModelsConfig>;
