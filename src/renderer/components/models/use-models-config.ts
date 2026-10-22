import { useCallback, useEffect, useReducer, useState } from "react";
import { useI18n } from "@/i18n";
import {
  addModelTransition,
  deleteProviderTransition,
  modelsConfigEditorReducer,
  renameProviderEntry,
  replaceModelEntry,
  selectionAfterProviderRename,
  type ModelEntry,
  type ModelsConfigUpdate,
  type ModelsJson,
  type ProviderEntry,
} from "@/lib/models-config-state";
import { getModelPreferences, setModelPreferences } from "@/lib/api-client";
import type { ModelPreferencesResult } from "@contract/types";
import type { ApiKeyProvider, OAuthProvider, Selection } from "./types";

export function useModelsConfig({ cwd, onChanged }: { cwd: string | null; onChanged?: () => void }) {
  const { t } = useI18n();
  const [{ config, selection }, dispatchEditor] = useReducer(modelsConfigEditorReducer, {
    config: { providers: {} },
    selection: null,
  });
  const setConfig = useCallback((update: ModelsConfigUpdate) => dispatchEditor({ type: "config.update", update }), []);
  const setSelection = useCallback(
    (nextSelection: Selection | null) => dispatchEditor({ type: "selection.set", selection: nextSelection }),
    [],
  );
  const [configVersion, setConfigVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
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

  const [loadFailed, setLoadFailed] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  const loadModelsConfig = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setConfigLoaded(false);
    try {
      const response = await fetch("/api/models-config");
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const snapshot = (await response.json()) as { config?: ModelsJson; version?: string; error?: string };
      if (snapshot.error) throw new Error(snapshot.error);
      if (!snapshot.config || typeof snapshot.version !== "string") throw new Error("Invalid models config snapshot");
      const normalized = snapshot.config.providers ? snapshot.config : { ...snapshot.config, providers: {} };
      const keys = Object.keys(normalized.providers ?? {});
      dispatchEditor({
        type: "config.replace",
        config: normalized,
        selection: keys.length > 0 ? { type: "provider", name: keys[0] } : null,
      });
      setConfigVersion(snapshot.version);
      setConfigLoaded(true);
      setSaveConflict(false);
      setSaveError(null);
    } catch (error) {
      setLoadFailed(true);
      setSaveError(error instanceof Error ? error.message : String(error));
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

  const addCustomProvider = useCallback(() => {
    dispatchEditor({ type: "provider.addCustom" });
  }, []);

  const updateProvider = useCallback(
    (name: string, p: ProviderEntry) => {
      setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
    },
    [setConfig],
  );

  const renameProvider = useCallback(
    (oldName: string, newName: string) => {
      const result = renameProviderEntry(config, oldName, newName);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setSaveError(null);
      setConfig(result.config);
      setSelection(selectionAfterProviderRename(selection, oldName, result.name));
    },
    [config, selection, setConfig, setSelection],
  );

  const deleteProvider = useCallback(
    (name: string) => {
      const transition = deleteProviderTransition(config, selection, name);
      setConfig(transition.config);
      setSelection(transition.selection);
    },
    [config, selection, setConfig, setSelection],
  );

  const addModel = useCallback(
    (providerName: string) => {
      const transition = addModelTransition(config, providerName);
      setConfig(transition.config);
      setSelection(transition.selection);
    },
    [config, setConfig, setSelection],
  );

  const updateModel = useCallback(
    (providerName: string, index: number, m: ModelEntry) => {
      setConfig((prev) => replaceModelEntry(prev, providerName, index, m));
    },
    [setConfig],
  );

  const removeModel = useCallback(
    (providerName: string, index: number) => {
      setConfig((prev) => {
        const provider = prev.providers?.[providerName] ?? {};
        const models = [...(provider.models ?? [])];
        models.splice(index, 1);
        return {
          ...prev,
          providers: {
            ...(prev.providers ?? {}),
            [providerName]: { ...provider, models: models.length ? models : undefined },
          },
        };
      });
      setSelection({ type: "provider", name: providerName });
    },
    [setConfig, setSelection],
  );

  const handleSave = useCallback(async () => {
    if (!configVersion) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, expectedVersion: configVersion }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string; code?: string; version?: string };
      if (!res.ok || d.error) {
        const conflict = res.status === 409 || d.code === "CONFLICT";
        setSaveConflict(conflict);
        setSaveError(
          conflict
            ? t(
                "modelConfigConflict",
                "models.json changed outside this editor. Your edits are preserved here; copy or compare them before reloading the disk version to merge manually.",
              )
            : (d.error ?? `HTTP ${res.status}`),
        );
      } else if (typeof d.version !== "string") {
        setSaveError("Invalid models config save response");
      } else {
        setConfigVersion(d.version);
        setSaveConflict(false);
        setSavedOk(true);
        onChanged?.();
        void loadModelPreferences();
        setTimeout(() => setSavedOk(false), 2000);
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config, configVersion, loadModelPreferences, onChanged, t]);

  const providers = Object.entries(config.providers ?? {});
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn);
  const activeApiKey = apiKeyProviders.filter((p) => p.configured);

  return {
    config,
    selection,
    setConfig,
    setSelection,
    configVersion,
    loading,
    saving,
    saveError,
    saveConflict,
    savedOk,
    oauthProviders,
    apiKeyProviders,
    modelPreferences,
    modelPreferencesLoading,
    modelPreferencesSaving,
    modelPreferencesError,
    updateModelPreferences,
    refreshOAuthProviders,
    refreshApiKeyProviders,
    loadFailed,
    configLoaded,
    loadModelsConfig,
    addCustomProvider,
    updateProvider,
    renameProvider,
    deleteProvider,
    addModel,
    updateModel,
    removeModel,
    handleSave,
    providers,
    activeOAuth,
    activeApiKey,
  };
}
