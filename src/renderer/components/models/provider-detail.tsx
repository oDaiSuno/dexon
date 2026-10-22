import { useEffect, useState } from "react";
import { Button, Field, SecretTextInput, Select, SectionTitle, TextInput } from "../form-controls";
import { useI18n } from "@/i18n";
import type { ProviderEntry } from "@/lib/models-config-state";
import { API_OPTIONS } from "./types";

export function ProviderDetail({
  name,
  provider,
  onChange,
  onRename,
  onDelete,
}: {
  name: string;
  provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void;
  onRename: (n: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [editingName, setEditingName] = useState(name);
  useEffect(() => setEditingName(name), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial provider load intentionally runs once.
  }, [provider.api]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("modelProvider", "Provider")}</SectionTitle>
        <Button variant="danger" onClick={onDelete}>
          {t("delete", "Delete")}
        </Button>
      </div>

      <Field label={t("modelProviderName", "Provider name")}>
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {editingName !== name && editingName.trim() && (
          <Button
            variant="primary"
            onClick={() => onRename(editingName.trim())}
            style={{ marginTop: 4, alignSelf: "flex-start" }}
          >
            {t("rename", "Rename")}
          </Button>
        )}
      </Field>

      <Field label={t("modelBaseUrl", "Base URL")}>
        <TextInput
          value={provider.baseUrl ?? ""}
          onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1"
          mono
        />
      </Field>

      <Field label={t("modelApiKey", "API Key")}>
        <SecretTextInput
          value={provider.apiKey ?? ""}
          onChange={(v) => set("apiKey", v || undefined)}
          placeholder={t("modelApiKeySourcePlaceholder", "ENV_VAR_NAME, !shell-command, or literal key")}
          mono
        />
        <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)", marginTop: 2 }}>
          {t("modelApiKeySourceHint", "Prefix with ! to run a shell command, or use an environment variable name.")}
        </span>
      </Field>

      <Field label={t("modelApi", "API")}>
        <Select
          value={provider.api ?? "openai-completions"}
          onChange={(v) => set("api", v)}
          options={API_OPTIONS}
          required
        />
      </Field>
    </div>
  );
}
