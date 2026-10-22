import {
  setProviderBaseUrl,
  type ModelEntry,
  type ModelsConfigUpdate,
  type ModelsJson,
  type ProviderEntry,
} from "@/lib/models-config-state";
import type { ModelPreferencesResult } from "@contract/types";
import { ApiKeyDetail } from "./api-key-detail";
import { ModelDetail } from "./model-detail";
import { OAuthDetail } from "./oauth-detail";
import { ProviderDetail } from "./provider-detail";
import type { ApiKeyProvider, OAuthProvider, Selection } from "./types";

export function SelectionDetail({
  loading,
  config,
  selection,
  setConfig,
  oauthProviders,
  apiKeyProviders,
  modelPreferences,
  modelPreferencesLoading,
  modelPreferencesSaving,
  modelPreferencesError,
  updateModelPreferences,
  refreshOAuthProviders,
  refreshApiKeyProviders,
  updateProvider,
  renameProvider,
  deleteProvider,
  updateModel,
  removeModel,
}: {
  loading: boolean;
  config: ModelsJson;
  selection: Selection | null;
  setConfig: (update: ModelsConfigUpdate) => void;
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  modelPreferences: ModelPreferencesResult | null;
  modelPreferencesLoading: boolean;
  modelPreferencesSaving: boolean;
  modelPreferencesError: string | null;
  updateModelPreferences: (enabledModels: string[] | null) => Promise<void>;
  refreshOAuthProviders: () => void;
  refreshApiKeyProviders: () => void;
  updateProvider: (name: string, provider: ProviderEntry) => void;
  renameProvider: (oldName: string, newName: string) => void;
  deleteProvider: (name: string) => void;
  updateModel: (providerName: string, index: number, model: ModelEntry) => void;
  removeModel: (providerName: string, index: number) => void;
}) {
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return (
        <OAuthDetail
          key={p.id}
          provider={p}
          onRefresh={refreshOAuthProviders}
          modelSelection={{
            preferences: modelPreferences,
            loading: modelPreferencesLoading,
            saving: modelPreferencesSaving,
            error: modelPreferencesError,
            onChange: updateModelPreferences,
          }}
        />
      );
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return (
        <ApiKeyDetail
          key={p.id}
          provider={p}
          baseUrl={config.providers?.[p.id]?.baseUrl ?? ""}
          onBaseUrlChange={(baseUrl) => setConfig((prev) => setProviderBaseUrl(prev, p.id, baseUrl))}
          onRefresh={refreshApiKeyProviders}
          modelSelection={{
            preferences: modelPreferences,
            loading: modelPreferencesLoading,
            saving: modelPreferencesSaving,
            error: modelPreferencesError,
            onChange: updateModelPreferences,
          }}
        />
      );
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
      />
    );
  })();

  if (loading || !detailContent) return null;
  return <div style={{ padding: "var(--space-5)", background: "var(--fx-surface-raised)" }}>{detailContent}</div>;
}
