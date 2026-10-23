import { Field, SecretTextInput, TextInput } from "../form-controls";
import { useI18n } from "@/i18n";
import { ManagedModelsControl } from "./managed-models-control";
import { DetailSection, DetailSections, FieldHint } from "./provider-dialog-parts";
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
    <DetailSections>
      <DetailSection title={t("modelProvider", "Connection")} gap={14}>
        <p className="sr-only">
          {provider.configured
            ? t(
                "modelApiKeyStored",
                "API key is stored. Enter a new key below to replace it, or disconnect to remove it.",
              )
            : t("modelEnterApiKey", "Enter your {provider} API key to enable {count} models.")
                .replace("{provider}", provider.displayName)
                .replace("{count}", String(provider.modelCount))}{" "}
          {t("modelBaseUrlHint", "Overrides the endpoint for this provider. Takes effect after you click Save.")}
        </p>

        <Field labelSize="body" label={t("modelBaseUrl", "Base URL")}>
          <TextInput
            value={baseUrl}
            onChange={onBaseUrlChange}
            placeholder={t("modelBaseUrlPlaceholder", "Leave empty to use the provider default")}
            mono
          />
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
          <FieldHint>
            {t(
              "modelApiKeyStorageHint",
              "Stored only in auth.json on this computer. You can also enter $ENV_VAR_NAME, or start with ! to run a command.",
            )}
          </FieldHint>
        </Field>
      </DetailSection>

      {provider.configured && <ManagedModelsControl providerId={provider.id} {...modelSelection} />}
    </DetailSections>
  );
}
