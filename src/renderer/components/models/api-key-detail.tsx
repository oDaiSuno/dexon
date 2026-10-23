import { Field, SecretTextInput, SectionTitle, TextInput } from "../form-controls";
import { useI18n } from "@/i18n";
import { ManagedModelsControl } from "./managed-models-control";
import type { ApiKeyProvider, ModelSelectionControl } from "./types";

export function ApiKeyDetail({
  provider,
  baseUrl,
  onBaseUrlChange,
  apiKey,
  onApiKeyChange,
  onSubmit,
  modelSelection,
}: {
  provider: ApiKeyProvider;
  baseUrl: string;
  onBaseUrlChange: (baseUrl: string) => void;
  apiKey: string;
  onApiKeyChange: (apiKey: string) => void;
  onSubmit: () => void;
  modelSelection: ModelSelectionControl;
}) {
  const { t } = useI18n();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionTitle>{t("modelApiKey", "API Key")}</SectionTitle>

      <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
        {provider.configured
          ? t(
              "modelApiKeyStored",
              "API key is stored. Enter a new key below to replace it, or disconnect to remove it.",
            )
          : t("modelEnterApiKey", "Enter your {provider} API key to enable {count} models.")
              .replace("{provider}", provider.displayName)
              .replace("{count}", String(provider.modelCount))}
      </p>

      <Field labelSize="body" label={t("modelBaseUrl", "Base URL")}>
        <TextInput
          value={baseUrl}
          onChange={onBaseUrlChange}
          placeholder={t("modelBaseUrlPlaceholder", "Leave empty to use the provider default")}
          mono
        />
        <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)", marginTop: 2 }}>
          {t("modelBaseUrlHint", "Overrides the endpoint for this provider. Takes effect after you click Save.")}
        </span>
      </Field>

      <Field labelSize="body" label={t("modelApiKey", "API Key")}>
        <SecretTextInput
          value={apiKey}
          onChange={onApiKeyChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && apiKey.trim()) onSubmit();
          }}
          placeholder={provider.configured ? t("modelReplaceApiKey", "Enter new key to replace…") : "sk-…"}
          autoComplete="off"
          spellCheck={false}
          mono
        />
      </Field>

      {provider.configured && <ManagedModelsControl providerId={provider.id} {...modelSelection} />}
    </div>
  );
}
