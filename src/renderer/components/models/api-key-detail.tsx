import { type ReactNode } from "react";
import { Field, SecretTextInput, TextInput } from "../form-controls";
import { useI18n } from "@/i18n";
import { ManagedModelsControl } from "./managed-models-control";
import { DetailSection, DetailSections, FieldHint } from "./provider-dialog-parts";
import type { ApiKeyProvider, ModelSelectionControl } from "./types";

function SavedNote() {
  const { t } = useI18n();
  return (
    <span role="status" className="type-label-default" style={{ color: "var(--fx-status-success-text)" }}>
      {t("saved", "Saved")}
    </span>
  );
}

export function ApiKeyDetail({
  provider,
  baseUrl,
  onBaseUrlChange,
  onBaseUrlBlur,
  apiKey,
  onApiKeyChange,
  onApiKeySave,
  savedField,
  modelSelection,
  connectionTest,
}: {
  provider: ApiKeyProvider;
  baseUrl: string;
  onBaseUrlChange: (baseUrl: string) => void;
  onBaseUrlBlur: () => void;
  apiKey: string;
  onApiKeyChange: (apiKey: string) => void;
  onApiKeySave: () => void;
  savedField: "baseUrl" | "apiKey" | null;
  modelSelection: ModelSelectionControl;
  connectionTest?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <DetailSections>
      <DetailSection title={t("modelProvider", "Connection")} gap={14}>
        <Field labelSize="body" label={t("modelBaseUrl", "Base URL")}>
          <TextInput
            value={baseUrl}
            onChange={onBaseUrlChange}
            onBlur={onBaseUrlBlur}
            placeholder={t("modelBaseUrlPlaceholder", "Leave empty to use the provider default")}
            mono
          />
          {savedField === "baseUrl" && <SavedNote />}
        </Field>

        <Field labelSize="body" label={t("modelApiKey", "API Key")}>
          <SecretTextInput
            value={apiKey}
            onChange={onApiKeyChange}
            onBlur={onApiKeySave}
            onKeyDown={(e) => {
              if (e.key === "Enter" && apiKey.trim()) onApiKeySave();
            }}
            placeholder={provider.configured ? t("modelReplaceApiKey", "Enter new key to replace…") : "sk-…"}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          {savedField === "apiKey" && <SavedNote />}
          <FieldHint>
            {t(
              "modelApiKeyStorageHint",
              "Stored only in auth.json on this computer. You can also enter $ENV_VAR_NAME, or start with ! to run a command.",
            )}
          </FieldHint>
        </Field>
        {connectionTest}
      </DetailSection>

      {provider.configured && <ManagedModelsControl providerId={provider.id} {...modelSelection} />}
    </DetailSections>
  );
}
