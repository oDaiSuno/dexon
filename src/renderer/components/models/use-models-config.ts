import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import type { ModelsJson } from "@/lib/models-config-state";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { isRpcError, type ModelPreferencesResult, type ProviderChannelState } from "@contract/types";
import type { ApiKeyProvider, ModelSelectionControl, OAuthProvider } from "./types";

export type PersistResult = { ok: true } | { ok: false; error: string; conflict: boolean };

export function useModelsConfig({
  environmentId = PRIMARY_ENVIRONMENT_ID,
  cwd,
  onChanged,
}: {
  environmentId?: EnvironmentId;
  cwd: string | null;
  onChanged?: () => void;
}) {
  const api = useMemo(() => getEnvironmentApiClient(environmentId), [environmentId]);
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
  const [channels, setChannels] = useState<Record<string, ProviderChannelState>>({});
  const [channelSaving, setChannelSaving] = useState<string | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);

  const loadOAuthProviders = useCallback(() => {
    api
      .call("auth.providers")
      .then((d) => setOauthProviders(d.providers as unknown as OAuthProvider[]))
      .catch(() => {});
  }, [api]);

  const loadApiKeyProviders = useCallback(() => {
    api
      .call("auth.allProviders")
      .then((d) => setApiKeyProviders(d.providers as unknown as ApiKeyProvider[]))
      .catch(() => {});
  }, [api]);

  const loadChannels = useCallback(() => {
    api
      .getProviderChannels()
      .then((result) => setChannels(result.channels))
      .catch(() => {});
  }, [api]);

  const loadModelPreferences = useCallback(async () => {
    setModelPreferencesLoading(true);
    setModelPreferencesError(null);
    try {
      setModelPreferencesState(await api.getModelPreferences(cwd ?? undefined));
    } catch (error) {
      setModelPreferencesError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelPreferencesLoading(false);
    }
  }, [api, cwd]);

  const updateModelPreferences = useCallback(
    async (enabledModels: string[] | null) => {
      setModelPreferencesSaving(true);
      setModelPreferencesError(null);
      try {
        const result = await api.setModelPreferences(cwd ?? undefined, enabledModels);
        setModelPreferencesState(result);
        onChanged?.();
      } catch (error) {
        setModelPreferencesError(error instanceof Error ? error.message : String(error));
      } finally {
        setModelPreferencesSaving(false);
      }
    },
    [api, cwd, onChanged],
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
      const snapshot = await api.call("modelsConfig.get");
      if (!snapshot.config || typeof snapshot.version !== "string") throw new Error("Invalid models config snapshot");
      setConfig(snapshot.config.providers ? snapshot.config : { ...snapshot.config, providers: {} });
      setConfigVersion(snapshot.version);
    } catch (error) {
      setConfigVersion(null);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadModelsConfig();
    loadOAuthProviders();
    loadApiKeyProviders();
    loadChannels();
  }, [loadApiKeyProviders, loadChannels, loadModelsConfig, loadOAuthProviders]);

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
        const d = await api.call("modelsConfig.set", { config: next, expectedVersion: configVersion });
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
        const conflict = isRpcError(e) && e.code === "CONFLICT";
        return {
          ok: false,
          conflict,
          error: conflict
            ? t(
                "modelConfigConflict",
                "models.json changed outside this editor. Your edits are preserved here; copy or compare them before reloading the disk version to merge manually.",
              )
            : e instanceof Error
              ? e.message
              : String(e),
        };
      } finally {
        setSaving(false);
      }
    },
    [api, configVersion, loadModelPreferences, onChanged, t],
  );

  const setChannelEnabled = useCallback(
    async (provider: string, enabled: boolean) => {
      setChannelSaving(provider);
      setChannelError(null);
      try {
        const result = await api.setProviderChannelEnabled(provider, enabled);
        setChannels(result.channels);
        onChanged?.();
      } catch (error) {
        setChannelError(error instanceof Error ? error.message : String(error));
      } finally {
        setChannelSaving(null);
      }
    },
    [api, onChanged],
  );

  const testChannel = useCallback(
    async (provider: string) => {
      const result = await api.testProviderChannel(provider);
      setChannels((current) => ({
        ...current,
        [provider]: { enabled: current[provider]?.enabled ?? true, lastTest: result },
      }));
    },
    [api],
  );

  return {
    environmentId,
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
    channels,
    channelSaving,
    channelError,
    setChannelEnabled,
    testChannel,
    providers: Object.entries(config.providers ?? {}),
    activeApiKey: apiKeyProviders.filter((p) => p.configured),
  };
}

export type ModelsConfigEditor = ReturnType<typeof useModelsConfig>;

export function modelSelectionOf(editor: ModelsConfigEditor): ModelSelectionControl {
  return {
    preferences: editor.modelPreferences,
    loading: editor.modelPreferencesLoading,
    saving: editor.modelPreferencesSaving,
    error: editor.modelPreferencesError,
    onChange: editor.updateModelPreferences,
  };
}
